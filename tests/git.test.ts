import type { On } from 'claude-code'

import { clip, laneBudget, layout, parseRefs } from '../src/lib/graph'
import type { LogCommit } from '../src/lib/graph'
import { describe, expect, test } from 'claude-code/testing'

// The test's own hooks stand for the engine: the working directory and git, answering for the
// repositories each test declares.

const commit = (sha: string, parents: string[] = [], refs = ''): LogCommit => ({
  sha,
  parents,
  refs,
  author: 'Ada',
  time: 0,
  subject: `subject ${sha}`,
})

/** The graph of every row as plain text, trailing blanks cut. */
const drawn = (commits: LogCommit[]) => layout(commits).map(row => row.chars.map(c => c.ch).join('').trimEnd())

describe('the graph', () => {
  test('draws a straight history in one lane', async () => {
    expect(drawn([commit('c', ['b']), commit('b', ['a']), commit('a')])).toEqual(['●', '●', '●'])
  })

  test('opens a lane for a merged branch and joins it at the fork point', async () => {
    const rows = drawn([commit('m', ['b', 'x']), commit('x', ['a']), commit('b', ['a']), commit('a')])

    expect(rows).toEqual(['●─╮', '│ ●', '● │', '●─╯'])
  })

  test('keeps two branch tips in their own lanes down to where they forked', async () => {
    expect(drawn([commit('x', ['a']), commit('y', ['a']), commit('a')])).toEqual(['●', '│ ●', '●─╯'])
  })

  test('reuses a freed column without shifting the lanes right of it', async () => {
    const rows = layout([
      commit('p', ['a']),
      commit('q', ['b']),
      commit('r', ['c']),
      commit('a'),
      commit('s', ['c']),
      commit('b'),
      commit('c'),
    ])

    // `c` is awaited in columns 0 and 2: it takes the leftmost, and column 2 joins it.
    expect(rows.map(row => row.col)).toEqual([0, 1, 2, 0, 0, 1, 0])
  })

  test('crosses a lane between a merge and its new lane, and links into a lane already there', async () => {
    const rows = drawn([commit('y', ['m']), commit('w', ['r']), commit('m', ['b', 'z']), commit('b', ['p', 'r'])])

    expect(rows).toEqual(['●', '│ ●', '●─┼─╮', '●─┤ │'])
  })

  test('opens no lane for a parent listed before its child', async () => {
    expect(drawn([commit('a'), commit('b', ['a']), commit('c', ['b'])])).toEqual(['●', '●', '●'])
  })

  test('folds the lanes past its budget into the edge, the commit drawn there when it is out there', async () => {
    // Five tips side by side, then their common parent.
    const commits = [...'vwxyz'].map(sha => commit(sha, ['a'])).concat(commit('a'))
    const rows = layout(commits)
    const cut = (i: number) => clip((rows[i] as (typeof rows)[number]).chars, (rows[i] as (typeof rows)[number]).col, 3).map(c => c.ch).join('').trimEnd()

    expect(cut(2)).toBe('│ │ ●')
    expect(cut(3)).toBe('│ │ …●')
    expect(cut(5)).toBe('●─╯─…')
    expect(laneBudget(45)).toBe(7)

    // A commit in a kept lane, with lanes running past the budget.
    const passing = layout([commit('t', ['u']), ...[...'pqr'].map(sha => commit(sha, ['a'])), commit('u', ['a'])])
    const last = passing[4] as (typeof passing)[number]
    expect(clip(last.chars, last.col, 3).map(c => c.ch).join('').trimEnd()).toBe('● │ …')
  })

  test('names refs short and leaves a remote HEAD out', async () => {
    expect(
      parseRefs('HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1'),
    ).toEqual([
      { name: 'main', kind: 'head' },
      { name: 'origin/main', kind: 'remote' },
      { name: 'v1', kind: 'tag' },
    ])
  })
})

type Repo = { root: string; log: string; status?: string; show?: string; logError?: string }

const record = (c: LogCommit) => [c.sha, c.parents.join(' '), c.refs, c.author, String(c.time), c.subject].join('\x1f')

/** Stands for git in each repository; answers what the Git tab asks, and remembers what it ran. */
function host(on: On, repos: Repo[], cwd = '/work/app') {
  const ran: string[][] = []
  on('session.cwd', () => ({ value: cwd }))
  on('clock.now', () => ({ value: 1_000_000_000 * 1000 }))
  on('process.run', (_$, e) => {
    const dir = e.init?.cwd ?? cwd
    ran.push([dir, ...e.argv])
    const repo = repos.find(r => dir === r.root || dir.startsWith(`${r.root}/`))
    const out = (exitCode: number, stdout: string, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const [, sub] = e.argv
    if (!repo) return out(128, '')
    if (sub === 'rev-parse') return out(0, `${repo.root}\n`)
    if (sub === 'log') return repo.logError ? out(128, '', repo.logError) : out(0, repo.log)
    if (sub === 'status') return out(0, repo.status ?? '## main...origin/main\n')
    if (sub === 'show') return out(0, repo.show ?? '')

    return out(0, '')
  })

  return ran
}

/** The monitor, mounted and switched to its Git tab. */
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
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  await ui.press({ key: 'tab:git' })

  return ui
}

const LOG =
  [
    commit('m000000aaaa', ['b000000aaaa', 'x000000aaaa'], 'HEAD -> refs/heads/main, refs/remotes/origin/main'),
    commit('x000000aaaa', ['a000000aaaa'], 'refs/heads/feat'),
    commit('b000000aaaa', ['a000000aaaa']),
    commit('a000000aaaa', [], 'tag: refs/tags/v1'),
  ]
    .map(record)
    .join('\x1e\n') + '\x1e\n'

describe('the Git tab', () => {
  test("draws the session's repository as a graph with its refs", async ($, on) => {
    host(on, [{ root: '/work/app', log: LOG, status: '## main...origin/main [ahead 2]\n M a.ts\n?? b.ts\n' }])
    const ui = await mount($)

    expect(await ui.find({ text: /subject m000000aaaa/ })).toBeDefined()
    // The checked-out commit is ◉, in its lane's color; the merged lane opens in another.
    expect(await ui.find({ text: /^◉$/ })).toBeDefined()
    expect(await ui.find({ text: /^─╮$/ })).toBeDefined()
    expect(await ui.find({ text: /^feat $/ })).toBeDefined()
    expect(await ui.find({ text: /^on main · origin\/main ↑2 · $/ })).toBeDefined()
    expect(await ui.find({ key: 'to-changed', text: '2 uncommitted ›' })).toBeDefined()
  })

  test('opens a commit to its message and files', async ($, on) => {
    host(on, [
      {
        root: '/work/app',
        log: LOG,
        show: 'Ada\x1f2026-10-14 15:02\x1ffix: the thing\n\nWhy it broke.\n\x1e\n\n3\t1\tsrc/a.ts\n5\t0\tsrc/new.ts\n create mode 100644 src/new.ts\n',
      },
    ])
    const ui = await mount($)
    await ui.press({ key: 'c:x000000aaaa' })

    expect(await ui.find({ text: /Why it broke\./ })).toBeDefined()
    expect(await ui.find({ text: /^src\/new\.ts$/ })).toBeDefined()
    expect(await ui.find({ text: /^ new$/ })).toBeDefined()
  })

  test('reads only HEAD history on Current branch', async ($, on) => {
    const ran = host(on, [{ root: '/work/app', log: LOG }])
    const ui = await mount($)
    await ui.press({ key: 'scope:current' })
    await ui.press({ key: 'refresh' })
    const logs = ran.filter(argv => argv[2] === 'log')

    expect(logs[0]).toContain('--branches')
    expect(logs.at(-1)).not.toContain('--branches')
  })

  test("says why git could not read the history, rather than drawing nothing", async ($, on) => {
    host(on, [{ root: '/work/app', log: '', logError: 'fatal: bad object refs/remotes/origin/gone\n' }])
    const ui = await mount($)

    expect(await ui.find({ text: /^git log failed: fatal: bad object refs\/remotes\/origin\/gone$/ })).toBeDefined()
  })

  test('puts Current branch before All branches', async ($, on) => {
    host(on, [{ root: '/work/app', log: LOG }])
    const ui = await mount($)
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('scope:'))

    expect(keys).toEqual(['scope:current', 'scope:all'])
  })

  test('offers a directory granted with /add-dir', async ($, on) => {
    host(on, [
      { root: '/work/app', log: LOG },
      { root: '/work/lib', log: LOG },
    ])
    on('classic.DirectoryAdded', () => ({}))
    await $.classic.DirectoryAdded({ directory: '/work/lib/src', source: 'slash_command' })
    const ui = await mount($)

    expect(await ui.find({ key: 'repo' })).toBeDefined()
  })
})
