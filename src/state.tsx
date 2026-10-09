import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Now, Outputs, Position, Turn } from '../types'
import { MONITOR } from './lib/pane'
import { parsePr, parseStatus, readAnswer } from './lib/position'

type $ = EngineInterface

const activeTab = atom({ plugin: 'session-monitor', key: 'tab' } as const, 'outputs')
const position = atom({ plugin: 'session-monitor', key: 'position' } as const, null)
const turns = atom({ plugin: 'session-monitor', key: 'turns' } as const, [])
const now = atom({ plugin: 'session-monitor', key: 'now' } as const, null)
const EMPTY_OUTPUTS: Outputs = { places: [], github: [], services: [], scheduled: [] }
const outputs = atom({ plugin: 'session-monitor', key: 'outputs' } as const, EMPTY_OUTPUTS)

const REFRESH_MS = 60_000
const KEPT_TURNS = 6
const GIT_OR_GH = /(^|[\s;&|(])(git|gh)\s/

// Module state: reset on a reload, when the engine also drops the old timer.
let isTimerStarted = false
let isRefreshing = false

/** Reads the working directory's git state and its branch's pull request. */
async function refresh($: $) {
  if (isRefreshing) {
    return
  }
  isRefreshing = true
  try {
    const dir = await $.session.cwd()
    const status = await $.process
      .run(['git', 'status', '--porcelain=v1', '--branch'], { cwd: dir, timeoutMs: 5000 })
      .catch(() => undefined)
    const readAt = await $.clock.now()
    if (status?.exitCode !== 0) {
      await update($, position, () => ({ dir, isRepo: false, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, readAt }))

      return
    }
    const next: Position = { dir, isRepo: true, ...parseStatus(status.stdout), readAt }
    const fields = 'number,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup'
    const pr = await $.process.run(['gh', 'pr', 'view', '--json', fields], { cwd: dir, timeoutMs: 15000 }).catch(() => undefined)
    if (pr?.exitCode === 0) {
      next.pr = parsePr(pr.stdout)
    } else if (!/no (?:pull requests|open pull requests) found/i.test(pr?.stderr ?? '')) {
      next.prError = (pr?.stderr.trim().split('\n')[0] || 'gh could not be run').slice(0, 120)
    }
    await update($, position, () => next)
  } finally {
    isRefreshing = false
  }
}

/** Starts the periodic refresh once per load, on the first event the part sees. */
function startTimer($: $) {
  if (!isTimerStarted) {
    isTimerStarted = true
    $.clock.every(REFRESH_MS, () => {
      void refresh($).catch(() => undefined)
    })
    void refresh($).catch(() => undefined)
  }
}

const ago = (at: number, from: number) => {
  const s = Math.max(0, Math.round((from - at) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** A tool and its subject, in a few words. */
const describeTool = (tool: string, input: Record<string, unknown>) => {
  const subject = [input.description, input.command, input.file_path, input.pattern, input.url, input.query].find(
    (v): v is string => typeof v === 'string',
  )

  return subject ? `${tool}: ${subject.split('\n')[0]?.slice(0, 60)}` : tool
}

const KIND_WIDTH = 10
const SHOWN_ACTIVITY = 4

/** A path inside `dir` as a relative one. */
const within = (label: string, dir?: string) => (dir && label.startsWith(`${dir}/`) ? label.slice(dir.length + 1) : label)
const base = (dir?: string) => dir?.split('/').filter(Boolean).at(-1)

/** Position in one line: quiet when normal. */
const positionLine = (pos: Position | null) => {
  if (!pos) return 'not read yet'
  if (!pos.isRepo) return 'not a git repository'
  const changed = pos.staged + pos.unstaged + pos.untracked
  const pr = pos.pr
  const prText = pr
    ? `#${pr.number} ${pr.isDraft ? 'draft' : pr.state.toLowerCase()}${pr.failing ? ` ✗${pr.failing}` : pr.pending ? ` …${pr.pending}` : pr.passing ? ' ✓' : ''}`
    : pos.prError
      ? 'PR unknown'
      : 'no PR'

  return [
    `${pos.branch ?? '(detached)'}${pos.ahead ? ` ↑${pos.ahead}` : ''}${pos.behind ? ` ↓${pos.behind}` : ''}`,
    changed ? `${changed} changed` : 'clean',
    prText,
  ].join(' · ')
}

/** The State tab's body: what a person returning to the session needs, exceptions first. */
async function drawState($: $, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const pos = await read($, position)
  const history = await read($, turns)
  const current = await read($, now)
  const out = await read($, outputs)
  const at = await $.clock.now()
  const last = history.at(-1)

  // The state label leads: what the session is doing, and for how long.
  const label = !current
    ? { text: 'No turn yet', color: undefined }
    : current.isWorking
      ? { text: `Working · ${ago(current.since, at)}${current.tool ? ` · ${current.tool}` : ''}`, color: 'cyan' }
      : last?.reason === 'interrupted'
        ? { text: `Interrupted · ${ago(current.since, at)} ago`, color: 'yellow' }
        : last?.reason === 'error' || last?.reason === 'refusal'
          ? { text: `Stopped: ${last.reason} · ${ago(current.since, at)} ago`, color: 'red' }
          : { text: `Waiting on you · ${ago(current.since, at)}`, color: undefined }

  // What needs the person: each says the decision or the fact, and where it comes from.
  const needs: { text: string; color: string }[] = []
  if (current?.asking) needs.push({ text: `Claude is asking: ${current.asking}`, color: 'yellow' })
  if (!current?.isWorking && last?.question) needs.push({ text: `Claude asked: ${last.question}`, color: 'yellow' })
  const pr = pos?.pr
  if (pr?.failing) needs.push({ text: `#${pr.number}: ${pr.failing} check${pr.failing === 1 ? '' : 's'} failing — ${pr.failingNames.join(', ')}`, color: 'red' })
  if (pr?.mergeable === 'CONFLICTING') needs.push({ text: `#${pr.number} has merge conflicts`, color: 'red' })
  if (pr?.reviewDecision === 'CHANGES_REQUESTED') needs.push({ text: `#${pr.number}: changes requested`, color: 'yellow' })
  if (pos?.behind) needs.push({ text: `${pos.behind} behind ${pos.upstream ?? 'upstream'}`, color: 'yellow' })
  const blocked = out.blocked?.length ?? 0
  if (blocked) needs.push({ text: `${blocked} blocked call${blocked === 1 ? '' : 's'} → Outputs`, color: 'yellow' })

  const asked = last?.prompt
  const askedStatus = !last ? '' : !last.endedAt ? 'in progress' : (last.reason ?? 'answered')
  const trail = (out.activity ?? []).slice(-SHOWN_ACTIVITY)
  const running = out.scheduled.filter(a => a.taskId && !a.isDone)

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={label.color} wrap="truncate-end">
          {label.text}
        </Text>
        <Box flexGrow={1} />
        <Box flexShrink={0}>
          <Text dimColor>
            {positionLine(pos)}
            {pos ? ` · ${ago(pos.readAt, at)}` : ''}{' '}
          </Text>
          <Button key="state-refresh" plain label="↻" onPress={() => refresh($)} />
        </Box>
      </Box>

      {needs.length > 0 && (
        <Box key="needs" flexDirection="column" marginTop={1}>
          <Text bold>Needs you</Text>
          {needs.map((n, i) => (
            <Text key={`need:${i}`} color={n.color} wrap="truncate-end">
              {'  • '}
              {n.text}
            </Text>
          ))}
        </Box>
      )}

      {asked && (
        <Box key="asked" marginTop={1}>
          <Text wrap="truncate-end">
            <Text bold>You asked </Text>“{asked}”<Text dimColor> — {askedStatus}</Text>
          </Text>
        </Box>
      )}

      {trail.length > 0 && (
        <Box key="trail" flexDirection="column" marginTop={1}>
          <Text bold>Last activity</Text>
          {trail.map((a, i) => (
            <Box key={`act:${i}`}>
              <Text dimColor>{'  '}{a.kind.padEnd(KIND_WIDTH)}</Text>
              <Text wrap="truncate-end">{within(a.label, a.dir)}</Text>
              <Box flexGrow={1} />
              <Box flexShrink={0}>
                <Text dimColor>
                  {a.dir && a.dir !== pos?.dir && !pos?.dir?.startsWith(`${a.dir}/`) ? ` ${base(a.dir)}` : ''} {ago(a.at, at)}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {running.length > 0 && (
        <Box key="running" flexDirection="column" marginTop={1}>
          <Text bold>Running</Text>
          {running.map((a, i) => (
            <Text key={`run:${i}`} wrap="truncate-end">
              {'  • '}
              {a.label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export const registerState: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    startTimer($)
    const at = await $.clock.now()
    await update($, now, () => ({ isWorking: true, since: at }))
    const prompt = e.text.trim().split('\n')[0]?.slice(0, 160)
    await update($, turns, list => [...list, { startedAt: at, prompt }].slice(-KEPT_TURNS))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Outputs holds the plugin's one unmatched tool.call; this one matches every tool by pattern.
  on('tool.call', { tool: /^/ }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    startTimer($)
    const input = e as Record<string, unknown>
    const asking =
      e.tool === 'AskUserQuestion'
        ? ((input.questions as { question?: string }[] | undefined)?.[0]?.question ?? 'a question')
        : undefined
    await update($, now, n => ({ isWorking: true, since: n?.since ?? 0, tool: describeTool(e.tool, input), asking })).catch(
      () => undefined,
    )
    const ran = await next(e)
    await update($, now, n => (n ? { ...n, tool: undefined, asking: undefined } : n)).catch(() => undefined)
    if (e.tool === 'Bash' && typeof input.command === 'string' && GIT_OR_GH.test(input.command)) {
      void refresh($).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      const reason = e.reason === 'answer' ? undefined : e.isAborted ? 'interrupted' : e.reason
      const answer = readAnswer(e.answer)
      await update($, turns, list => {
        const open = list.at(-1)
        const startedAt = open && !open.endedAt ? open.startedAt : at - e.durationMs
        const turn: Turn = { startedAt, prompt: open && !open.endedAt ? open.prompt : undefined, endedAt: at, durationMs: e.durationMs, reason, ...answer }

        return open && !open.endedAt ? [...list.slice(0, -1), turn] : [...list, turn].slice(-KEPT_TURNS)
      }).catch(() => undefined)
      await update($, now, (): Now => ({ isWorking: false, since: at })).catch(() => undefined)
      startTimer($)
      void refresh($).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: MONITOR }, async ($, e, next) =>
    (await read($, activeTab)) === 'state' ? drawState($, e) : next(e),
  )
}
