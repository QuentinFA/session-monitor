import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, ToolCallInput, ToolCallResult } from 'claude-code'

import type {
  Action,
  Activity,
  Blocked,
  Command,
  Commit,
  FileUse,
  FileChange,
  LineCount,
  Outputs,
  Place,
} from '../types'
import { MONITOR, MONITOR_TITLE } from './lib/pane'


const EMPTY: Outputs = { places: [], github: [], services: [], scheduled: [] }
const outputs = atom({ plugin: 'session-monitor', key: 'outputs' } as const, EMPTY)
const expanded = atom({ plugin: 'session-monitor', key: 'expanded' } as const, [])
const confirmReset = atom({ plugin: 'session-monitor', key: 'confirmReset' } as const, false)

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
// How core words a call the person declined at the permission prompt: an error result, not a deny.
const DECLINED = /doesn't want to proceed|tool use was rejected|user (?:rejected|declined|denied)/i
// How core words a call that needed a permission nobody granted (a headless session has no one to ask).
const NOT_GRANTED = /requested permissions? to .+ but you haven't granted it/i

type $ = EngineInterface

const activeTab = atom({ plugin: 'session-monitor', key: 'tab' } as const, 'outputs')
const homeDir = atom({ plugin: 'session-monitor', key: 'home' } as const, '')

// Module state: caches only, rebuilt after a reload.
const roots = new Map<string, { root: string; isRepo: boolean }>()
let home = ''

const dirname = (path: string) => path.replace(/\/[^/]*\/?$/, '') || '/'
const resolve = (base: string, path: string) =>
  path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path}`
const short = (path: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

/** The git root holding `dir`, or `dir` itself outside any repo. */
const placeOf = async ($: $, dir: string): Promise<{ root: string; isRepo: boolean; isRepoUnknown?: boolean }> => {
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
      roots.set(dir, place) // only a repository is cached: a "no" may be a passing failure

      return place
    }
    if (found !== undefined) {
      return { root: dir, isRepo: false } // git answered: not a repository
    }
    // Git could not run here. A missing directory (a deleted file's) is probed through its parent;
    // an existing one is left unknown rather than called "not git".
    if (probe === '/' || (await $.fs.exists(probe).catch(() => false))) {
      return { root: dir, isRepo: false, isRepoUnknown: true }
    }
    probe = dirname(probe)
  }

  return { root: dir, isRepo: false, isRepoUnknown: true }
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

/** The home directory, read once: `~` in a `cd` and in shown paths. */
const loadHome = async ($: $) => {
  if (!home) {
    home = await read($, homeDir)
  }
}

/** The directory a Bash command ran in: its `cd`s followed in order up to its `git -C`, else the session's. */
const commandDir = async ($: $, command: string) => {
  await loadHome($)
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
  await loadHome($)
  const { root, isRepo, isRepoUnknown } = await placeOf($, await canon($, dir))
  const isNew = !(await read($, outputs)).places.some(p => p.root === root)
  const remote = isNew && isRepo ? await remoteOf($, root) : undefined
  await update($, outputs, out => {
    const has = out.places.find(p => p.root === root)
    const place: Place = has ?? {
      root,
      isRepo,
      isRepoUnknown,
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
        isUncounted: had.isUncounted && change.isUncounted ? true : undefined,
      }
    : { ...change, path }

  return {
    ...place,
    changed: had ? place.changed.map(f => (f === had ? merged : f)) : [...place.changed, merged],
  }
}

const addUse = (place: Place, path: string, isBlocked = false): Place => {
  const rel = relative(place, path)
  const had = place.used.find(f => f.path === rel)
  const add = (f: FileUse): FileUse =>
    isBlocked ? { ...f, blocked: (f.blocked ?? 0) + 1 } : { ...f, reads: f.reads + 1 }

  return {
    ...place,
    used: had
      ? place.used.map(f => (f === had ? add(f) : f))
      : [...place.used, add({ path: rel, reads: 0, searches: 0 })],
  }
}

// Commands that only look: they are recorded under their directory but are not activity.
const LOOKS_ONLY =
  /^(?:ls|cat|head|tail|less|grep|rg|find|sed\s+-n|wc|pwd|echo|which|jq|tree|stat|file|diff|sleep|true|git\s+(?:status|log|diff|show|branch|remote|rev-parse|ls-files|fetch|worktree\s+list)|gh\s+(?:pr|issue|run)\s+(?:view|list|status|checks|diff))\b/
const KEPT_ACTIVITY = 40

/** Appends to the activity trail; a failure here loses the line, never the rest of the recording. */
async function logActivity($: $, kind: Activity['kind'], label: string, dir?: string) {
  try {
    const at = await $.clock.now()
    await update($, outputs, out => ({
      ...out,
      activity: [...(out.activity ?? []), { at, kind, label: label.slice(0, 120), dir }].slice(-KEPT_ACTIVITY),
    }))
  } catch {
    // The trail is a cue; the record it sits beside matters more.
  }
}

/** A command's activity line: its last step that does more than look, or nothing when every step only looks. */
const doingStep = (text: string) => {
  const steps = text
    .split(/\n|&&|\|\||;/)
    .map(step => step.trim().replace(/^cd\s+\S+$/, ''))
    .filter(Boolean)
  // A redirect to a file writes, whatever command it follows (`cat > f`); not `2>&1` or `>/dev/null`.
  const writes = (step: string) => /(?:^|[^0-9&])>>?\s*(?!&|\/dev\/null)[^\s&|;]/.test(step)
  const doing = steps.filter(step => !LOOKS_ONLY.test(step) || writes(step))

  return doing.at(-1)
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
  const { places, blocked = [] } = await read($, outputs)
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
  const parts = [
    places.length > 0 &&
      `${places.length} dir${places.length === 1 ? '' : 's'} · +${added} −${removed} · ${commits} commit${commits === 1 ? '' : 's'}`,
    blocked.length > 0 && `${blocked.length} blocked`,
  ].filter(Boolean)
  $.ui.status(parts.length === 0 ? undefined : parts.join(' · '))
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
const blockedIn = (place: Place) =>
  place.commands.filter(c => c.isBlocked).length + place.used.filter(f => f.blocked).length

/** A directory's collapsed line; what was blocked first, so a narrow pane cuts something else. */
const counts = (place: Place) =>
  [
    blockedIn(place) > 0 && `${blockedIn(place)} blocked`,
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
  'b:blocked',
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
  if (out.blocked?.length) {
    parts.push('\n## Blocked')
    for (const b of out.blocked) parts.push(`- ${b.tool} \`${b.target}\` — ${b.reason}${b.dir ? ` (${short(b.dir)})` : ''}`)
  }
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
    const kind = place.isRepo ? '' : place.isRepoUnknown ? ' (repo unknown)' : ' (not git)'
    parts.push(`\n## ${short(place.root)}${place.remote ? ` (${place.remote})` : kind}`)
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
        parts.push(`- ${f.isUncounted ? '±?' : `+${f.added} −${f.removed}`} ${f.path}${f.isCreated ? ' (new)' : ''}${f.isDeleted ? ' (deleted)' : ''}`)
    }
    if (place.used.length) {
      parts.push('\n### Read')
      for (const f of place.used) parts.push(`- ${f.path}${f.reads > 1 ? ` ×${f.reads}` : ''}${f.blocked ? ' — blocked' : ''}`)
    }
    if (place.commands.length) {
      parts.push('\n### Commands', '```sh')
      for (const c of place.commands) {
        const [first = '', ...rest] = c.command.split('\n')
        const more = rest.length ? `  # … (+${rest.length} lines)` : ''
        parts.push(`${first}${c.isBackground ? ' &' : ''}${c.isError ? '  # failed' : ''}${c.isBlocked ? '  # blocked' : ''}${more}`)
      }
      parts.push('```')
    }
  }

  return parts.length === 1 ? 'Nothing used or produced yet.' : parts.join('\n')
}

/** What a refused call would have touched, and where. */
const blockedTarget = async ($: $, tool: string, input: Record<string, unknown>) => {
  const path = [input.file_path, input.notebook_path, input.path].find(
    (value): value is string => typeof value === 'string',
  )
  if (tool === 'Bash' && typeof input.command === 'string') {
    return { target: input.command.split('\n')[0] ?? '', dir: await commandDir($, input.command) }
  }
  if (path) {
    const real = await canon($, path)

    return { target: real, dir: dirname(real) }
  }
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')

    return { target: `${server.replace(/^claude_ai_/, '')}: ${name}` }
  }

  return { target: tool }
}

/** Records a refused call once, however many routes report it. */
const recordBlocked = async ($: $, id: string, tool: string, input: Record<string, unknown>, reason: string) => {
  const { target, dir } = await blockedTarget($, tool, input)
  const entry: Blocked = { id, tool, target, reason: reason.split('\n')[0]?.slice(0, 200) ?? '', dir }
  await update($, outputs, out =>
    (out.blocked ?? []).some(b => b.id === id) ? out : { ...out, blocked: [...(out.blocked ?? []), entry] },
  )
  await refreshStatus($)
}

/** Why a call was refused, or undefined when it ran. */
const refusal = (ran: ToolCallResult) =>
  ran.deny !== undefined
    ? ran.deny
    : ran.isError && DECLINED.test(ran.text ?? '')
      ? 'declined at the permission prompt'
      : ran.isError && NOT_GRANTED.test(ran.text ?? '')
        ? 'permission not granted'
        : undefined

/**
 * A file the engine listed as changed without counting its lines: counted from git's view before and
 * after the command when it is in the command's repository, else marked uncounted.
 */
const countFromGit = async (
  $: $,
  path: string,
  before: Snapshot | undefined,
  after: Snapshot | undefined,
): Promise<FileChange> => {
  if (!before || !after || !path.startsWith(`${before.root}/`)) {
    return { path, added: 0, removed: 0, isUncounted: true }
  }
  const rel = path.slice(before.root.length + 1)
  const now = after.numstat.get(rel)
  if (now) {
    const was = before.numstat.get(rel) ?? { added: 0, removed: 0 }

    return { path, added: Math.max(0, now.added - was.added), removed: Math.max(0, now.removed - was.removed) }
  }
  if (after.untracked.has(rel) && !before.untracked.has(rel)) {
    const counted = await $.process
      .run(['git', 'diff', '--no-index', '--numstat', '/dev/null', rel], { cwd: before.root, timeoutMs: 5000 })
      .catch(() => undefined)

    return { path, added: Number(counted?.stdout.split('\t')[0]) || 0, removed: 0, isCreated: true }
  }

  return { path, added: 0, removed: 0, isUncounted: true }
}

async function recordBash(
  $: $,
  e: Extract<ToolCallInput, { tool: 'Bash' }>,
  ran: ToolCallResult<'Bash'>,
  dir: string,
  before: Snapshot | undefined,
) {
  const isBlocked = refusal(ran) !== undefined
  const text = shellText(e.command)
  const out = ran.deny !== undefined || ran.isError ? undefined : ran.result
  const command: Command = {
    command: e.command,
    description: e.description,
    isError: ran.isError && !isBlocked ? true : undefined,
    isBlocked: isBlocked || undefined,
    isBackground: e.run_in_background || out?.backgroundTaskId ? true : undefined,
  }
  await touch($, dir, place => ({
    ...place,
    commands: [...place.commands, command].slice(-MAX_COMMANDS),
  }))
  const step = isBlocked ? undefined : doingStep(text)
  if (step) {
    await logActivity($, 'ran', step, (await placeOf($, await canon($, dir))).root)
  }
  if (!out) {
    if (ran.isError && !isBlocked) {
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
          const change = await countFromGit($, path, before, after)
          await touch($, dirname(path), place => addChange(place, change))
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
      await logActivity($, 'committed', `${commit.sha} ${commit.subject}`, root)
    }
  }
  if (git?.push) {
    const branch = git.push.branch
    await touch($, dir, place =>
      place.pushes.includes(branch) ? place : { ...place, pushes: [...place.pushes, branch] },
    )
    await logActivity($, 'pushed', branch, (await placeOf($, await canon($, dir))).root)
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
    await logActivity($, 'branched', name, (await placeOf($, await canon($, dir))).root)
  }

  const gone = deletions(text)
  if (gone.local.length + gone.remote.length > 0) {
    await touch($, dir, place => ({
      ...place,
      deleted: gone.local.length ? addNames(place.deleted, gone.local) : place.deleted,
      remoteDeleted: gone.remote.length ? addNames(place.remoteDeleted, gone.remote) : place.remoteDeleted,
    }))
    const root = (await placeOf($, await canon($, dir))).root
    for (const name of gone.local) await logActivity($, 'deleted branch', name, root)
    for (const name of gone.remote) await logActivity($, 'deleted branch', `${name} on the remote`, root)
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
  await logActivity($, 'github', isFailed ? `${what} (exited with an error)` : what)
}

async function recordRead($: $, e: Extract<ToolCallInput, { tool: 'Read' }>, ran: ToolCallResult<'Read'>) {
  const isBlocked = refusal(ran) !== undefined
  if (isBlocked || (ran.deny === undefined && !ran.isError)) {
    const path = await canon($, e.file_path)
    await touch($, dirname(path), place => addUse(place, path, isBlocked))
  }
}

async function recordEdit($: $, e: Extract<ToolCallInput, { tool: 'Edit' }>, ran: ToolCallResult<'Edit'>) {
  const out = ran.deny === undefined && !ran.isError ? ran.result : undefined
  if (out && !out.staged) {
    const path = await canon($, out.filePath)
    await touch($, dirname(path), place =>
      addChange(place, { path, ...countHunks(out.structuredPatch) }),
    )
    await logActivity($, 'edited', path, (await placeOf($, dirname(path))).root)
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
    await logActivity($, isCreated ? 'created' : 'edited', path, (await placeOf($, dirname(path))).root)
  }
}

async function recordNotebookEdit($: $, e: Extract<ToolCallInput, { tool: 'NotebookEdit' }>, ran: ToolCallResult<'NotebookEdit'>) {
  if (ran.deny === undefined && !ran.isError) {
    const path = await canon($, e.notebook_path)
    await touch($, dirname(path), place => addChange(place, { path, added: 0, removed: 0 }))
  }
}

async function recordOther($: $, e: ToolCallInput, ran: ToolCallResult) {
  const reason = refusal(ran)
  if (reason !== undefined) {
    await recordBlocked($, e.tool_use_id ?? '', e.tool, e as Record<string, unknown>, reason)

    return
  }
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
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const dir = await commandDir($, e.command).catch(() => undefined)
    const before = dir ? await snapshot($, dir).catch(() => undefined) : undefined
    const ran = await next(e)
    if (dir) {
      await recordBash($, e, ran, dir, before).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // A permission rule or check refused a call: it may also come back as a deny, recorded once by id.
  on('classic.PermissionDenied', async ($, e, next) => {
    const input = typeof e.tool_input === 'object' && e.tool_input !== null ? (e.tool_input as Record<string, unknown>) : {}
    await recordBlocked($, e.tool_use_id, e.tool_name, input, e.reason).catch(() => undefined)

    return next(e)
  })

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

  // The monitor draws its tab row, then asks the chain for the body: answer on this part's tab.
  on('ui.render', { component: 'Pane', requestId: MONITOR }, async ($, e, next) =>
    (await read($, activeTab)) === 'outputs' ? drawOutputs($, e) : next(e),
  )
}

/** Clears the record: what the Outputs tab's confirmed Reset does. */
async function resetOutputs($: $) {
  await update($, outputs, () => EMPTY)
  await update($, expanded, () => [])
  await update($, confirmReset, () => false)
  await refreshStatus($)
}

/** The Outputs tab's body, drawn inside the monitor's pane. */
async function drawOutputs($: $, e: RenderInput<'Pane'>) {
  await loadHome($)
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

  const blocked = out.blocked ?? []
  if (out.places.length + blocked.length + out.github.length + out.services.length + out.scheduled.length === 0) {
    return <Text dimColor>Nothing used or produced yet.</Text>
  }
  const places = [...out.places.filter(isProductive), ...out.places.filter(p => !isProductive(p))]
  const made = out.services.filter(a => !a.isUse)
  const used = out.services.filter(a => a.isUse)
  const isConfirming = await read($, confirmReset)

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
        <Text> </Text>
        {isConfirming ? (
          <Box key="resetting">
            <Button key="reset-confirm" label="Confirm reset" variant="primary" onPress={() => resetOutputs($)} />
            <Text> </Text>
            <Button key="reset-cancel" label="Cancel" onPress={() => update($, confirmReset, () => false)} />
          </Box>
        ) : (
          <Button key="reset" label="Reset" onPress={() => update($, confirmReset, () => true)} />
        )}
      </Box>
      {blocked.length > 0 && (
        <Box key="blocked" flexDirection="column" marginBottom={1}>
          <Box>
            <Button key="b:blocked" plain label={isOpen('b:blocked') ? '▾' : '▸'} onPress={toggle('b:blocked')} />
            <Text bold color="red">
              {' '}
              Blocked{' '}
            </Text>
            <Text color="red">{blocked.length}</Text>
          </Box>
          {isOpen('b:blocked') &&
            blocked.map(b => (
            <Box key={`blocked:${b.id}`} flexDirection="column">
              <Text color="red" wrap="truncate-end">
                {'  ✗ '}
                {b.tool} {b.target}
              </Text>
              <Text dimColor wrap="truncate-end">
                {'    '}
                {b.reason}
                {b.dir ? ` · ${short(b.dir)}` : ''}
              </Text>
            </Box>
            ))}
        </Box>
      )}
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
                {!place.isRepo && <Text dimColor>{place.isRepoUnknown ? ' (repo unknown)' : ' (not git)'}</Text>}
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
                    {f.isUncounted ? <Text dimColor>±?</Text> : lines(f)} {f.path}
                    {f.isCreated && <Text dimColor> new</Text>}
                    {f.isDeleted && <Text dimColor> deleted</Text>}
                  </Text>
                ))}
                {place.used.length > 0 && fold(`r:${k}`, 'read', place.used.length)}
                {isOpen(`r:${k}`) &&
                  place.used.map(f => (
                    <Text
                      key={`r:${k}:${f.path}`}
                      color={f.blocked ? 'red' : undefined}
                      dimColor={!f.blocked}
                      wrap="truncate-start"
                    >
                      {f.blocked ? '✗ ' : '  '}
                      {f.path}
                      {f.reads > 1 ? ` ×${f.reads}` : ''}
                      {f.blocked ? '  blocked' : ''}
                    </Text>
                  ))}
                {place.commands.length > 0 && fold(`x:${k}`, 'commands', place.commands.length)}
                {isOpen(`x:${k}`) &&
                  place.commands.map((c, i) => (
                    <Text key={`x:${k}:${i}`} color={c.isError || c.isBlocked ? 'red' : undefined} wrap="truncate-end">
                      {c.isBlocked ? '  ✗ ' : '  $ '}
                      {c.command.split('\n')[0]}
                      {c.isBackground ? ' &' : ''}
                      {c.isBlocked ? '  blocked' : ''}
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
}
