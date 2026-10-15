import type { On } from 'claude-code'

import { bar, compact, duration, resetsAt } from '../src/lib/format'
import { describe, expect, test } from 'claude-code/testing'

// The test's own hooks stand for the engine: the session's usage, model and directory, the clock,
// and git in the working directory.

const NOW = Date.parse('2026-10-15T10:00:00')

/** One API response as the transcript keeps it. */
const response = (agoMs: number, write: { '5m'?: number; '1h'?: number }, isSidechain = false, id = `m${agoMs}`) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain,
    timestamp: new Date(NOW - agoMs).toISOString(),
    message: {
      id,
      usage: {
        output_tokens: 100,
        input_tokens: 2,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: (write['5m'] ?? 0) + (write['1h'] ?? 0),
        cache_creation: { ephemeral_5m_input_tokens: write['5m'] ?? 0, ephemeral_1h_input_tokens: write['1h'] ?? 0 },
      },
    },
  })

const LAST = { input_tokens: 2, output_tokens: 300, cache_read_input_tokens: 118_000, cache_creation_input_tokens: 1_500 }

function host(on: On, usage: Record<string, unknown> = {}, lines: string[] = [], subagent: string[] = []) {
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW - 92 * 60_000,
      context: { tokens: 124_000, window: 200_000, percent: 62 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-15T12:10:00' }],
      cost: { usd: 4.123 },
      ...usage,
    },
  }))
  on('classic.UserPromptSubmit', () => ({}))
  on('process.run', (_$, e) => {
    const [command, ...args] = e.argv
    const file = command === 'sh' ? args[4] : ''
    const offset = command === 'sh' ? Number(args[3]) - 1 : 0
    const text = (path: string | undefined) =>
      `${(path?.includes('/subagents/') ? subagent : lines).join('\n')}\n`.slice(offset)
    const stdout =
      command === 'printenv'
        ? '/home/me\n'
        : command === 'tail'
        ? text(args.at(-1))
        : command === 'sh'
          ? text(file)
          : command === 'find' && args.includes('-name') && args.at(-1) === 'abc.jsonl'
            ? '/home/me/.claude/projects/-work-app/abc.jsonl\n'
            : command === 'find' && subagent.length > 0
              ? '/home/me/.claude/projects/-work-app/abc/subagents/agent-1.jsonl\n'
              : ''

    return { value: {
      exitCode: 0,
      stdout,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    } }
  })
  on('turn.complete', () => ({ text: '' }))
}

async function mount($: Parameters<Parameters<typeof test>[1]>[0], bodyColumns = 100) {
  const ui = await $.ui.mount({
    plugin: 'session-monitor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-monitor',
    props: {
      title: 'Session monitor',
      isFocused: true,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  })
  await ui.press({ key: 'tab:stats' })

  return ui
}

describe('formatting', () => {
  test('counts in a few characters', async () => {
    expect([950, 1234, 12_400, 124_000, 1_200_000, 2_000_000].map(compact)).toEqual([
      '950',
      '1.2k',
      '12k',
      '124k',
      '1.2M',
      '2M',
    ])
  })

  test('times in their two largest units', async () => {
    expect([42_000, 185_000, 92 * 60_000, 52 * 3600_000].map(duration)).toEqual(['42s', '3m 05s', '1h 32m', '2d 4h'])
  })

  test('colors a bar by how full it is', async () => {
    expect(bar(62, 10)).toEqual({ filled: '██████', empty: '░░░░', color: 'yellow' })
    expect(bar(85, 10).color).toBe('red')
  })

  test('says when a window resets, the day only when not today', async () => {
    expect(resetsAt('2026-10-15T12:10:00', NOW)).toBe('resets 12:10 (in 2h 10m)')
    expect(resetsAt('2026-10-19T09:00:00', NOW)).toBe('resets Mon 09:00 (in 3d 23h)')
  })
})

describe('the Stats tab', () => {
  test('shows each figure with its definition', async ($, on) => {
    host(on)
    const ui = await mount($)

    expect(await ui.find({ text: '62%' })).toBeDefined()
    expect(await ui.find({ text: '124k of 200k tokens' })).toBeDefined()
    expect(await ui.find({ text: /^5-hour limit$/ })).toBeDefined()
    expect(await ui.find({ text: /resets 12:10 \(in 2h 10m\)/ })).toBeDefined()
    expect(await ui.find({ text: '$4.12' })).toBeDefined()
    expect(await ui.find({ text: '1h 32m' })).toBeDefined()
    expect(await ui.find({ text: /^What the model rereads each turn/ })).toBeDefined()
  })

  test('keeps details and definitions whole in a narrow pane, each on its own line', async ($, on) => {
    host(on)
    const ui = await mount($, 45)
    const reset = await ui.find({ text: 'resets 12:10 (in 2h 10m)' })
    const meaning = await ui.find({ text: /^What the model rereads each turn; near full, older turns get summarised\.$/ })

    expect(reset?.props.wrap).toBeUndefined()
    expect(meaning?.props.wrap).toBeUndefined()
    // The bar fits beside the label and the value: 45 − 13 − 9 − 2 cells.
    expect(await ui.find({ text: /^ {2}█{5}░{16}$/ })).toBeDefined()
  })

  test('hides the definitions on request', async ($, on) => {
    host(on)
    const ui = await mount($)
    await ui.press({ key: 'defs' })

    expect(await ui.find({ text: /^What the model rereads each turn/ })).toBeUndefined()
  })

  test("shows how much of the last request the cache served, and the session's prompts", async ($, on) => {
    host(on, {
      context: {
        tokens: 124_000,
        window: 200_000,
        percent: 62,
        breakdown: {
          categories: [],
          rawMaxTokens: 200_000,
          apiUsage: { input_tokens: 500, output_tokens: 300, cache_read_input_tokens: 118_000, cache_creation_input_tokens: 1_500 },
        },
      },
    })
    on('session.turns', () => ({ value: 18 }))
    const ui = await mount($)

    expect(await ui.find({ text: '98.3%' })).toBeDefined()
    expect(await ui.find({ text: /^last request: 118k read · 1\.5k written · 500 new$/ })).toBeDefined()
    expect(await ui.find({ text: /^Opus 5\.5 · 18 prompts · \/work\/app$/ })).toBeDefined()
  })

  test('shows nothing the plugin counted itself', async ($, on) => {
    host(on)
    const ui = await mount($)

    const labels = (await ui.findAll({ type: 'Text', props: { bold: true } })).map(t => t.text)

    expect(labels.filter(l => /^(Tokens|Turns|Lines|Git)$/.test(l ?? ''))).toEqual([])
    expect(labels).toContain('Context')
  })

  test('counts down how long the cache stays warm, by the lifetime the transcript records', async ($, on) => {
    host(
      on,
      { context: { tokens: 1, window: 2, percent: 50, breakdown: { categories: [], rawMaxTokens: 2, apiUsage: LAST } } },
      // Newest last: a request that wrote nothing, after one that wrote to the 1-hour cache.
      [response(30 * 60_000, { '1h': 900 }), response(22 * 60_000, {}), response(60_000, { '5m': 50 }, true)],
    )
    await $.classic.UserPromptSubmit({ prompt: 'hi', transcript_path: '/t/session.jsonl' } as never)
    const ui = await mount($)
    const until = new Date(NOW + 38 * 60_000)
    const at = `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`

    expect(await ui.find({ text: `1h cache · warm until ${at} (38m 00s left)` })).toBeDefined()
  })

  test('finds the transcript from the session id, before any prompt', async ($, on) => {
    host(
      on,
      { context: { tokens: 1, window: 2, percent: 50, breakdown: { categories: [], rawMaxTokens: 2, apiUsage: LAST } } },
      [response(10 * 60_000, { '1h': 100 })],
    )
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', () => ({ cwd: '/work/app' }))
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    const ui = await mount($)

    expect(await ui.find({ text: /^1h cache · warm until/ })).toBeDefined()
  })

  test("adds the transcript's tokens to the cost, each response once, subagents' included", async ($, on) => {
    const block = response(5 * 60_000, { '1h': 1000 }, false, 'same')
    host(on, {}, [block, block, response(60_000, {})], [response(30_000, { '5m': 500 }, true, 'sub')])
    await $.classic.UserPromptSubmit({ prompt: 'hi', transcript_path: '/home/me/.claude/projects/-work-app/abc.jsonl' } as never)
    const ui = await mount($)

    // In: 2 new + the writes, a response each: (2 + 1000) + 2 + (2 + 500). Read: 1000 each. Out: 100 each.
    expect(await ui.find({ text: 'tokens: 1.5k in · 3k cache read · 300 out' })).toBeDefined()
  })

  test('says when the cache has gone cold', async ($, on) => {
    host(
      on,
      { context: { tokens: 1, window: 2, percent: 50, breakdown: { categories: [], rawMaxTokens: 2, apiUsage: LAST } } },
      [response(12 * 60_000, { '5m': 400 })],
    )
    await $.classic.UserPromptSubmit({ prompt: 'hi', transcript_path: '/t/session.jsonl' } as never)
    const ui = await mount($)

    expect(await ui.find({ text: '5m cache · expired 7m 00s ago: the next request writes it again' })).toBeDefined()
  })

  test('says when no plan limit has been reported', async ($, on) => {
    host(on, { rateLimits: [] })
    const ui = await mount($)

    expect(await ui.find({ text: 'not reported yet' })).toBeDefined()
  })
})
