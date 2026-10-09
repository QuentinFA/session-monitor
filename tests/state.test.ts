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
      if (w.isRepo === false) return run(128, '', 'fatal: not a git repository')
      if (args.join(' ') === 'rev-parse --show-toplevel') return run(0, '/work/app\n')
      if (args[0] === 'status') return run(0, w.status ?? '## main...origin/main\n')

      return run(0, '')
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
  on('fs.stat', (_$, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('tool.call', { tool: 'Edit' }, (_$, e) => ({
    result: {
      filePath: e.file_path,
      oldString: e.old_string,
      newString: e.new_string,
      originalFile: '',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      userModified: false,
      replaceAll: false,
    },
  }))

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

const turn = async ($: Engine, answer: string, extra: { isAborted?: boolean; prompt?: string } = {}) => {
  await $.prompt.submit({ text: extra.prompt ?? 'go', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({
    answer,
    durationMs: 90_000,
    isAborted: extra.isAborted ?? false,
    turnId: `t${answer.length}`,
    reason: extra.isAborted ? 'aborted' : 'answer',
  })
}

const PR_PASSING = JSON.stringify({
  number: 12,
  url: 'https://github.com/o/app/pull/12',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
})

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

describe('the header line', () => {
  test('puts the state first and the position in one quiet line', async ($, on) => {
    world(on, { status: '## feat/x...origin/feat/x [ahead 2]\nM  a.ts\n?? b.ts\n', pr: { json: PR_PASSING } })
    await turn($, 'Done.')
    const ui = await openState($)
    await ui.press({ key: 'state-refresh' })

    expect(await ui.find({ text: /^Waiting on you · \d+s$/ })).toBeDefined()
    expect(await ui.find({ text: /feat\/x ↑2 · 2 changed · #12 open ✓ · \d+s/ })).toBeDefined()
  })

  test('says when the last turn was interrupted', async ($, on) => {
    world(on, {})
    await turn($, 'Half', { isAborted: true })
    const ui = await openState($)

    expect(await ui.find({ text: /^Interrupted · / })).toBeDefined()
  })

  test('says when the directory is not a repository', async ($, on) => {
    world(on, { isRepo: false })
    const ui = await openState($)
    await ui.press({ key: 'state-refresh' })

    expect(await ui.find({ text: /not a git repository/ })).toBeDefined()
  })
})

describe('after a load', () => {
  test('reads the position as soon as the tab is drawn, before any event', async ($, on) => {
    const clock = world(on, { status: '## feat/y...origin/feat/y\n' })
    const ui = await openState($)
    expect(await ui.find({ text: /not read yet/ })).toBeDefined()

    await clock.advance(1)
    expect(await ui.find({ text: /feat\/y · clean · no PR/ })).toBeDefined()
  })
})

describe('needs you', () => {
  test('lists each problem with what it asks of the person, and stays away when there is none', async ($, on) => {
    const w: World = { status: '## main...origin/main\n' }
    world(on, w)
    const ui = await openState($)
    await ui.press({ key: 'state-refresh' })
    expect(await ui.find({ text: 'Needs you' })).toBeUndefined()

    w.status = '## feat/x...origin/feat/x [behind 3]\n'
    w.pr = { json: PR_FAILING }
    await ui.press({ key: 'state-refresh' })
    expect(await ui.find({ text: 'Needs you' })).toBeDefined()
    expect(await ui.find({ text: /#12: 2 checks failing — test, ci\/legacy/ })).toBeDefined()
    expect(await ui.find({ text: /#12 has merge conflicts/ })).toBeDefined()
    expect(await ui.find({ text: /#12: changes requested/ })).toBeDefined()
    expect(await ui.find({ text: /3 behind origin\/feat\/x/ })).toBeDefined()
  })

  test('does not list blocked calls: they happened, nothing is asked', async ($, on) => {
    world(on, {})
    on('tool.call', { tool: 'Write' }, () => ({ deny: 'not here' }))
    await $.tool.call({ tool: 'Write', file_path: '/work/app/x', content: 'y' })
    const ui = await openState($)

    expect(await ui.find({ text: /blocked/ })).toBeUndefined()
    expect(await ui.find({ text: 'Needs you' })).toBeUndefined()
  })

  test('quotes the question the last answer ended on, until the next prompt', async ($, on) => {
    world(on, {})
    await turn($, 'I can do either.\n\nShould I keep the old command as an alias?')
    const ui = await openState($)
    expect(await ui.find({ text: /Claude asked: Should I keep the old command as an alias\?/ })).toBeDefined()

    await $.prompt.submit({ text: 'no', wait: false, origin: { kind: 'composer' } })
    expect(await ui.find({ text: /Claude asked/ })).toBeUndefined()
    expect(await ui.find({ text: /^Working · / })).toBeDefined()
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

describe('where the person left off', () => {
  test('repeats their request in their own words, and whether it finished', async ($, on) => {
    world(on, {})
    await turn($, 'All green.', { prompt: 'Run some tests to see how it behaves\nand report' })
    const ui = await openState($)

    expect(await ui.find({ text: /You asked \(answered\) “Run some tests to see how it behaves”/ })).toBeDefined()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`keeps a long activity line readable in a narrow pane (${surface})`, async ($, on) => {
      world(on, {})
      await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
      await $.tool.call({
        tool: 'Bash',
        command: 'npm run build -- --mode production --sourcemap --outDir dist/a-rather-long-directory-name-here',
      })
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 40 } })
      await $.command.run({
        command: 'session-monitor',
        args: 'state',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 40 },
      })

      expect(await ui.find({ text: /^npm run build/ })).toBeDefined()
      expect(await ui.find({ text: /^\s+\d+s$/ })).toBeDefined()
    })
  }

  test('shows the last activity in order, without the commands that only look', async ($, on) => {
    world(on, { status: '## main...origin/main\n' })
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
    await $.tool.call({ tool: 'Bash', command: 'git status && ls' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'cd /work/app && npm test' })
    await $.tool.call({ tool: 'Bash', command: 'git status 2>&1 >/dev/null; cat > notes.md' })
    const ui = await openState($)

    const kinds = (await ui.findAll({ type: 'Text', text: /^\s+(?:edited|ran)$/ })).map(r => r.text.trim())
    expect(kinds).toEqual(['edited', 'ran', 'ran'])
    expect(await ui.find({ text: 'cat > notes.md' })).toBeDefined()
    expect(await ui.find({ text: 'src/a.ts' })).toBeDefined()
    expect(await ui.find({ text: 'npm test' })).toBeDefined()
    expect(await ui.find({ text: /git status/ })).toBeUndefined()
  })
})
