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

const clockTime = (at: number) => {
  const d = new Date(at)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** A tool and its subject, in a few words. */
const describeTool = (tool: string, input: Record<string, unknown>) => {
  const subject = [input.description, input.command, input.file_path, input.pattern, input.url, input.query].find(
    (v): v is string => typeof v === 'string',
  )

  return subject ? `${tool}: ${subject.split('\n')[0]?.slice(0, 60)}` : tool
}

/** The State tab's body. */
async function drawState($: $, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const pos = await read($, position)
  const history = await read($, turns)
  const current = await read($, now)
  const blocked = (await read($, outputs)).blocked?.length ?? 0
  const at = await $.clock.now()
  const last = history.at(-1)

  // What waits on the person, each with where it comes from.
  const needs: string[] = []
  if (current?.asking) needs.push(`Claude is asking: ${current.asking}`)
  if (!current?.isWorking && last?.question) needs.push(`Claude's last answer ends on a question: ${last.question}`)
  if (pos?.pr?.failing) needs.push(`${pos.pr.failing} check${pos.pr.failing === 1 ? '' : 's'} failing on #${pos.pr.number}: ${pos.pr.failingNames.join(', ')}`)
  if (pos?.pr?.reviewDecision === 'CHANGES_REQUESTED') needs.push(`Changes requested on #${pos.pr.number}`)
  if (pos?.pr?.mergeable === 'CONFLICTING') needs.push(`#${pos.pr.number} has merge conflicts`)
  if (blocked > 0) needs.push(`${blocked} call${blocked === 1 ? '' : 's'} blocked this session (see Outputs)`)

  const prLine = (pr: NonNullable<Position['pr']>) => {
    const checks = [pr.failing && `${pr.failing} failing`, pr.pending && `${pr.pending} pending`, pr.passing && `${pr.passing} passing`]
      .filter(Boolean)
      .join(', ')
    const review = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' }[pr.reviewDecision]

    return [`#${pr.number} ${pr.isDraft ? 'draft' : pr.state.toLowerCase()}`, review, checks ? `checks: ${checks}` : 'no checks']
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Button key="state-refresh" label="Refresh" onPress={() => refresh($)} />
        <Text dimColor>{pos ? `  read ${ago(pos.readAt, at)} ago` : '  not read yet'}</Text>
      </Box>

      <Text bold>Position</Text>
      {!pos ? (
        <Text dimColor>  Read at the first event of the session, or with Refresh.</Text>
      ) : !pos.isRepo ? (
        <Text dimColor wrap="truncate-start">  {pos.dir} is not a git repository</Text>
      ) : (
        <Box flexDirection="column" paddingLeft={2}>
          <Text wrap="truncate-end">
            <Text bold>{pos.branch ?? '(detached)'}</Text>
            {pos.upstream ? <Text dimColor> → {pos.upstream}</Text> : <Text dimColor> no upstream</Text>}
            {pos.ahead > 0 && <Text color="yellow"> ↑{pos.ahead}</Text>}
            {pos.behind > 0 && <Text color="yellow"> ↓{pos.behind}</Text>}
          </Text>
          <Text dimColor={pos.staged + pos.unstaged + pos.untracked === 0}>
            {pos.staged + pos.unstaged + pos.untracked === 0
              ? 'clean'
              : [pos.staged && `${pos.staged} staged`, pos.unstaged && `${pos.unstaged} modified`, pos.untracked && `${pos.untracked} untracked`]
                  .filter(Boolean)
                  .join(' · ')}
          </Text>
          {pos.pr ? (
            <Text color={pos.pr.failing ? 'red' : undefined} wrap="truncate-end">
              {prLine(pos.pr)}
            </Text>
          ) : pos.prError ? (
            <Text dimColor wrap="truncate-end">PR unknown: {pos.prError}</Text>
          ) : (
            <Text dimColor>no pull request for this branch</Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text bold>Now  </Text>
        {!current ? (
          <Text dimColor>no turn yet</Text>
        ) : current.isWorking ? (
          <Text color="cyan" wrap="truncate-end">
            Claude is working · {ago(current.since, at)}
            {current.tool ? ` · ${current.tool}` : ''}
          </Text>
        ) : (
          <Text>waiting on you since {clockTime(current.since)}</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color={needs.length ? 'yellow' : undefined}>
          Needs you
        </Text>
        {needs.length === 0 ? (
          <Text dimColor>  nothing found</Text>
        ) : (
          needs.map((n, i) => (
            <Text key={`need:${i}`} color="yellow" wrap="truncate-end">
              {'  • '}
              {n}
            </Text>
          ))
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Recently done</Text>
        {history.filter(t => t.endedAt).length === 0 ? (
          <Text dimColor>  no finished turn yet</Text>
        ) : (
          [...history]
            .filter(t => t.endedAt)
            .reverse()
            .map(t => (
              <Text key={`turn:${t.startedAt}`} wrap="truncate-end">
                <Text dimColor>
                  {'  '}
                  {clockTime(t.startedAt)} · {ago(0, t.durationMs ?? (t.endedAt ?? t.startedAt) - t.startedAt)}
                  {t.reason ? ` · ${t.reason}` : ''}
                  {'  '}
                </Text>
                {t.summary ?? ''}
              </Text>
            ))
        )}
      </Box>
    </Box>
  )
}

export const registerState: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    startTimer($)
    const at = await $.clock.now()
    await update($, now, () => ({ isWorking: true, since: at }))
    await update($, turns, list => [...list, { startedAt: at }].slice(-KEPT_TURNS))

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
        const turn: Turn = { startedAt, endedAt: at, durationMs: e.durationMs, reason, ...answer }

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
