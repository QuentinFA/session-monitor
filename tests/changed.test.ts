import type { On } from 'claude-code'

import { describe, expect, test } from 'claude-code/testing'

// The test's own hooks stand for the engine: the working directory and git in one repository,
// answering what the Changed tab asks.

type Work = {
  status: string
  staged?: string
  unstaged?: string
  /** `git diff` answers, by the argument list after `diff`. */
  diffs?: Record<string, string>
  statusError?: string
}

function host(on: On, work: Work) {
  on('session.cwd', () => ({ value: '/work/app' }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('process.run', (_$, e) => {
    const out = (exitCode: number, stdout: string, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const [, sub, ...rest] = e.argv.filter((arg, i, all) => arg !== '-c' && all[i - 1] !== '-c')
    const line = rest.join(' ')
    if (sub === 'rev-parse') return out(0, '/work/app\n')
    if (sub === 'status' && !rest.includes('-z')) return out(0, '## main\n M src/b.ts\n') // the Git tab's
    if (sub === 'status') return work.statusError ? out(128, '', work.statusError) : out(0, work.status)
    if (sub === 'log') return out(0, '')
    if (sub === 'diff' && line === '--cached --numstat --no-renames') return out(0, work.staged ?? '')
    if (sub === 'diff' && line === '--numstat --no-renames') return out(0, work.unstaged ?? '')
    if (sub === 'diff' && line.startsWith('--no-index --numstat')) return out(1, `7\t0\t${rest.at(-1)}\n`)
    if (sub === 'diff') return out(0, work.diffs?.[line.replace('--no-color ', '')] ?? '')

    return out(0, '')
  })
}

async function mount($: Parameters<Parameters<typeof test>[1]>[0]) {
  const ui = await $.ui.mount({
    plugin: 'session-monitor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-monitor',
    props: {
      title: 'Session monitor',
      isFocused: true,
      bodyColumns: 100,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  })
  await ui.press({ key: 'tab:changed' })

  return ui
}

const WORK: Work = {
  // a.ts staged then edited again, b.ts edited, c.md new.
  status: 'MM src/a.ts\0 M src/b.ts\0?? c.md\0',
  staged: '3\t1\tsrc/a.ts\n',
  unstaged: '1\t1\tsrc/a.ts\n4\t2\tsrc/b.ts\n',
  diffs: {
    '--cached --no-renames -- src/a.ts': 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,3 @@\n-old\n+new\n+more\n+again\n',
    '--no-renames -- src/b.ts': '@@ -5 +5 @@\n-was b\n+is b\n',
  },
}

describe('the Changed tab', () => {
  test('lists staged, unstaged and untracked files with their lines', async ($, on) => {
    host(on, WORK)
    const ui = await mount($)

    expect(await ui.find({ text: /^Staged 1$/ })).toBeDefined()
    expect(await ui.find({ text: /^Unstaged 2$/ })).toBeDefined()
    expect(await ui.find({ text: /^Untracked 1$/ })).toBeDefined()
    expect(await ui.find({ key: 'f:unstaged:src/b.ts' })).toBeDefined()
    expect(await ui.find({ text: /^\+4 −2$/ })).toBeDefined()
    expect(await ui.find({ text: /^\+7 −0$/ })).toBeDefined()
  })

  test("shows the first file's diff, and steps to the next and back", async ($, on) => {
    host(on, WORK)
    const ui = await mount($)

    expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ path: 'src/a.ts' })
    expect(String((await ui.find({ type: 'Code' }))?.props.source)).toMatch(/^@@ -1 \+1,3 @@/)
    await ui.press({ key: 'next' })
    await ui.press({ key: 'next' })
    expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ path: 'src/b.ts', source: '@@ -5 +5 @@\n-was b\n+is b\n' })
    expect(await ui.find({ text: /3\/4 · unstaged/ })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect(await ui.find({ text: /2\/4 · unstaged/ })).toBeDefined()
  })

  test('selects a file by its status letter', async ($, on) => {
    host(on, WORK)
    const ui = await mount($)
    await ui.press({ key: 'f:unstaged:src/b.ts' })

    expect((await ui.find({ type: 'Code' }))?.props).toMatchObject({ path: 'src/b.ts' })
  })

  test('links a file to open it, a deleted one excepted', async ($, on) => {
    host(on, { status: ' M src/b.ts\0 D gone.ts\0' })
    const ui = await mount($)

    expect((await ui.find({ type: 'Link' }))?.props).toMatchObject({ href: 'file:///work/app/src/b.ts' })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(1)
  })

  test('says the work tree is clean', async ($, on) => {
    host(on, { status: '' })
    const ui = await mount($)
    expect(await ui.find({ text: /Nothing uncommitted/ })).toBeDefined()
  })

  test('says why git could not read the work tree', async ($, on) => {
    host(on, { status: '', statusError: 'fatal: index file corrupt\n' })
    const ui = await mount($)

    expect(await ui.find({ text: 'git status failed: fatal: index file corrupt' })).toBeDefined()
  })

  test("is opened from the Git tab's uncommitted count", async ($, on) => {
    host(on, WORK)
    const ui = await mount($)
    await ui.press({ key: 'tab:git' })
    await ui.press({ key: 'to-changed' })

    expect(await ui.find({ text: /^Staged 1$/ })).toBeDefined()
  })
})
