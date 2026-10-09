import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'

import type {
  Action,
  Command,
  Commit,
  FileChange,
  LineCount,
  Outputs,
  Place,
} from '../types'

const PANE = 'outputs'
const EMPTY: Outputs = { places: [], github: [], services: [], scheduled: [] }
const outputs = atom({ plugin: 'session-monitor', key: 'outputs' } as const, EMPTY)
const expanded = atom({ plugin: 'session-monitor', key: 'expanded' } as const, [])

// Commands that move the working tree without the session authoring the change.
const TREE_MOVES = /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|switch|pull|merge|rebase|stash|worktree)\b/
const BRANCH_CREATE =
  /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout\s+-[bB]|switch\s+(?:-c|-C|--create)|branch)\s+([^\s;&|-][^\s;&|]*)/g
const GH_WRITE =
  /\bgh\s+(issue|pr|release|repo|gist|label|run|workflow)\s+(create|comment|close|reopen|edit|delete|merge|review|fork|rerun|run)\b/
const BRANCH_DELETE = /\bgit\s+(?:-C\s+\S+\s+)?branch\s+((?:-[a-zA-Z]*[dD][a-zA-Z]*|--delete)\b[^;&|\n]*)/g
const PUSH = /\bgit\s+(?:-C\s+\S+\s+)?push\s+([^;&|\n]*)/g
const WORKTREE_ADD = /\bgit\s+(?:-C\s+\S+\s+)?worktree\s+add\s+([^;&|]+)/
const GH_URL = /https:\/\/github\.com\/[^\s)"']+/g
const MCP_READ = /^(get|list|search|read|query|fetch|download|find|guide|describe|suggest|export|check)/
const MAX_COMMANDS = 300

type $ = EngineInterface

// Module state: caches only, rebuilt after a reload.
const roots = new Map<string, { root: string; isRepo: boolean }>()
let home = ''

const dirname = (path: string) => path.replace(/\/[^/]*\/?$/, '') || '/'
const resolve = (base: string, path: string) =>
  path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path}`
const short = (path: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

/** The git root holding `dir`, or `dir` itself outside any repo. */
const placeOf = async ($: $, dir: string) => {
  const known = roots.get(dir)
  if (known) {
    return known
  }
  let probe = dir
  for (let i = 0; i < 4; i++) {
    const found = await $.process
      .run(['git', 'rev-parse', '--show-toplevel'], { cwd: probe, timeoutMs: 5000 })
      .catch(() => undefined)
    if (found?.exitCode === 0) {
      const place = { root: found.stdout.trim(), isRepo: true }
      roots.set(dir, place)

      return place
    }
    if (found !== undefined || probe === '/') {
      break
    }
    probe = dirname(probe) // the directory may not exist (a deleted file's)
  }
  const place = { root: dir, isRepo: false }
  roots.set(dir, place)

  return place
}

/**
 * The path with every symbolic link resolved, as git reports its roots
 * (`/tmp` is `/private/tmp` on macOS); a missing file through its directory.
 */
const canon = async ($: $, path: string): Promise<string> => {
  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
  if (real) {
    return real
  }
  const dir = dirname(path)
  if (dir === path) {
    return path
  }

  return `${(await canon($, dir)).replace(/\/$/, '')}/${path.slice(dir.length).replace(/^\//, '')}`
}

/** A `cd` or `-C` argument as a path, or undefined when the shell would have to expand it. */
const expand = (base: string, raw: string) => {
  const path = raw.replace(/^["']|["']$/g, '')
  if (path.startsWith('~')) {
    return home ? `${home}${path.slice(1)}` : undefined
  }

  return path.startsWith('$') || path === '-' ? undefined : resolve(base, path)
}

/** The command as the shell parses it: heredoc bodies are data, not commands. */
const shellText = (command: string) =>
  command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, '<<$2')

/** The directory a Bash command ran in: its `cd`s followed in order up to its `git -C`, else the session's. */
const commandDir = async ($: $, command: string) => {
  const cwd = await $.session.cwd()
  const text = shellText(command)
  const gitC = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(text)
  const cds = [...text.matchAll(/(?:^|&&|;|\|\||\n)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)]
  let base = cwd
  for (const cd of gitC ? cds.filter(cd => cd.index < gitC.index) : cds) {
    base = (cd[1] && expand(base, cd[1])) || base
  }

  return (gitC?.[1] && expand(base, gitC[1])) || base
}

const remoteOf = async ($: $, root: string) => {
  const got = await $.process
    .run(['git', 'remote', 'get-url', 'origin'], { cwd: root, timeoutMs: 5000 })
    .catch(() => undefined)
  const url = got?.exitCode === 0 ? got.stdout.trim() : ''

  return /github\.com[:/](.+?)(?:\.git)?$/.exec(url)?.[1]
}

type Snapshot = {
  root: string
  head: string
  numstat: Map<string, { added: number; removed: number }>
  untracked: Set<string>
}

/** A repo's HEAD and uncommitted changes, to tell what a shell command did when the engine reports no diff. */
const snapshot = async ($: $, dir: string): Promise<Snapshot | undefined> => {
  const { root, isRepo } = await placeOf($, await canon($, dir))
  if (!isRepo) {
    return undefined
  }
  const git = (args: string[]) => $.process.run(['git', ...args], { cwd: root, timeoutMs: 2000 })
  const [head, diff, others] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['diff', '--numstat', 'HEAD']),
    git(['ls-files', '--others', '--exclude-standard']),
  ])
  const numstat = new Map<string, { added: number; removed: number }>()
  for (const line of diff.stdout.split('\n')) {
    const [a, d, path] = line.split('\t')
    if (path !== undefined) {
      numstat.set(path, { added: Number(a) || 0, removed: Number(d) || 0 })
    }
  }

  return {
    root,
    head: head.stdout.trim(),
    numstat,
    untracked: new Set(others.stdout.split('\n').filter(Boolean)),
  }
}

/** Applies `fn` to the place for `dir`, creating the place on first touch. */
const touch = async ($: $, dir: string, fn: (place: Place) => Place) => {
  const { root, isRepo } = await placeOf($, await canon($, dir))
  const isNew = !(await read($, outputs)).places.some(p => p.root === root)
  const remote = isNew && isRepo ? await remoteOf($, root) : undefined
  await update($, outputs, out => {
    const has = out.places.find(p => p.root === root)
    const place: Place = has ?? {
      root,
      isRepo,
      remote,
      commands: [],
      used: [],
      changed: [],
      branches: [],
      commits: [],
      pushes: [],
    }
    const next = fn(place)

    return {
      ...out,
      places: has ? out.places.map(p => (p === has ? next : p)) : [...out.places, next],
    }
  })
  await refreshStatus($)
}

const relative = (place: Place, path: string) =>
  path.startsWith(`${place.root}/`) ? path.slice(place.root.length + 1) : path

const addChange = (place: Place, change: FileChange): Place => {
  const path = relative(place, change.path)
  const had = place.changed.find(f => f.path === path)
  const merged: FileChange = had
    ? {
        path,
        added: had.added + change.added,
        removed: had.removed + change.removed,
        isCreated: had.isCreated || change.isCreated ? true : undefined,
        isDeleted: change.isDeleted ? true : undefined,
      }
    : { ...change, path }

  return {
    ...place,
    changed: had ? place.changed.map(f => (f === had ? merged : f)) : [...place.changed, merged],
  }
}

const addUse = (place: Place, path: string): Place => {
  const rel = relative(place, path)
  const had = place.used.find(f => f.path === rel)

  return {
    ...place,
    used: had
      ? place.used.map(f => (f === had ? { ...f, reads: f.reads + 1 } : f))
      : [...place.used, { path: rel, reads: 1, searches: 0 }],
  }
}

const addGlobal = ($: $, list: 'github' | 'services' | 'scheduled', action: Action) =>
  update($, outputs, out => ({ ...out, [list]: [...out[list], action] }))

const countHunks = (hunks: readonly { lines: readonly string[] }[]) => {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }

  return { added, removed }
}

const refreshStatus = async ($: $) => {
  const { places } = await read($, outputs)
  let added = 0
  let removed = 0
  let commits = 0
  for (const place of places) {
    commits += place.commits.length
    for (const file of place.changed) {
      added += file.added
      removed += file.removed
    }
  }
  $.ui.status(
    places.length === 0
      ? undefined
      : `${places.length} dir${places.length === 1 ? '' : 's'} · +${added} −${removed} · ${commits} commit${commits === 1 ? '' : 's'}`,
  )
}

const commitOf = async ($: $, root: string, sha: string, kind: string, branch?: string) => {
  const shown = await $.process
    .run(['git', 'show', '--numstat', '--format=%s', sha], { cwd: root, timeoutMs: 10000 })
    .catch(() => undefined)
  const [subject = '', ...rest] = shown?.exitCode === 0 ? shown.stdout.split('\n') : []
  const files: LineCount[] = rest
    .map(line => line.split('\t'))
    .filter(parts => parts.length === 3)
    .map(([a, d, path = '']) => ({ path, added: Number(a) || 0, removed: Number(d) || 0 }))
  const commit: Commit = { sha: sha.slice(0, 7), subject, kind, branch, files }

  return commit
}

const isProductive = (place: Place) =>
  place.changed.length +
    place.commits.length +
    place.branches.length +
    place.pushes.length +
    (place.deleted?.length ?? 0) +
    (place.remoteDeleted?.length ?? 0) >
  0

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A directory's collapsed line. */
const counts = (place: Place) =>
  [
    place.branches.length && plural(place.branches.length, 'branch', 'branches'),
    place.deleted?.length && `${place.deleted.length} deleted`,
    place.remoteDeleted?.length && `${place.remoteDeleted.length} deleted on remote`,
    place.commits.length && plural(place.commits.length, 'commit'),
    place.changed.length && `${place.changed.length} changed`,
    place.used.length && `${place.used.length} read`,
    place.commands.length && plural(place.commands.length, 'command'),
  ]
    .filter(Boolean)
    .join(' · ')

/** Every key a fold can open, for Expand all. */
const allKeys = (out: Outputs) => [
  'u:services',
  ...out.places.flatMap(p => [
    `p:${p.root}`,
    `r:${p.root}`,
    `x:${p.root}`,
    ...p.commits.map(c => `s:${p.root}:${c.sha}`),
  ]),
]

const actionLine = (a: Action) =>
  `- ${a.isDone ? 'done: ' : ''}${a.label}${a.url ? ` — ${a.url}` : ''}`

/** The whole record as markdown, for the clipboard. */
function report(out: Outputs) {
  const parts: string[] = ['# Session outputs']
  const made = out.services.filter(a => !a.isUse)
  const used = out.services.filter(a => a.isUse)
  for (const [title, list] of [
    ['GitHub', out.github],
    ['Services', made],
    ['Services used', used],
    ['Scheduled & running', out.scheduled],
  ] as const) {
    if (list.length) {
      parts.push(`\n## ${title}`, ...list.map(actionLine))
    }
  }
  for (const place of out.places) {
    parts.push(`\n## ${short(place.root)}${place.remote ? ` (${place.remote})` : place.isRepo ? '' : ' (not git)'}`)
    if (place.branches.length)
      parts.push(`- branches: ${place.branches.map(b => (place.deleted?.includes(b) ? `~~${b}~~ (deleted)` : b)).join(', ')}`)
    const deletedOnly = (place.deleted ?? []).filter(b => !place.branches.includes(b))
    if (deletedOnly.length) parts.push(`- deleted branches: ${deletedOnly.join(', ')}`)
    if (place.remoteDeleted?.length) parts.push(`- deleted on remote: ${place.remoteDeleted.join(', ')}`)
    if (place.pushes.length) parts.push(`- pushed: ${place.pushes.join(', ')}`)
    if (place.commits.length) {
      parts.push('\n### Commits')
      for (const c of place.commits) {
        parts.push(`- \`${c.sha}\` ${c.subject}${c.branch ? ` (${c.branch})` : ''}${c.kind === 'committed' ? '' : ` — ${c.kind}`}`)
        for (const f of c.files) parts.push(`  - +${f.added} −${f.removed} ${f.path}`)
      }
    }
    if (place.changed.length) {
      parts.push('\n### Changed')
      for (const f of place.changed)
        parts.push(`- +${f.added} −${f.removed} ${f.path}${f.isCreated ? ' (new)' : ''}${f.isDeleted ? ' (deleted)' : ''}`)
    }
    if (place.used.length) {
      parts.push('\n### Read')
      for (const f of place.used) parts.push(`- ${f.path}${f.reads > 1 ? ` ×${f.reads}` : ''}`)
    }
    if (place.commands.length) {
      parts.push('\n### Commands', '```sh')
      for (const c of place.commands) {
        const [first = '', ...rest] = c.command.split('\n')
        const more = rest.length ? `  # … (+${rest.length} lines)` : ''
        parts.push(`${first}${c.isBackground ? ' &' : ''}${c.isError ? '  # failed' : ''}${more}`)
      }
      parts.push('```')
    }
  }

  return parts.length === 1 ? 'Nothing used or produced yet.' : parts.join('\n')
}

function summary(out: Outputs) {
  const parts: string[] = ['# Session outputs']
  for (const place of out.places) {
    parts.push(`\n## ${short(place.root)}${place.remote ? ` (${place.remote})` : ''}`)
    if (place.branches.length) parts.push(`- branches: ${place.branches.join(', ')}`)
    if (place.pushes.length) parts.push(`- pushed: ${place.pushes.join(', ')}`)
    for (const c of place.commits) parts.push(`- commit ${c.sha} ${c.subject}`)
    for (const f of place.changed)
      parts.push(`- +${f.added} −${f.removed} ${f.path}${f.isCreated ? ' (new)' : ''}${f.isDeleted ? ' (deleted)' : ''}`)
    if (place.used.length) parts.push(`- read ${place.used.length} file(s)`)
    if (place.commands.length) parts.push(`- ran ${place.commands.length} command(s)`)
  }
  for (const [title, list] of [
    ['GitHub', out.github],
    ['Services', out.services.filter(a => !a.isUse)],
    ['Scheduled & running', out.scheduled],
  ] as const) {
    if (list.length) {
      parts.push(`\n## ${title}`)
      for (const a of list) parts.push(`- ${a.label}${a.url ? ` ${a.url}` : ''}`)
    }
  }

  return parts.length === 1 ? 'Nothing used or produced yet.' : parts.join('\n')
}

async function recordBash(
  $: $,
  e: Extract<ToolCallInput, { tool: 'Bash' }>,
  ran: ToolCallResult<'Bash'>,
  dir: string,
  before: Snapshot | undefined,
) {
  if (ran.deny !== undefined) {
    return
  }
  const text = shellText(e.command)
  const out = ran.isError ? undefined : ran.result
  const command: Command = {
    command: e.command,
    description: e.description,
    isError: ran.isError ? true : undefined,
    isBackground: e.run_in_background || out?.backgroundTaskId ? true : undefined,
  }
  await touch($, dir, place => ({
    ...place,
    commands: [...place.commands, command].slice(-MAX_COMMANDS),
  }))
  if (!out) {
    if (ran.isError) {
      await recordGh($, text, ran.text ?? '', dir, undefined, true)
    }

    return
  }
  const after = before ? await snapshot($, dir).catch(() => undefined) : undefined
  const hasMovedHead = before !== undefined && after !== undefined && after.head !== before.head

  // Files the command changed: the engine's diff, else what git saw change around the command.
  const diff = out.bashEditDiff
  const isTreeMove = TREE_MOVES.test(text)
  if (diff && !diff.unavailable && !diff.skipped && diff.files.length + (diff.changedFiles?.length ?? 0) > 0) {
    if (!isTreeMove) {
      const counted = new Set<string>()
      for (const file of diff.files) {
        counted.add(file.filePath)
        const path = await canon($, file.filePath)
        await touch($, dirname(path), place =>
          addChange(place, {
            path,
            ...countHunks(file.hunks),
            isCreated: file.created,
            isDeleted: file.deleted,
          }),
        )
      }
      for (const raw of diff.changedFiles ?? []) {
        if (!counted.has(raw)) {
          const path = await canon($, raw)
          await touch($, dirname(path), place => addChange(place, { path, added: 0, removed: 0 }))
        }
      }
    }
  } else if (before && after && !hasMovedHead && !isTreeMove) {
    const { root } = before
    for (const [rel, now] of after.numstat) {
      const was = before.numstat.get(rel) ?? { added: 0, removed: 0 }
      const added = Math.max(0, now.added - was.added)
      const removed = Math.max(0, now.removed - was.removed)
      if (added + removed > 0) {
        await touch($, root, place => addChange(place, { path: `${root}/${rel}`, added, removed }))
      }
    }
    for (const rel of after.untracked) {
      if (!before.untracked.has(rel)) {
        const counted = await $.process
          .run(['git', 'diff', '--no-index', '--numstat', '/dev/null', rel], { cwd: root, timeoutMs: 5000 })
          .catch(() => undefined)
        const added = Number(counted?.stdout.split('\t')[0]) || 0
        await touch($, root, place =>
          addChange(place, { path: `${root}/${rel}`, added, removed: 0, isCreated: true }),
        )
      }
    }
  }

  // Commits: every one a `git commit` command added to HEAD — the engine reports only the last,
  // and nothing when the output was rewritten — labelled from the engine's report where it has one.
  const git = out.gitOperation
  const reported = git?.commit
  const isSame = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)
  let shas: string[] = reported ? [reported.sha] : []
  if (before && after && hasMovedHead && /\bgit\b[^;&|]*\bcommit\b/.test(text)) {
    const listed = await $.process
      .run(['git', 'rev-list', '--reverse', '--max-count=50', `${before.head}..${after.head}`], {
        cwd: before.root,
        timeoutMs: 5000,
      })
      .catch(() => undefined)
    const added = listed?.exitCode === 0 ? listed.stdout.split('\n').filter(Boolean) : []
    shas = added.length > 0 ? added : [after.head]
  }
  if (shas.length > 0) {
    const { root } = await placeOf($, await canon($, dir))
    for (const sha of shas) {
      const isReported = reported !== undefined && isSame(sha, reported.sha)
      const kind = isReported ? reported.kind : sha === after?.head && /--amend\b/.test(text) ? 'amended' : 'committed'
      const commit = await commitOf($, root, sha, kind, isReported ? reported.branch : undefined)
      await touch($, dir, place =>
        place.commits.some(c => isSame(c.sha, commit.sha)) ? place : { ...place, commits: [...place.commits, commit] },
      )
    }
  }
  if (git?.push) {
    const branch = git.push.branch
    await touch($, dir, place =>
      place.pushes.includes(branch) ? place : { ...place, pushes: [...place.pushes, branch] },
    )
  }
  if (git?.branch) {
    const label = `${git.branch.action} ${git.branch.ref}`
    await touch($, dir, place => ({ ...place, pushes: [...place.pushes, label] }))
  }
  for (const match of text.matchAll(BRANCH_CREATE)) {
    const name = match[1]
    if (name === undefined) {
      continue
    }
    await touch($, dir, place =>
      place.branches.includes(name) ? place : { ...place, branches: [...place.branches, name] },
    )
  }

  const gone = deletions(text)
  if (gone.local.length + gone.remote.length > 0) {
    await touch($, dir, place => ({
      ...place,
      deleted: gone.local.length ? addNames(place.deleted, gone.local) : place.deleted,
      remoteDeleted: gone.remote.length ? addNames(place.remoteDeleted, gone.remote) : place.remoteDeleted,
    }))
  }

  const worktree = WORKTREE_ADD.exec(text)
  if (worktree?.[1]) {
    const tokens = worktree[1].trim().split(/\s+/)
    let branch: string | undefined
    let path: string | undefined
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] ?? ''
      if (token === '-b' || token === '-B') {
        branch = tokens[++i]
      } else if (!token.startsWith('-') && path === undefined) {
        path = token
      }
    }
    const target = path && expand(dir, path)
    if (branch && target) {
      const name = branch
      await touch($, target, place =>
        place.branches.includes(name) ? place : { ...place, branches: [...place.branches, name] },
      )
    }
  }

  await recordGh($, text, `${out.stdout}\n${out.stderr}`, dir, git?.pr, false)
  if (command.isBackground) {
    await addGlobal($, 'scheduled', {
      label: `background: ${e.description ?? e.command}`,
      taskId: out.backgroundTaskId,
    })
  }
}

/** The names a `git branch -d` deletes and the branches a `git push --delete` or `push origin :name` removes. */
const deletions = (text: string) => {
  const local = [...text.matchAll(BRANCH_DELETE)].flatMap(m =>
    (m[1] ?? '').trim().split(/\s+/).filter(t => t && !t.startsWith('-')),
  )
  const remote = [...text.matchAll(PUSH)].flatMap(m => {
    const tokens = (m[1] ?? '').trim().split(/\s+/).filter(Boolean)
    const isDelete = tokens.some(t => t === '--delete' || t === '-d')
    const names = tokens.filter(t => !t.startsWith('-'))
    if (isDelete) {
      return names.slice(1) // the first is the remote
    }

    return names.filter(t => t.startsWith(':') && t.length > 1).map(t => t.slice(1))
  })

  return { local, remote }
}

const addNames = (list: string[] | undefined, names: string[]) => [
  ...(list ?? []),
  ...names.filter(n => !(list ?? []).includes(n)),
]

/** A GitHub write: the engine's PR report, else the `gh` command; the URL rebuilt when the output was rewritten. */
async function recordGh(
  $: $,
  command: string,
  output: string,
  dir: string,
  pr: { number: number; url?: string; action: string } | undefined,
  isFailed: boolean,
) {
  const gh = GH_WRITE.exec(command)
  if (!pr && !gh) {
    return
  }
  const noun = gh?.[1] ?? 'pr'
  const urls = [...output.matchAll(GH_URL)].map(m => m[0])
  let url = pr?.url ?? urls.find(u => /\/(?:pull|issues)\/\d+/.test(u)) ?? urls[0]
  const number =
    pr?.number ??
    (Number(
      /\bgh\s+\w+\s+\w+\s+#?(\d+)\b/.exec(command)?.[1] ??
        (url && /\/(?:pull|issues)\/(\d+)/.exec(url)?.[1]) ??
        /#(\d+)\b/.exec(output)?.[1],
    ) || undefined)
  if (!url && number && (noun === 'pr' || noun === 'issue')) {
    const { root, isRepo } = await placeOf($, await canon($, dir))
    const slug = isRepo ? await remoteOf($, root) : undefined
    if (slug) {
      url = `https://github.com/${slug}/${noun === 'pr' ? 'pull' : 'issues'}/${number}`
    }
  }
  const what = pr ? `PR #${pr.number} ${pr.action}` : `${noun} ${gh?.[2] ?? ''}${number ? ` #${number}` : ''}`
  await addGlobal($, 'github', { label: isFailed ? `${what} (command exited with an error)` : what, url })
}

async function recordRead($: $, e: Extract<ToolCallInput, { tool: 'Read' }>, ran: ToolCallResult<'Read'>) {
  if (ran.deny === undefined && !ran.isError) {
    const path = await canon($, e.file_path)
    await touch($, dirname(path), place => addUse(place, path))
  }
}

async function recordEdit($: $, e: Extract<ToolCallInput, { tool: 'Edit' }>, ran: ToolCallResult<'Edit'>) {
  const out = ran.deny === undefined && !ran.isError ? ran.result : undefined
  if (out && !out.staged) {
    const path = await canon($, out.filePath)
    await touch($, dirname(path), place =>
      addChange(place, { path, ...countHunks(out.structuredPatch) }),
    )
  }
}

async function recordWrite($: $, e: Extract<ToolCallInput, { tool: 'Write' }>, ran: ToolCallResult<'Write'>) {
  const out = ran.deny === undefined && !ran.isError ? ran.result : undefined
  if (out && !out.staged) {
    const isCreated = out.type === 'create'
    const counts = isCreated
      ? { added: out.content.replace(/\n$/, '').split('\n').length, removed: 0 }
      : countHunks(out.structuredPatch)
    const path = await canon($, out.filePath)
    await touch($, dirname(path), place =>
      addChange(place, { path, ...counts, isCreated: isCreated || undefined }),
    )
  }
}

async function recordNotebookEdit($: $, e: Extract<ToolCallInput, { tool: 'NotebookEdit' }>, ran: ToolCallResult<'NotebookEdit'>) {
  if (ran.deny === undefined && !ran.isError) {
    const path = await canon($, e.notebook_path)
    await touch($, dirname(path), place => addChange(place, { path, added: 0, removed: 0 }))
  }
}

async function recordOther($: $, e: ToolCallInput, ran: ToolCallResult) {
  if (ran.deny !== undefined || ran.isError) {
    return
  }
  if (e.tool === 'CronCreate') {
    await addGlobal($, 'scheduled', { label: `cron ${e.cron}: ${e.prompt.slice(0, 60)}` })
  } else if (e.tool === 'RemoteTrigger' && !['list', 'get', 'list_runs', 'get_run'].includes(e.action)) {
    await addGlobal($, 'scheduled', { label: `routine ${e.action}${e.trigger_id ? ` ${e.trigger_id}` : ''}` })
  } else if (e.tool === 'EnterWorktree') {
    await addGlobal($, 'scheduled', { label: `worktree ${e.name ?? e.path ?? ''}`.trim() })
  } else if (e.tool === 'WebSearch') {
    await addGlobal($, 'services', { label: `web search: ${e.query}`, isUse: true })
  } else if (e.tool === 'WebFetch') {
    await addGlobal($, 'services', { label: 'web fetch', url: e.url, isUse: true })
  } else if (e.tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = e.tool.split('__')
    const args = e as Record<string, unknown>
    const hint = ['title', 'subject', 'summary', 'name', 'query', 'q', 'to']
      .map(key => args[key])
      .find((value): value is string => typeof value === 'string')
    const isUse = ran.isReadOnly === true || MCP_READ.test(name)
    await addGlobal($, 'services', {
      label: `${server.replace(/^claude_ai_/, '')}: ${name}${hint ? ` “${hint.slice(0, 50)}”` : ''}`,
      isUse,
    })
  }
}

export const registerOutputs: Register = on => {
  on('session.start', async ($, e, next) => {
    const got = await $.process.run(['printenv', 'HOME']).catch(() => undefined)
    home = got?.stdout.trim() ?? ''
    await $.command.register({
      name: 'outputs',
      description: 'Show what this session used and produced, by directory',
    })
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'outputs' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, outputs, () => EMPTY)
      await update($, expanded, () => [])
      await refreshStatus($)

      return { text: 'Session outputs cleared.' }
    }
    await $.ui.open({ id: PANE, title: 'Outputs' })

    return { text: summary(await read($, outputs)) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const dir = await commandDir($, e.command).catch(() => undefined)
    const before = dir ? await snapshot($, dir).catch(() => undefined) : undefined
    const ran = await next(e)
    if (dir) {
      await recordBash($, e, ran, dir, before).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A turn ends: background commands no longer in flight are done.
  on('classic.Stop', async ($, e, next) => {
    const running = new Set((e.background_tasks ?? []).map(task => task.id))
    await update($, outputs, out => ({
      ...out,
      scheduled: out.scheduled.map(a =>
        a.taskId !== undefined && !a.isDone && !running.has(a.taskId) ? { ...a, isDone: true } : a,
      ),
    })).catch(() => undefined)

    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    await recordRead($, e, ran).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    await recordEdit($, e, ran).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    await recordWrite($, e, ran).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    await recordNotebookEdit($, e, ran).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  // Everything else: scheduling, the web, and MCP services.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await recordOther($, e, ran).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const out = await read($, outputs)
    const open = await read($, expanded)
    const isOpen = (key: string) => open.includes(key)
    const toggle = (key: string) => () =>
      update($, expanded, keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]))
    const every = allKeys(out)
    const isAllOpen = every.length > 0 && every.every(isOpen)
    const fold = (key: string, label: string, count: number) => (
      <Box key={`f-${key}`}>
        <Button key={key} plain label={isOpen(key) ? '▾' : '▸'} onPress={toggle(key)} />
        <Text> {label} </Text>
        <Text dimColor>{count}</Text>
      </Box>
    )
    const lines = (n: { added: number; removed: number }) => (
      <Text>
        <Text color="green">+{n.added}</Text> <Text color="red">−{n.removed}</Text>
      </Text>
    )

    if (out.places.length === 0 && out.github.length + out.services.length + out.scheduled.length === 0) {
      return <Text dimColor>Nothing used or produced yet.</Text>
    }
    const places = [...out.places.filter(isProductive), ...out.places.filter(p => !isProductive(p))]
    const made = out.services.filter(a => !a.isUse)
    const used = out.services.filter(a => a.isUse)

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Button
            key="all"
            label={isAllOpen ? 'Collapse all' : 'Expand all'}
            onPress={() => update($, expanded, () => (isAllOpen ? [] : allKeys(out)))}
          />
          <Text> </Text>
          <Button
            key="copy"
            label="Copy all"
            onPress={async press => {
              const done = await $.ui.copy({ text: report(out), surface: press.surface })
              $.ui.toast(done.isCopied ? 'Session outputs copied' : `Copy failed: ${done.reason}`)
            }}
          />
        </Box>
        {section('GitHub', out.github)}
        {section('Services', made)}
        {used.length > 0 && fold('u:services', 'services used', used.length)}
        {isOpen('u:services') && section('', used)}
        {section('Scheduled & running', out.scheduled)}
        {places.map(place => {
          const total = place.changed.reduce(
            (sum, f) => ({ added: sum.added + f.added, removed: sum.removed + f.removed }),
            { added: 0, removed: 0 },
          )
          const k = place.root
          const isQuiet = !isProductive(place)

          return (
            <Box key={k} flexDirection="column">
              <Box>
                <Button key={`p:${k}`} plain label={isOpen(`p:${k}`) ? '▾' : '▸'} onPress={toggle(`p:${k}`)} />
                <Text bold={!isQuiet} dimColor={isQuiet} wrap="truncate-start"> {short(place.root)}</Text>
                <Box flexShrink={0}>
                  {place.remote && <Text dimColor> {place.remote}</Text>}
                  {!place.isRepo && <Text dimColor> (not git)</Text>}
                  {place.changed.length > 0 && <Text>  {lines(total)}</Text>}
                </Box>
              </Box>
              {!isOpen(`p:${k}`) && (
                <Text dimColor wrap="truncate-end">
                  {'    '}
                  {counts(place)}
                </Text>
              )}
              {isOpen(`p:${k}`) && (
                <Box flexDirection="column" paddingLeft={2}>
                  {place.branches.length > 0 && (
                    <Text wrap="truncate-end">
                      branches{' '}
                      {place.branches.map((b, i) => (
                        <Text key={`b:${k}:${b}`}>
                          {i > 0 ? ', ' : ' '}
                          {place.deleted?.includes(b) ? (
                            <Text dimColor strikethrough>
                              {b}
                            </Text>
                          ) : (
                            b
                          )}
                        </Text>
                      ))}
                    </Text>
                  )}
                  {(place.deleted ?? []).some(b => !place.branches.includes(b)) && (
                    <Text wrap="truncate-end">
                      deleted{'  '}
                      <Text dimColor strikethrough>
                        {(place.deleted ?? []).filter(b => !place.branches.includes(b)).join(', ')}
                      </Text>
                    </Text>
                  )}
                  {(place.remoteDeleted?.length ?? 0) > 0 && (
                    <Text wrap="truncate-end">
                      deleted on remote{'  '}
                      <Text dimColor strikethrough>
                        {(place.remoteDeleted ?? []).join(', ')}
                      </Text>
                    </Text>
                  )}
                  {place.pushes.length > 0 && <Text>pushed  {place.pushes.join(', ')}</Text>}
                  {place.commits.map(c => (
                    <Box key={`c:${k}:${c.sha}`} flexDirection="column">
                      <Box>
                        <Button key={`s:${k}:${c.sha}`} plain label={isOpen(`s:${k}:${c.sha}`) ? '▾' : '▸'} onPress={toggle(`s:${k}:${c.sha}`)} />
                        <Box flexShrink={0}>
                          <Text color="yellow"> {c.sha}</Text>
                        </Box>
                        <Text wrap="truncate-end"> {c.subject}</Text>
                        <Box flexShrink={0}>
                          {c.branch && <Text dimColor> ({c.branch})</Text>}
                          {c.kind !== 'committed' && <Text dimColor> {c.kind}</Text>}
                        </Box>
                      </Box>
                      {isOpen(`s:${k}:${c.sha}`) &&
                        c.files.map(f => (
                          <Text key={`s:${k}:${c.sha}:${f.path}`} wrap="truncate-start">
                            {'    '}
                            {lines(f)} {f.path}
                          </Text>
                        ))}
                    </Box>
                  ))}
                  {place.changed.map(f => (
                    <Text key={`w:${k}:${f.path}`} wrap="truncate-start">
                      {lines(f)} {f.path}
                      {f.isCreated && <Text dimColor> new</Text>}
                      {f.isDeleted && <Text dimColor> deleted</Text>}
                    </Text>
                  ))}
                  {place.used.length > 0 && fold(`r:${k}`, 'read', place.used.length)}
                  {isOpen(`r:${k}`) &&
                    place.used.map(f => (
                      <Text key={`r:${k}:${f.path}`} dimColor wrap="truncate-start">
                        {'  '}
                        {f.path}
                        {f.reads > 1 ? ` ×${f.reads}` : ''}
                      </Text>
                    ))}
                  {place.commands.length > 0 && fold(`x:${k}`, 'commands', place.commands.length)}
                  {isOpen(`x:${k}`) &&
                    place.commands.map((c, i) => (
                      <Text key={`x:${k}:${i}`} color={c.isError ? 'red' : undefined} wrap="truncate-end">
                        {'  $ '}
                        {c.command.split('\n')[0]}
                        {c.isBackground ? ' &' : ''}
                      </Text>
                    ))}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )

    function section(title: string, list: Action[]) {
      if (list.length === 0) {
        return null
      }

      return (
        <Box key={`g-${title || 'used'}`} flexDirection="column" marginBottom={title ? 1 : 0}>
          {title && <Text bold>{title}</Text>}
          {list.map((a, i) => (
            <Text key={`g-${title || 'used'}-${i}`} dimColor={a.isUse || a.isDone} wrap="truncate-end">
              {'  '}
              {a.isDone ? 'done ' : ''}
              {a.label}
              {a.url ? `  ${a.url}` : ''}
            </Text>
          ))}
        </Box>
      )
    }
  })
}
