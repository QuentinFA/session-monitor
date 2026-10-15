import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import { bar, compact, duration, resetsAt } from './lib/format'
import { MONITOR } from './lib/pane'
import { shortPath } from './lib/repos'

type $ = EngineInterface

const activeTab = atom({ plugin: 'session-monitor', key: 'tab' } as const, 'outputs')
const homeDir = atom({ plugin: 'session-monitor', key: 'home' } as const, '')
const statsDefs = atom({ plugin: 'session-monitor', key: 'statsDefs' } as const, true)
const statsBreakdown = atom({ plugin: 'session-monitor', key: 'statsBreakdown' } as const, false)
const transcript = atom({ plugin: 'session-monitor', key: 'transcript' } as const, '')

/** Transcript lines read from its end to find the last request; a tool's output can fill many. */
const TAIL_LINES = 200
const LABEL = 13
const VALUE = 9

const LIMITS: Record<string, { label: string; meaning: string }> = {
  five_hour: { label: '5-hour limit', meaning: "Your plan's usage in the rolling 5-hour window." },
  seven_day: { label: 'Weekly limit', meaning: "Your plan's usage over the rolling 7 days." },
  spend_limit: { label: 'Spend limit', meaning: "Spending against the gateway's limit." },
}

type CacheState = {
  /** When the main conversation's last request was answered. */
  lastAt: number
  /** The lifetime its latest cache write used: the engine reports it to plugins only on a model switch. */
  ttl?: '5m' | '1h'
}

type Tally = { input: number; cacheWrite: number; cacheRead: number; output: number }

// Module state: caches only, rebuilt after a reload.
let cacheState: { path: string; value: CacheState | null } | undefined
let ticking = false
/** Per transcript file: how far it was read, the responses counted, and their tokens. */
const tallies = new Map<string, { offset: number; seen: Set<string>; tokens: Tally }>()
let isTallyStale = true
/** The transcript found from the session id: kept here, as a drawing may not write state. */
let foundPath = ''

/** Bytes read from a transcript at a time: a process's output is cut at 4 MiB. */
const CHUNK = 3_000_000

/**
 * The session's transcript: the path the last prompt reported, or else the file named after the
 * session's id under the projects folder — found once, so the tab needs no prompt to begin.
 */
async function transcriptOf($: $): Promise<string> {
  const known = (await read($, transcript)) || foundPath
  if (known) {
    return known
  }
  const id = await $.session.id().catch(() => '')
  const home = await read($, homeDir)
  if (!id || !home) {
    return ''
  }
  const found = await $.process
    .run(['find', `${home}/.claude/projects`, '-maxdepth', '2', '-name', `${id}.jsonl`], { timeoutMs: 5000 })
    .catch(() => undefined)
  const path = found?.exitCode === 0 ? (found.stdout.split('\n')[0] ?? '') : ''
  foundPath = path

  return path
}

/**
 * The tokens of every response in the transcript and its subagents' — each response once, though the
 * transcript writes one line per content block. Read on from where the last reading stopped.
 */
async function readTally($: $, path: string): Promise<Tally> {
  if (isTallyStale) {
    const listed = await $.process
      .run(['find', path.replace(/\.jsonl$/, ''), '-path', '*/subagents/*', '-name', '*.jsonl'], { timeoutMs: 5000 })
      .catch(() => undefined)
    const files = [path, ...(listed?.exitCode === 0 ? listed.stdout.split('\n').filter(Boolean) : [])]
    for (const file of files) {
      await readOn($, file).catch(() => undefined)
    }
    isTallyStale = false
  }
  const sum: Tally = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
  for (const [file, { tokens }] of tallies) {
    if (file === path || file.startsWith(path.replace(/\.jsonl$/, '/'))) {
      sum.input += tokens.input
      sum.cacheWrite += tokens.cacheWrite
      sum.cacheRead += tokens.cacheRead
      sum.output += tokens.output
    }
  }

  return sum
}

/** Reads a transcript file from where it was left, whole lines only, a chunk at a time. */
async function readOn($: $, file: string) {
  const tally = tallies.get(file) ?? {
    offset: 0,
    seen: new Set<string>(),
    tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
  }
  tallies.set(file, tally)
  for (;;) {
    const got = await $.process.run(
      ['sh', '-c', 'tail -c "+$1" "$2" | head -c "$3"', 'sh', String(tally.offset + 1), file, String(CHUNK)],
      { timeoutMs: 20000 },
    )
    if (got.exitCode !== 0) {
      return
    }
    const end = got.stdout.lastIndexOf('\n')
    if (end < 0) {
      if (got.stdout.length < CHUNK / 4) {
        return // the last line is still being written
      }
      // One line longer than a chunk — a tool's output, no usage in it: step over what was read.
      tally.offset += new TextEncoder().encode(got.stdout).length
      continue
    }
    const whole = got.stdout.slice(0, end + 1)
    for (const line of whole.split('\n')) {
      const entry = parseLine(line)
      const id = entry?.message?.id
      const usage = entry?.message?.usage
      if (entry?.type !== 'assistant' || !id || !usage || tally.seen.has(id)) {
        continue
      }
      tally.seen.add(id)
      tally.tokens.input += usage.input_tokens ?? 0
      tally.tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0
      tally.tokens.cacheRead += usage.cache_read_input_tokens ?? 0
      tally.tokens.output += usage.output_tokens ?? 0
    }
    tally.offset += new TextEncoder().encode(whole).length
    if (got.stdout.length < CHUNK / 4) {
      return // short of a full chunk even in four-byte characters: the end is reached
    }
  }
}

const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

/**
 * The last request and its cache lifetime, from the end of the transcript: each API response there
 * keeps its usage whole, cache writes split into `ephemeral_5m_input_tokens` and
 * `ephemeral_1h_input_tokens`. A subagent's requests have their own cache, and are left out.
 */
async function readCacheState($: $, path: string): Promise<CacheState | null> {
  if (cacheState?.path === path) {
    return cacheState.value
  }
  const got = await $.process.run(['tail', '-n', String(TAIL_LINES), path], { timeoutMs: 5000 }).catch(() => undefined)
  let value: CacheState | null = null
  if (got?.exitCode === 0) {
    for (const line of got.stdout.split('\n').reverse()) {
      const entry = parseLine(line)
      const usage = entry?.message?.usage
      if (!entry || entry.type !== 'assistant' || entry.isSidechain || !usage) {
        continue
      }
      value ??= { lastAt: Date.parse(entry.timestamp ?? '') }
      const written = usage.cache_creation
      if ((written?.ephemeral_1h_input_tokens ?? 0) > 0) {
        value.ttl = '1h'
      } else if ((written?.ephemeral_5m_input_tokens ?? 0) > 0) {
        value.ttl = '5m'
      }
      if (value.ttl) {
        break
      }
    }
  }
  if (value && Number.isNaN(value.lastAt)) {
    value = null
  }
  cacheState = { path, value }

  return value
}

type TranscriptLine = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: {
    id?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
    }
  }
}

function parseLine(line: string): TranscriptLine | undefined {
  try {
    return line ? (JSON.parse(line) as TranscriptLine) : undefined
  } catch {
    return undefined
  }
}

const clockTime = (ms: number) => {
  const at = new Date(ms)

  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** How long the cache stays warm after the last request, or since when it has gone cold. */
function warmth(state: CacheState, now: number): string {
  if (!state.ttl) {
    return 'lifetime not found in the transcript'
  }
  const until = state.lastAt + TTL_MS[state.ttl]
  const left = until - now

  return left > 0
    ? `${state.ttl} cache · warm until ${clockTime(until)} (${duration(left)} left)`
    : `${state.ttl} cache · expired ${duration(-left)} ago: the next request writes it again`
}

/** The countdown moves on its own: the tab is drawn again every half minute while shown. */
function startTicking($: $) {
  if (ticking) {
    return
  }
  try {
    $.clock.every(30_000, () => {
      read($, activeTab)
        .then(tab => tab === 'stats' && $.ui.invalidate('ui.render'))
        .catch(() => undefined)
    })
    ticking = true
  } catch {
    // no clock: the tab moves when drawn
  }
}

export const registerStats: Register = on => {
  // A prompt names the transcript the turn writes to: where the cache's lifetime is read.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    try {
      startTicking($)
      if (e.transcript_path) {
        await update($, transcript, () => e.transcript_path)
      }
    } catch {
      // recording never fails the turn
    }

    return next(e)
  })

  // A turn ends: the engine's figures moved, so the tab is drawn again when shown.
  on('turn.complete', async ($, e, next) => {
    try {
      cacheState = undefined // the turn's requests are in the transcript now
      isTallyStale = true
      startTicking($)
      if ((await read($, activeTab)) === 'stats') {
        $.ui.invalidate('ui.render')
      }
    } catch {
      // drawing again never fails the turn
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: MONITOR }, async ($, e, next) =>
    (await read($, activeTab)) === 'stats' ? drawStats($, e) : next(e),
  )
}

/** The Stats tab's body: what the status line shows, each figure with what it means. */
async function drawStats($: $, e: RenderInput<'Pane'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isBroken = await read($, statsBreakdown)
  const now = await $.clock.now().catch(() => 0)
  // The breakdown, estimated locally, carries the last request's cache figures as well.
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const turns = await $.session.turns().catch(() => undefined)
  const showDefs = await read($, statsDefs)
  const path = await transcriptOf($)
  const cache = path ? await readCacheState($, path) : null
  const tally = path ? await readTally($, path).catch(() => undefined) : undefined
  const model = await $.session.model().catch(() => '')
  const cwd = await $.session.cwd().catch(() => '')
  const home = await read($, homeDir)

  // One stat: label, value and its bar on the first line; details, then the definition, under it,
  // wrapped, so a narrow pane cuts none of them.
  const barWidth = Math.max(5, Math.min(30, e.props.bodyColumns - LABEL - VALUE - 2))
  const row = (
    key: string,
    label: string,
    value: unknown,
    more: { percent?: number; detail?: string | string[]; meaning: string; extra?: unknown },
  ) => {
    const b = more.percent === undefined ? undefined : bar(more.percent, barWidth)

    return (
      <Box key={`stat:${key}`} flexDirection="column" marginBottom={showDefs ? 1 : 0}>
        <Box>
          <Box width={LABEL} flexShrink={0}>
            <Text bold>{label}</Text>
          </Box>
          <Box width={VALUE} flexShrink={0} justifyContent="flex-end">
            {typeof value === 'string' ? <Text>{value}</Text> : (value as never)}
          </Box>
          {b && (
            <Text wrap="truncate-end">
              {'  '}
              <Text color={b.color}>{b.filled}</Text>
              <Text dimColor>{b.empty}</Text>
            </Text>
          )}
        </Box>
        {[more.detail ?? []].flat().map((line, i) => (
          <Box key={`d:${key}:${i}`} paddingLeft={2}>
            <Text dimColor>{line}</Text>
          </Box>
        ))}
        {showDefs && (
          <Box paddingLeft={2}>
            <Text dimColor italic>
              {more.meaning}
            </Text>
          </Box>
        )}
        {more.extra as never}
      </Box>
    )
  }

  const context = usage?.context
  const last = context?.breakdown?.apiUsage
  const sent = last ? last.input_tokens + last.cache_read_input_tokens + last.cache_creation_input_tokens : 0
  const limits = usage?.rateLimits ?? []

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Button
          key="defs"
          label={showDefs ? 'Hide definitions' : 'Show definitions'}
          onPress={() => update($, statsDefs, shown => !shown)}
        />
      </Box>
      {context &&
        row(
          'context',
          'Context',
          `${context.percent ?? 0}%`,
          {
            percent: context.percent ?? 0,
            detail: `${compact(context.tokens ?? 0)} of ${compact(context.window)} tokens`,
            meaning: 'What the model rereads each turn; near full, older turns get summarised.',
            extra: <Box key="breakdown" flexDirection="column" paddingLeft={2}>
            <Button
              key="breakdown"
              plain
              dimColor
              label={isBroken ? '▾ breakdown' : '▸ breakdown'}
              onPress={() => update($, statsBreakdown, open => !open)}
            />
            {isBroken &&
              (context.breakdown?.categories ?? []).map(c => (
                <Box key={`cat:${c.name}`}>
                  <Box width={LABEL + VALUE - 2} flexShrink={0}>
                    <Text dimColor={c.kind !== 'used'} wrap="truncate-end">
                      {c.name}
                    </Text>
                  </Box>
                  <Text dimColor>
                    {compact(c.tokens).padStart(7)}
                    {context.breakdown ? `  ${Math.round((c.tokens / context.breakdown.rawMaxTokens) * 100)}%` : ''}
                  </Text>
                </Box>
              ))}
          </Box>,
          },
        )}
      {limits.map(limit => {
        const known = LIMITS[limit.kind] ?? { label: limit.kind, meaning: 'A usage window the API reported.' }

        return row(
          `limit:${limit.kind}`,
          known.label,
          `${limit.percentUsed}%`,
          {
            percent: limit.percentUsed,
            detail: limit.resetsAt && now ? resetsAt(limit.resetsAt, now) : undefined,
            meaning: known.meaning,
          },
        )
      })}
      {limits.length === 0 &&
        row('limits', 'Plan limits', '—', {
          detail: 'not reported yet',
          meaning: 'Reported with each answer on a subscription plan; none on an API key.',
        })}
      {usage?.cost &&
        row('cost', 'Cost', `$${usage.cost.usd.toFixed(2)}`, {
          detail: tally
            ? `tokens: ${compact(tally.input + tally.cacheWrite)} in · ${compact(tally.cacheRead)} cache read · ${compact(tally.output)} out`
            : undefined,
          meaning:
            "This session's calls at API prices; a subscription is not billed by it. Tokens from the transcript.",
        })}
      {last &&
        sent > 0 &&
        row(
          'cache',
          'Prompt cache',
          `${((last.cache_read_input_tokens / sent) * 100).toFixed(1)}%`,
          {
            detail: [
              `last request: ${compact(last.cache_read_input_tokens)} read · ${compact(last.cache_creation_input_tokens)} written · ${compact(last.input_tokens)} new`,
              ...(cache && now ? [warmth(cache, now)] : []),
            ],
            meaning: 'Share of the last request read from cache: cheaper and faster. It stays warm 5 min or 1 h after a request.',
          },
        )}
      {row(
        'session',
        'Session',
        usage && now ? duration(now - usage.startedAt) : '—',
        {
          detail: [model, turns === undefined ? '' : `${turns} ${turns === 1 ? 'prompt' : 'prompts'}`, shortPath(home, cwd)]
            .filter(Boolean)
            .join(' · '),
          meaning: 'Time since the session started, its model, your prompts, its directory.',
        },
      )}
    </Box>
  )
}
