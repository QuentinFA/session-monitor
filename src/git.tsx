import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Outputs } from '../types'
import { layout, parseRefs, runs } from './lib/graph'
import type { GraphRow, LogCommit, Ref } from './lib/graph'
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
const gitScope = atom({ plugin: 'session-monitor', key: 'gitScope' } as const, 'all')
const gitOpen = atom({ plugin: 'session-monitor', key: 'gitOpen' } as const, '')
const gitDirs = atom({ plugin: 'session-monitor', key: 'gitDirs' } as const, [] as string[])
const gitLimit = atom({ plugin: 'session-monitor', key: 'gitLimit' } as const, 50)

/** Commits read at a time: the first page, and what Show more adds. */
const PAGE = 50
/** How long a read log is drawn from before git is asked again, when nothing ran meanwhile. */
const FRESH_MS = 30_000
const MAX_FILES = 40
const PALETTE = ['cyan', 'magenta', 'green', 'yellow', 'blue', '#d78700']
const SEP = '\x1f'
const END = '\x1e'

type Head = {
  /** The branch checked out, or null when HEAD is detached. */
  branch: string | null
  upstream?: string
  ahead: number
  behind: number
  /** Files changed, staged or not, and untracked ones. */
  uncommitted: number
}

type Log = { rows: GraphRow[]; head: Head; at: number; error?: string }

type Detail = {
  author: string
  date: string
  message: string
  files: { path: string; added: string; removed: string; note?: string }[]
}

// Module state: caches only, rebuilt after a reload.
const logs = new Map<string, Log>()
const details = new Map<string, Detail>()
const roots = new Map<string, string | null>()

/** The git root holding `dir`, or null outside any repository. */
async function rootOf($: $, dir: string): Promise<string | null> {
  const known = roots.get(dir)
  if (known !== undefined) {
    return known
  }
  const found = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 5000 })
    .catch(() => undefined)
  if (found === undefined) {
    return null // git could not run: asked again next time
  }
  const root = found.exitCode === 0 ? found.stdout.trim() : null
  roots.set(dir, root)

  return root
}

async function reposOf($: $): Promise<string[]> {
  const cwd = await $.session.cwd().catch(() => '')

  return orderRepos(cwd ? await rootOf($, cwd) : null, await read($, outputs), await read($, gitDirs))
}

async function loadLog($: $, root: string, scope: string, limit: number): Promise<Log> {
  const key = `${root}|${scope}|${limit}`
  const now = await $.clock.now().catch(() => 0)
  const cached = logs.get(key)
  if (cached && now - cached.at < FRESH_MS) {
    return cached
  }
  const range = scope === 'current' ? ['HEAD'] : ['--branches', '--remotes', '--tags', 'HEAD']
  const format = ['%H', '%P', '%D', '%an', '%at', '%s'].join('%x1f') + '%x1e'
  const [log, status] = await Promise.all([
    // No --topo-order: it walks every commit the refs reach before printing one, which a large
    // repository with many remote branches does not finish in time; the layout copes without it.
    $.process
      .run(['git', 'log', '--decorate=full', `-n${limit}`, `--format=${format}`, ...range, '--'], {
        cwd: root,
        timeoutMs: 20000,
      })
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
    $.process
      .run(['git', 'status', '--porcelain=v1', '-b'], { cwd: root, timeoutMs: 10000 })
      .catch(() => undefined),
  ])
  const head = parseStatus(status?.exitCode === 0 ? status.stdout : '')
  if (typeof log === 'string' || log.exitCode !== 0) {
    // Not kept: the next drawing asks git again.
    const said = typeof log === 'string' ? log : log.stderr.trim().split('\n')[0] || `exit ${log.exitCode}`
    const error = /does not have any commits|bad default revision 'HEAD'/.test(said) ? 'No commits yet.' : `git log failed: ${said}`

    return { rows: [], head, at: now, error }
  }
  const result: Log = { rows: layout(parseLog(log.stdout)), head, at: now }
  logs.set(key, result)

  return result
}

/** The text with its control characters dropped: a drawing holding one is refused whole. */
const printable = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

function parseLog(stdout: string): LogCommit[] {
  return stdout
    .split(END)
    .map(record => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map(record => {
      const [sha = '', parents = '', refs = '', author = '', time = '0', subject = ''] = record.split(SEP)

      return {
        sha,
        parents: parents.split(' ').filter(Boolean),
        refs,
        author: printable(author),
        time: Number(time),
        subject: printable(subject),
      }
    })
}

/** The branch line and the changes `git status --porcelain=v1 -b` prints. */
function parseStatus(stdout: string): Head {
  const [first = '', ...changes] = stdout.split('\n').filter(Boolean)
  const line = first.replace(/^## /, '')
  const track = /\[(.+)\]$/.exec(line)?.[1] ?? ''
  const name = line.replace(/ \[.+\]$/, '')
  const [branch = '', upstream] = name.split('...')
  const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0)

  return {
    branch: branch.startsWith('HEAD (') ? null : branch.replace(/^No commits yet on /, ''),
    upstream,
    ahead: count('ahead'),
    behind: count('behind'),
    uncommitted: changes.length,
  }
}

async function loadDetail($: $, root: string, sha: string): Promise<Detail | undefined> {
  const key = `${root}|${sha}`
  const known = details.get(key)
  if (known) {
    return known
  }
  const got = await $.process
    .run(
      [
        'git',
        'show',
        '--no-color',
        '--numstat',
        '--summary',
        '--diff-merges=first-parent',
        '--date=format:%Y-%m-%d %H:%M',
        `--format=%an%x1f%ad%x1f%B%x1e`,
        sha,
      ],
      { cwd: root, timeoutMs: 10000 },
    )
    .catch(() => undefined)
  if (got?.exitCode !== 0) {
    return undefined
  }
  const [header = '', body = ''] = got.stdout.split(END)
  const [author = '', date = '', message = ''] = header.split(SEP)
  const notes = new Map<string, string>()
  const files: Detail['files'] = []
  for (const line of body.split('\n')) {
    const stat = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (stat) {
      files.push({ added: stat[1] ?? '', removed: stat[2] ?? '', path: stat[3] ?? '' })
      continue
    }
    const summary = /^ (create|delete) mode \d+ (.+)$/.exec(line)
    if (summary) {
      notes.set(summary[2] ?? '', summary[1] === 'create' ? 'new' : 'deleted')
    }
  }
  const detail: Detail = {
    author: printable(author),
    date,
    message: printable(message.trim()),
    files: files.map(f => ({ ...f, note: notes.get(f.path) ?? (f.path.includes(' => ') ? 'renamed' : undefined) })),
  }
  details.set(key, detail)

  return detail
}

export const registerGit: Register = on => {
  // A command may move a ref or touch the work tree: the next drawing reads git again.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      logs.clear()
      if ((await read($, activeTab)) === 'git') {
        $.ui.invalidate('ui.render')
      }
    } catch {
      // recording never fails the call
    }

    return ran
  }).catch(($, e, next) => next(e))

  // `/add-dir` grants a directory: the Git and Changed tabs offer its repository, kept by its root.
  on('classic.DirectoryAdded', async ($, e, next) => {
    const root = await rootOf($, e.directory).catch(() => null)
    if (root) {
      await update($, gitDirs, roots => (roots.includes(root) ? roots : [...roots, root])).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: MONITOR }, async ($, e, next) =>
    (await read($, activeTab)) === 'git' ? drawGit($, e) : next(e),
  )
}

const age = (now: number, time: number) => {
  if (!now) return ''
  const s = Math.max(0, now / 1000 - time)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`
  if (s < 86400 * 365) return `${Math.round(s / (86400 * 30))}mo`

  return `${Math.round(s / (86400 * 365))}y`
}

const paint = (color: number | null) => (color === null ? undefined : PALETTE[color % PALETTE.length])

/** The Git tab's body: the selected repository's history as a graph, read-only. */
async function drawGit($: $, e: RenderInput<'Pane'>) {
  const { Box, Text, Button, Select } = $.ui.resolve(e)
  const home = await read($, homeDir)
  const repos = await reposOf($)
  if (repos.length === 0) {
    return <Text dimColor>No git repository in this session.</Text>
  }
  const wanted = await read($, gitRepo)
  const root = repos.includes(wanted) ? wanted : (repos[0] as string)
  const scope = (await read($, gitScope)) === 'current' ? 'current' : 'all'
  const limit = await read($, gitLimit)
  const opened = await read($, gitOpen)
  const log = await loadLog($, root, scope, limit)
  const now = await $.clock.now().catch(() => 0)
  const made = new Set(
    ((await read($, outputs)).places.find(p => p.root === root)?.commits ?? []).map(c => c.sha.slice(0, 7)),
  )
  const detail = opened.startsWith(`${root}|`) ? await loadDetail($, root, opened.slice(root.length + 1)) : undefined
  const { head } = log
  const reload = () => {
    logs.clear()
    $.ui.invalidate('ui.render')
  }

  const label = (ref: Ref) => {
    switch (ref.kind) {
      case 'head':
        return (
          <Text bold color="green">
            {ref.name}
          </Text>
        )
      case 'branch':
        return <Text color="green">{ref.name}</Text>
      case 'remote':
        return <Text dimColor>{ref.name}</Text>
      case 'tag':
        return <Text color="yellow">◆ {ref.name}</Text>
      default:
        return <Text color="cyan">HEAD</Text>
    }
  }

  const gutter = (row: GraphRow) => {
    const width = row.chars.length
    const lanes = row.below.map(color => ({ ch: color === null ? ' ' : '│', color }))

    return runs(
      Array.from({ length: width }, (_, x) => (x % 2 === 0 ? (lanes[x / 2] ?? { ch: ' ', color: null }) : { ch: ' ', color: null })),
    )
  }

  const drawGutter = (row: GraphRow, key: string) => (
    <Box key={`g:${key}`} flexShrink={0}>
      {gutter(row).map((run, i) => (
        <Text key={`g:${key}:${i}`} color={paint(run.color)}>
          {run.text}
        </Text>
      ))}
    </Box>
  )

  const drawDetail = (row: GraphRow, d: Detail) => {
    const lines = d.message.split('\n')
    const shown = d.files.slice(0, MAX_FILES)
    const line = (key: string, mark: string, content: unknown) => (
      <Box key={`d:${key}`}>
        {drawGutter(row, key)}
        <Text dimColor>{mark} </Text>
        {content as never}
      </Box>
    )

    return (
      <Box key={`detail:${row.commit.sha}`} flexDirection="column">
        {line(
          'who',
          '┌',
          <Text dimColor wrap="truncate-end">
            {d.author} · {d.date} · {row.commit.sha.slice(0, 12)}
            {row.commit.parents.length > 1 ? ` · merge of ${row.commit.parents.map(p => p.slice(0, 7)).join(' + ')}` : ''}
          </Text>,
        )}
        {lines.map((text, i) => line(`m${i}`, '│', <Text bold={i === 0} wrap="wrap">{text || ' '}</Text>))}
        {shown.map(f =>
          line(
            `f:${f.path}`,
            '│',
            <Box key={`fb:${f.path}`}>
              <Text wrap="truncate-start">{f.path}</Text>
              <Box flexShrink={0}>
                <Text>
                  {'  '}
                  {f.added === '-' ? (
                    <Text dimColor>binary</Text>
                  ) : (
                    <Text>
                      <Text color="green">+{f.added}</Text> <Text color="red">−{f.removed}</Text>
                    </Text>
                  )}
                  {f.note ? <Text dimColor> {f.note}</Text> : ''}
                </Text>
              </Box>
            </Box>,
          ),
        )}
        {line(
          'end',
          '└',
          <Text dimColor>
            {d.files.length > shown.length ? `… ${d.files.length - shown.length} more · ` : ''}
            {d.files.length} {d.files.length === 1 ? 'file' : 'files'}
          </Text>,
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {repos.length > 1 ? (
          <Select
            key="repo"
            label="repo "
            value={root}
            options={repos.map(r => ({ value: r, label: shortPath(home, r) }))}
            onSelect={value => {
              update($, gitRepo, () => value)
              update($, gitOpen, () => '')
            }}
          />
        ) : (
          <Text bold>{shortPath(home, root)}</Text>
        )}
        <Text> </Text>
        <Button
          key="scope:current"
          label="Current branch"
          variant={scope === 'current' ? 'primary' : undefined}
          onPress={() => update($, gitScope, () => 'current')}
        />
        <Text> </Text>
        <Button
          key="scope:all"
          label="All branches"
          variant={scope === 'all' ? 'primary' : undefined}
          onPress={() => update($, gitScope, () => 'all')}
        />
        <Text> </Text>
        <Button key="refresh" label="↻" onPress={reload} />
      </Box>
      <Box>
        <Text dimColor wrap="truncate-end">
          {head.branch ? `on ${head.branch}` : 'HEAD detached'}
          {head.upstream ? ` · ${head.upstream}` : head.branch ? ' · no upstream' : ''}
          {head.ahead ? ` ↑${head.ahead}` : ''}
          {head.behind ? ` ↓${head.behind}` : ''}
          {head.upstream && !head.ahead && !head.behind ? ' in sync' : ''}
          {' · '}
          {head.uncommitted ? '' : 'clean'}
        </Text>
        {head.uncommitted > 0 && (
          <Box flexShrink={0}>
            <Button
              key="to-changed"
              plain
              label={`${head.uncommitted} uncommitted ›`}
              onPress={() => update($, activeTab, () => 'changed')}
            />
          </Box>
        )}
      </Box>
      {log.error && <Text color="red">{log.error}</Text>}
      {log.rows.map(row => {
        const c = row.commit
        const refs = parseRefs(c.refs)
        const isHead = refs.some(r => r.kind === 'head' || r.kind === 'detached')
        const isMade = made.has(c.sha.slice(0, 7))
        const isOpen = opened === `${root}|${c.sha}`
        const chars = row.chars.map((ch, x) => (x === row.col * 2 && isHead ? { ...ch, ch: '◉' } : ch))

        return (
          <Box key={`row:${c.sha}`} flexDirection="column">
            <Box>
              <Box flexShrink={0}>
                {runs(chars).map((run, i) => (
                  <Text key={`r:${c.sha}:${i}`} color={paint(run.color)} bold={run.text.includes('◉')}>
                    {run.text}
                  </Text>
                ))}
              </Box>
              <Button
                key={`c:${c.sha}`}
                plain
                dimColor={!isOpen}
                label={c.sha.slice(0, 7)}
                onPress={() => update($, gitOpen, now => (now === `${root}|${c.sha}` ? '' : `${root}|${c.sha}`))}
              />
              <Text> </Text>
              {refs.length > 0 && (
                <Box flexShrink={0}>
                  {refs.map(ref => (
                    <Text key={`ref:${c.sha}:${ref.kind}:${ref.name}`} wrap="truncate-end">
                      {label(ref)}{' '}
                    </Text>
                  ))}
                </Box>
              )}
              {isMade && <Text color="claude">✦ </Text>}
              <Text bold={isMade} wrap="truncate-end">
                {c.subject}
              </Text>
              <Box flexShrink={0}>
                <Text dimColor>
                  {'  '}
                  {c.author}
                  {now ? ` ${age(now, c.time)}` : ''}
                </Text>
              </Box>
            </Box>
            {isOpen && detail && drawDetail(row, detail)}
          </Box>
        )
      })}
      {log.rows.length >= limit && (
        <Box marginTop={1}>
          <Button key="more" label={`Show ${PAGE} more`} onPress={() => update($, gitLimit, n => n + PAGE)} />
        </Box>
      )}
      {made.size > 0 && (
        <Text dimColor>
          <Text color="claude">✦</Text> made this session
        </Text>
      )}
    </Box>
  )
}
