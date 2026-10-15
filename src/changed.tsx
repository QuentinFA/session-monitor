import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Outputs } from '../types'
import { MONITOR } from './lib/pane'
import { orderRepos, shortPath } from './lib/repos'

type $ = EngineInterface

const activeTab = atom({ plugin: 'session-monitor', key: 'tab' } as const, 'outputs')
const homeDir = atom({ plugin: 'session-monitor', key: 'home' } as const, '')
const outputs = atom({ plugin: 'session-monitor', key: 'outputs' } as const, {
  places: [],
  github: [],
  services: [],
  scheduled: [],
} as Outputs)
const gitRepo = atom({ plugin: 'session-monitor', key: 'gitRepo' } as const, '')
const gitDirs = atom({ plugin: 'session-monitor', key: 'gitDirs' } as const, [] as string[])
const changedFile = atom({ plugin: 'session-monitor', key: 'changedFile' } as const, '')

/** How long a read status is drawn from before git is asked again, when nothing ran meanwhile. */
const FRESH_MS = 30_000
/** Untracked files counted line by line, one git call each; the rest are only marked new. */
const MAX_COUNTED = 30
/** What a Code element draws at most; a longer diff is cut at a hunk. */
const MAX_DIFF = 90_000

type Section = 'staged' | 'unstaged' | 'untracked'

const SECTIONS: { id: Section; title: string }[] = [
  { id: 'staged', title: 'Staged' },
  { id: 'unstaged', title: 'Unstaged' },
  { id: 'untracked', title: 'Untracked' },
]

type Entry = {
  section: Section
  /** Git's letter for the change: M, A, D, T, U, or ? when untracked. */
  code: string
  path: string
  added?: number
  removed?: number
  isBinary?: boolean
}

type Changes = { entries: Entry[]; at: number; error?: string }

type Diff = { source: string; hidden: number; isBinary: boolean }

// Module state: caches only, rebuilt after a reload.
const changes = new Map<string, Changes>()
const diffs = new Map<string, Diff>()
const roots = new Map<string, string | null>()

const idOf = (root: string, entry: Entry) => `${root}|${entry.section}|${entry.path}`

async function ownRoot($: $): Promise<string | null> {
  const cwd = await $.session.cwd().catch(() => '')
  const known = roots.get(cwd)
  if (!cwd || known !== undefined) {
    return known ?? null
  }
  const found = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 })
    .catch(() => undefined)
  if (found === undefined) {
    return null
  }
  const root = found.exitCode === 0 ? found.stdout.trim() : null
  roots.set(cwd, root)

  return root
}

/** Git, its colors off whatever the config says: an escape sequence in a drawing is refused. */
const git = ($: $, root: string, args: string[]) =>
  $.process
    .run(['git', '-c', 'color.ui=never', ...args], { cwd: root, timeoutMs: 20000 })
    .catch((error: unknown) => String(error))

/** `git diff --numstat`'s lines, by path; a binary file counts `-`. */
function numstat(stdout: string): Map<string, { added?: number; removed?: number; isBinary?: boolean }> {
  const counts = new Map<string, { added?: number; removed?: number; isBinary?: boolean }>()
  for (const line of stdout.split('\n')) {
    const [added, removed, path] = line.split('\t')
    if (path !== undefined) {
      counts.set(
        path,
        added === '-' ? { isBinary: true } : { added: Number(added), removed: Number(removed) },
      )
    }
  }

  return counts
}

async function loadChanges($: $, root: string): Promise<Changes> {
  const now = await $.clock.now().catch(() => 0)
  const cached = changes.get(root)
  if (cached && now - cached.at < FRESH_MS) {
    return cached
  }
  const [status, staged, unstaged] = await Promise.all([
    git($, root, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']),
    git($, root, ['diff', '--cached', '--numstat', '--no-renames']),
    git($, root, ['diff', '--numstat', '--no-renames']),
  ])
  if (typeof status === 'string' || status.exitCode !== 0) {
    const said = typeof status === 'string' ? status : status.stderr.trim().split('\n')[0] || `exit ${status.exitCode}`

    return { entries: [], at: now, error: `git status failed: ${said}` }
  }
  const counts = {
    staged: typeof staged === 'string' ? new Map() : numstat(staged.stdout),
    unstaged: typeof unstaged === 'string' ? new Map() : numstat(unstaged.stdout),
  }
  const entries: Entry[] = []
  for (const record of status.stdout.split('\0').filter(Boolean)) {
    const [x = ' ', y = ' '] = record
    const path = record.slice(3)
    if (x === '?') {
      entries.push({ section: 'untracked', code: '?', path })
      continue
    }
    if (x !== ' ') {
      entries.push({ section: 'staged', code: x, path, ...counts.staged.get(path) })
    }
    if (y !== ' ') {
      entries.push({ section: 'unstaged', code: y, path, ...counts.unstaged.get(path) })
    }
  }
  // An untracked file's lines, counted against nothing, for the first ones.
  const untracked = entries.filter(e => e.section === 'untracked').slice(0, MAX_COUNTED)
  await Promise.all(
    untracked.map(async entry => {
      const got = await git($, root, ['diff', '--no-index', '--numstat', '--', '/dev/null', entry.path])
      if (typeof got !== 'string') {
        Object.assign(entry, numstat(got.stdout).values().next().value ?? {})
      }
    }),
  )
  const result = { entries, at: now }
  changes.set(root, result)

  return result
}

async function loadDiff($: $, root: string, entry: Entry): Promise<Diff | undefined> {
  const key = idOf(root, entry)
  const known = diffs.get(key)
  if (known) {
    return known
  }
  const args =
    entry.section === 'untracked'
      ? ['diff', '--no-color', '--no-index', '--', '/dev/null', entry.path]
      : ['diff', '--no-color', ...(entry.section === 'staged' ? ['--cached'] : []), '--no-renames', '--', entry.path]
  const got = await git($, root, args)
  if (typeof got === 'string') {
    return undefined
  }
  const text = got.stdout
  const start = text.search(/^@@/m)
  const hunks = start < 0 ? [] : text.slice(start).split(/^(?=@@)/m)
  let source = ''
  let shown = 0
  for (const hunk of hunks) {
    if (source.length + hunk.length > MAX_DIFF && shown > 0) {
      break
    }
    source += hunk
    shown++
  }
  const diff = { source: source.slice(0, MAX_DIFF), hidden: hunks.length - shown, isBinary: /^Binary files /m.test(text) }
  diffs.set(key, diff)

  return diff
}

export const registerChanged: Register = on => {
  // A command or an edit may change the work tree: the next drawing reads git again.
  on('tool.call', { tool: /^(Bash|Edit|Write|NotebookEdit)$/ }, async ($, e, next) => {
    const ran = await next(e)
    try {
      changes.clear()
      diffs.clear()
      if ((await read($, activeTab)) === 'changed') {
        $.ui.invalidate('ui.render')
      }
    } catch {
      // recording never fails the call
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: MONITOR }, async ($, e, next) =>
    (await read($, activeTab)) === 'changed' ? drawChanged($, e) : next(e),
  )
}

/** The Changed tab's body: what is not committed, by section, and one file's diff. */
async function drawChanged($: $, e: RenderInput<'Pane'>) {
  const { Box, Text, Button, Select, Link, Code } = $.ui.resolve(e)
  const home = await read($, homeDir)
  const repos = orderRepos(await ownRoot($), await read($, outputs), await read($, gitDirs))
  if (repos.length === 0) {
    return <Text dimColor>No git repository in this session.</Text>
  }
  const wanted = await read($, gitRepo)
  const root = repos.includes(wanted) ? wanted : (repos[0] as string)
  const { entries, error } = await loadChanges($, root)
  const chosen = await read($, changedFile)
  const index = Math.max(
    0,
    entries.findIndex(entry => idOf(root, entry) === chosen),
  )
  const selected = entries[index]
  const diff = selected ? await loadDiff($, root, selected) : undefined
  const select = (entry: Entry | undefined) => () => entry && update($, changedFile, () => idOf(root, entry))
  const reload = () => {
    changes.clear()
    diffs.clear()
    $.ui.invalidate('ui.render')
  }
  const counts = (entry: Entry) =>
    entry.isBinary ? (
      <Text dimColor>binary</Text>
    ) : entry.added === undefined ? (
      <Text dimColor>{entry.section === 'untracked' ? 'new' : ''}</Text>
    ) : (
      <Text>
        <Text color="green">+{entry.added}</Text> <Text color="red">−{entry.removed}</Text>
      </Text>
    )

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {repos.length > 1 ? (
          <Select
            key="repo"
            label="repo "
            value={root}
            options={repos.map(r => ({ value: r, label: shortPath(home, r) }))}
            onSelect={value => update($, gitRepo, () => value)}
          />
        ) : (
          <Text bold>{shortPath(home, root)}</Text>
        )}
        <Text> </Text>
        <Button key="refresh" label="↻" onPress={reload} />
      </Box>
      {error && <Text color="red">{error}</Text>}
      {!error && entries.length === 0 && <Text dimColor>Nothing uncommitted: the work tree is clean.</Text>}
      {SECTIONS.map(({ id, title }) => {
        const listed = entries.filter(entry => entry.section === id)
        if (listed.length === 0) {
          return null
        }

        return (
          <Box key={`section:${id}`} flexDirection="column">
            <Text>
              <Text bold>{title}</Text> <Text dimColor>{listed.length}</Text>
            </Text>
            {listed.map(entry => {
              const isSelected = entry === selected
              const isGone = entry.code === 'D'

              return (
                <Box key={`row:${id}:${entry.path}`}>
                  <Text color="claude">{isSelected ? '▸ ' : '  '}</Text>
                  <Button
                    key={`f:${id}:${entry.path}`}
                    plain
                    dimColor={!isSelected}
                    label={entry.code}
                    onPress={select(entry)}
                  />
                  <Text> </Text>
                  <Text bold={isSelected} wrap="truncate-start" strikethrough={isGone} dimColor={isGone}>
                    {isGone ? entry.path : <Link href={`file://${root}/${entry.path}`} label={entry.path} />}
                  </Text>
                  <Box flexShrink={0}>
                    <Text>  </Text>
                    {counts(entry)}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )
      })}
      {selected && (
        <Box key="diff" flexDirection="column" marginTop={1}>
          <Box>
            <Text bold wrap="truncate-start">
              {selected.path}
            </Text>
            <Box flexShrink={0}>
              <Text dimColor>
                {'  '}
                {index + 1}/{entries.length} · {selected.section}{' '}
              </Text>
              <Button key="prev" label="prev" hotkey="p" onPress={select(entries[index - 1] ?? entries.at(-1))} />
              <Text> </Text>
              <Button key="next" label="next" hotkey="n" onPress={select(entries[index + 1] ?? entries[0])} />
            </Box>
          </Box>
          {diff === undefined ? (
            <Text color="red">git could not show this diff</Text>
          ) : diff.isBinary ? (
            <Text dimColor>Binary file: no lines to show.</Text>
          ) : diff.source ? (
            <Code key="diff-code" format="diff" source={diff.source} path={selected.path} />
          ) : (
            <Text dimColor>No line changes (a mode or type change).</Text>
          )}
          {diff && diff.hidden > 0 && (
            <Text dimColor>
              … {diff.hidden} more {diff.hidden === 1 ? 'hunk' : 'hunks'}, too long to draw here
            </Text>
          )}
        </Box>
      )}
    </Box>
  )
}
