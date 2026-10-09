import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// Stands in for the engine: the working directory, git and gh, the clock.

type World = {
  status?: string
  /** gh's answer: the PR as JSON, or an error on stderr. */
  pr?: { json?: string; stderr?: string }
  /** Is the directory a repository. */
  isRepo?: boolean
}

const run = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

function world(on: On, w: World) {
  on('session.cwd', () => ({ value: '/work/app' }))
  on('process.run', (_$, e) => {
    const [command, ...args] = e.argv
    if (command === 'git') {
      return w.isRepo === false ? run(128, '', 'fatal: not a git repository') : run(0, w.status ?? '## main...origin/main\n')
    }
    if (command === 'gh' && args[0] === 'pr') {
      return w.pr?.json ? run(0, w.pr.json) : run(1, '', w.pr?.stderr ?? 'no pull requests found for branch "main"')
    }

    return run(0, '')
  })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.run', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  return mock.clock(on, { now: Date.UTC(2026, 9, 9, 10, 0) })
}

const PANE = {
  plugin: 'session-monitor',
  component: 'Pane' as const,
  requestId: 'session-monitor',
  props: {
    title: 'Session monitor',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
}

const openState = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  await $.command.run({
    command: 'session-monitor',
    args: 'state',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

  return $.ui.mount({ ...PANE, surface })
}

const turn = async ($: Engine, answer: string, extra: { isAborted?: boolean } = {}) => {
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({
    answer,
    durationMs: 90_000,
    isAborted: extra.isAborted ?? false,
    turnId: `t${answer.length}`,
    reason: extra.isAborted ? 'aborted' : 'answer',
  })
}

const PR_FAILING = JSON.stringify({
  number: 12,
  url: 'https://github.com/o/app/pull/12',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'CONFLICTING',
  reviewDecision: 'CHANGES_REQUESTED',
  statusCheckRollup: [
    { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'build', status: 'IN_PROGRESS', conclusion: '' },
    { context: 'ci/legacy', state: 'ERROR' },
  ],
})

describe('position', () => {
  test('reads the branch, its upstream, the tree and the PR, and lists what needs the person', async ($, on) => {
    world(on, {
      status: '## feat/x...origin/feat/x [ahead 2, behind 1]\nM  a.ts\n M b.ts\nMM c.ts\n?? d.ts\n',
      pr: { json: PR_FAILING },
    })
    const ui = await openState($)
    await ui.press({ key: 'state-refresh' })

    expect(await ui.find({ text: /feat\/x → origin\/feat\/x ↑2 ↓1/ })).toBeDefined()
    expect(await ui.find({ text: '2 staged · 2 modified · 1 untracked' })).toBeDefined()
    expect(await ui.find({ text: /#12 open · changes requested · checks: 2 failing, 1 pending, 1 passing/ })).toBeDefined()
    expect(await ui.find({ text: /2 checks failing on #12: test, ci\/legacy/ })).toBeDefined()
    expect(await ui.find({ text: /Changes requested on #12/ })).toBeDefined()
    expect(await ui.find({ text: /#12 has merge conflicts/ })).toBeDefined()
  })

  test('says there is no PR, or that it could not be read, and never confuses the two', async ($, on) => {
    const w: World = {}
    world(on, w)
    const ui = await openState($)
    await ui.press({ key: 'state-refresh' })
    expect(await ui.find({ text: 'no pull request for this branch' })).toBeDefined()

    w.pr = { stderr: 'gh: To get started with GitHub CLI, please run:  gh auth login' }
    await ui.press({ key: 'state-refresh' })
    expect(await ui.find({ text: /PR unknown: gh: To get started/ })).toBeDefined()
  })

  test('says when the working directory is not a repository', async ($, on) => {
    world(on, { isRepo: false })
    const ui = await openState($)
    await ui.press({ key: 'state-refresh' })

    expect(await ui.find({ text: /\/work\/app is not a git repository/ })).toBeDefined()
  })
})

describe('turns', () => {
  test('shows each finished turn by its answer’s first line, newest first, and how it ended', async ($, on) => {
    world(on, {})
    await turn($, '## Fixed the parser\n\nDetails follow.')
    await turn($, 'Stopped halfway', { isAborted: true })
    const ui = await openState($)

    const rows = (await ui.findAll({ text: /^\s*\d\d:\d\d · / })).filter(r => !/\s$/.test(r.text)) // the row, not its time label
    expect(rows.map(r => r.text.replace(/^\s*\d\d:\d\d · /, ''))).toEqual([
      '2m · interrupted  Stopped halfway',
      '2m  Fixed the parser',
    ])
    expect(await ui.find({ text: /waiting on you since/ })).toBeDefined()
  })

  test('lists a question the last answer ended on, until the next turn starts', async ($, on) => {
    world(on, {})
    await turn($, 'I can do either.\n\nShould I keep the old command as an alias?')
    const ui = await openState($)
    expect(await ui.find({ text: /ends on a question: Should I keep the old command as an alias\?/ })).toBeDefined()

    await $.prompt.submit({ text: 'no', wait: false, origin: { kind: 'composer' } })
    expect(await ui.find({ text: /ends on a question/ })).toBeUndefined()
    expect(await ui.find({ text: /Claude is working/ })).toBeDefined()
  })

  test('lists an AskUserQuestion while it waits, then drops it', async ($, on) => {
    world(on, {})
    let seen: string | undefined
    let ui: Awaited<ReturnType<typeof openState>> | undefined
    on('tool.call', { tool: 'AskUserQuestion' }, async () => {
      seen = (await ui?.find({ text: /Claude is asking:/ }))?.text

      return { result: { questions: [], answers: {} } as never }
    })
    ui = await openState($)
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [{ question: 'Which tab next?', header: 'Next', options: [], multiSelect: false }],
    })

    expect(seen).toContain('Claude is asking: Which tab next?')
    expect(await ui.find({ text: /Claude is asking/ })).toBeUndefined()
  })
})
