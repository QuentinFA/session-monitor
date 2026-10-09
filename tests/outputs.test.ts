import type { On } from 'claude-code'

import type { Outputs } from '../types'
import { describe, expect, test } from 'claude-code/testing'

// The test's own hooks stand for the engine: the working directory, the
// file system (`/tmp` resolving to `/private/tmp`, as on macOS), git, and
// the Bash tool's results.

type Repo = {
  root: string
  head: string
  remote?: string
  numstat?: string
  others?: string
  subjects?: Record<string, string>
  /** What `git rev-list before..after` answers. */
  revList?: string
}

type BashOutcome = {
  stdout?: string
  gitOperation?: Record<string, unknown>
  bashEditDiff?: Record<string, unknown>
  /** More of the Bash result's own fields. */
  extra?: Record<string, unknown>
  isError?: boolean
  text?: string
  /** What the command does to the repos while it runs. */
  effect?: () => void
}

const EMPTY: Outputs = { places: [], github: [], services: [], scheduled: [] }

/** Stands for the engine beneath the mod; answers what the mod last recorded. */
function host(on: On, repos: Repo[], bash: (command: string) => BashOutcome = () => ({}), cwd = '/work/app') {
  let outputs = EMPTY
  on('state.set', { plugin: 'session-monitor', key: 'outputs' }, (_$, e, next) => {
    outputs = e.value as Outputs

    return next(e)
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.stat', (_$, e) => ({
    value: {
      kind: 'dir' as const,
      size: 0,
      mtimeMs: 0,
      isLink: false,
      realPath: e.path.replace(/^\/tmp(?=\/|$)/, '/private/tmp'),
    },
  }))
  on('process.run', (_$, e) => ({ value: git(e.argv, e.init?.cwd ?? cwd) }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const outcome = bash(e.command)
    outcome.effect?.()
    const result = {
      stdout: outcome.stdout ?? '',
      stderr: '',
      interrupted: false,
      ...outcome.extra,
      ...(outcome.gitOperation ? { gitOperation: outcome.gitOperation } : {}),
      ...(outcome.bashEditDiff ? { bashEditDiff: outcome.bashEditDiff } : {}),
    }

    return outcome.isError ? { result, isError: true as const, text: outcome.text ?? '' } : { result }
  })

  return () => outputs

  function git(argv: readonly string[], dir: string) {
    const run = (exitCode: number, stdout: string, stderr = '') => ({
      exitCode,
      stdout,
      stderr,
      isStdoutTruncated: false,
      isStderrTruncated: false,
    })
    const ok = (stdout: string) => run(0, stdout)
    const [command, ...args] = argv
    if (command === 'printenv') {
      return ok('/home/me\n')
    }
    const repo = repos.find(r => dir === r.root || dir.startsWith(`${r.root}/`))
    if (command !== 'git' || !repo) {
      return run(128, '', 'fatal: not a git repository')
    }
    const line = args.join(' ')
    if (line === 'rev-parse --show-toplevel') return ok(`${repo.root}\n`)
    if (line === 'rev-parse HEAD') return ok(`${repo.head}\n`)
    if (line === 'remote get-url origin') {
      return repo.remote ? ok(`${repo.remote}\n`) : run(2, '')
    }
    if (line === 'diff --numstat HEAD') return ok(repo.numstat ?? '')
    if (line.startsWith('rev-list --reverse --max-count=50 ')) return ok(repo.revList ?? '')
    if (line === 'ls-files --others --exclude-standard') return ok(repo.others ?? '')
    if (line.startsWith('show --numstat --format=%s ')) {
      const sha = args.at(-1) ?? ''
      return ok(`${repo.subjects?.[sha] ?? 'a commit'}\n\n1\t0\tREADME.md\n`)
    }
    if (line.startsWith('diff --no-index --numstat /dev/null ')) return run(1, `2\t0\t${args.at(-1)}\n`)

    return ok('')
  }
}

describe('where a command is filed', () => {
  test('follows `cd` then a relative `git -C`, through the /tmp symlink', async ($, on) => {
    const recorded = host(on, [{ root: '/private/tmp/demo/alpha', head: 'a1' }])
    await $.tool.call({ tool: 'Bash', command: 'cd /tmp/demo && git -C alpha status' })

    const { places } = recorded()
    expect(places.map(p => p.root)).toEqual(['/private/tmp/demo/alpha'])
    expect(places[0]?.commands[0]?.command).toBe('cd /tmp/demo && git -C alpha status')
  })

  test('follows a chain of `cd`s, `..` included', async ($, on) => {
    const recorded = host(on, [{ root: '/work/tools', head: 'a1' }])
    await $.tool.call({ tool: 'Bash', command: 'cd /work/tools/hooks && ls && cd .. && make' })

    expect(recorded().places.map(p => p.root)).toEqual(['/work/tools'])
  })

  test('ignores `cd`, `git` and `gh` inside a heredoc body', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }])
    await $.tool.call({
      tool: 'Bash',
      command: "python3 - <<'EOF'\ncd /elsewhere && gh pr create && git checkout -b nope\nEOF",
    })

    const out = recorded()
    expect(out.places.map(p => p.root)).toEqual(['/work/app'])
    expect(out.places[0]?.branches).toEqual([])
    expect(out.github).toEqual([])
  })

  test('keeps a directory outside any repo as its own group', async ($, on) => {
    const recorded = host(on, [])
    await $.tool.call({ tool: 'Bash', command: 'cd /tmp/scratch && touch x' })

    expect(recorded().places).toMatchObject([{ root: '/private/tmp/scratch', isRepo: false }])
  })
})

describe('changes', () => {
  test("counts the engine's per-file diff, as paths relative to the repo", async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }], () => ({
      bashEditDiff: {
        files: [
          { filePath: '/work/app/src/a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-x', '+y', '+z'] }] },
          { filePath: '/work/app/new.txt', hunks: [], created: true },
        ],
        moreFiles: 0,
      },
    }))
    await $.tool.call({ tool: 'Bash', command: "sed -i '' s/x/y/ src/a.ts && touch new.txt" })

    expect(recorded().places[0]?.changed).toEqual([
      { path: 'src/a.ts', added: 2, removed: 1 },
      { path: 'new.txt', added: 0, removed: 0, isCreated: true },
    ])
  })

  test('falls back to what git saw change around the command when the engine reports no diff', async ($, on) => {
    const repo: Repo = { root: '/work/app', head: 'a1', numstat: '1\t0\tREADME.md\n' }
    const recorded = host(on, [repo], () => ({
      effect: () => {
        repo.numstat = '3\t1\tREADME.md\n'
        repo.others = 'created.txt\n'
      },
    }))
    await $.tool.call({ tool: 'Bash', command: 'sed -i "" s/a/b/ README.md && printf "x\\ny\\n" > created.txt' })

    expect(recorded().places[0]?.changed).toEqual([
      { path: 'README.md', added: 2, removed: 1 },
      { path: 'created.txt', added: 2, removed: 0, isCreated: true },
    ])
  })

  test('does not count a branch switch as edits', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }], () => ({
      bashEditDiff: { files: [{ filePath: '/work/app/a.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] }], moreFiles: 0 },
    }))
    await $.tool.call({ tool: 'Bash', command: 'git checkout main' })

    expect(recorded().places[0]?.changed).toEqual([])
  })
})

describe('git', () => {
  test("records a commit the engine didn't report, when the command moved HEAD", async ($, on) => {
    const repo: Repo = { root: '/work/app', head: 'aaaaaaa1', subjects: { bbbbbbb2: 'fix: the thing' } }
    const recorded = host(on, [repo], () => ({ stdout: 'ok bbbbbbb', effect: () => (repo.head = 'bbbbbbb2') }))
    await $.tool.call({ tool: 'Bash', command: 'git commit -am "fix: the thing"' })

    expect(recorded().places[0]?.commits).toEqual([
      { sha: 'bbbbbbb', subject: 'fix: the thing', kind: 'committed', files: [{ path: 'README.md', added: 1, removed: 0 }] },
    ])
  })

  test('records every commit a command makes, not only the one the engine reports', async ($, on) => {
    const repo: Repo = {
      root: '/work/app',
      head: 'aaaaaaa1',
      subjects: { bbbbbbb2: 'mod: add it', ccccccc3: 'skill: route to it' },
    }
    const recorded = host(on, [repo], () => ({
      gitOperation: { commit: { sha: 'ccccccc', kind: 'committed', branch: 'feat/x' } },
      effect: () => {
        repo.head = 'ccccccc3'
        repo.revList = 'bbbbbbb2\nccccccc3\n'
      },
    }))
    await $.tool.call({ tool: 'Bash', command: 'git commit -m one && git add b && git commit -m two' })

    expect(recorded().places[0]?.commits.map(c => [c.sha, c.subject, c.branch])).toEqual([
      ['bbbbbbb', 'mod: add it', undefined],
      ['ccccccc', 'skill: route to it', 'feat/x'],
    ])
  })

  test('tracks branches created, deleted locally and deleted on the remote', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }])
    await $.tool.call({ tool: 'Bash', command: 'git checkout -b feat/x && git checkout -' })
    await $.tool.call({ tool: 'Bash', command: 'git branch -D feat/x old/y' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin --delete feat/x && git push origin :stale' })

    expect(recorded().places[0]).toMatchObject({
      branches: ['feat/x'],
      deleted: ['feat/x', 'old/y'],
      remoteDeleted: ['feat/x', 'stale'],
    })
  })

  test('files a branch made by `git worktree add -b` under the worktree', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }, { root: '/private/tmp/wt', head: 'a1' }])
    await $.tool.call({ tool: 'Bash', command: 'git worktree add -b test/x /tmp/wt origin/main' })

    const { places } = recorded()
    expect(places.find(p => p.root === '/private/tmp/wt')?.branches).toEqual(['test/x'])
    expect(places.find(p => p.root === '/work/app')?.branches).toEqual([])
  })
})

describe('GitHub', () => {
  test("records the engine's PR report with its URL", async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }], () => ({
      gitOperation: { pr: { number: 7, url: 'https://github.com/o/app/pull/7', action: 'created' } },
    }))
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })

    expect(recorded().github).toEqual([{ label: 'PR #7 created', url: 'https://github.com/o/app/pull/7' }])
  })

  test('rebuilds the URL from the remote when the output was rewritten', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1', remote: 'git@github.com:o/app.git' }], () => ({ stdout: 'ok commented #7' }))
    await $.tool.call({ tool: 'Bash', command: 'gh pr comment 7 --body hi' })

    expect(recorded().github).toEqual([{ label: 'pr comment #7', url: 'https://github.com/o/app/pull/7' }])
  })

  test('records a gh write whose command failed partway', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1', remote: 'https://github.com/o/app' }], () => ({
      isError: true,
      text: '✓ Closed pull request o/app#7\nfailed to run git',
    }))
    await $.tool.call({ tool: 'Bash', command: 'gh pr close 7 --delete-branch' })

    expect(recorded().github).toEqual([
      { label: 'pr close #7 (command exited with an error)', url: 'https://github.com/o/app/pull/7' },
    ])
  })
})

describe('the rest of the session', () => {
  test('marks a background command done once the session no longer runs it', async ($, on) => {
    const recorded = host(on, [{ root: '/work/app', head: 'a1' }], () => ({ extra: { backgroundTaskId: 'task-1' } }))
    on('classic.Stop', () => ({}))
    await $.tool.call({ tool: 'Bash', command: 'sleep 5', run_in_background: true, description: 'Wait' })
    expect(recorded().scheduled).toEqual([{ label: 'background: Wait', taskId: 'task-1' }])

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    expect(recorded().scheduled).toEqual([{ label: 'background: Wait', taskId: 'task-1', isDone: true }])
  })

  test('never breaks the tool call when recording fails', async ($, on) => {
    on('session.cwd', () => {
      throw new Error('no cwd')
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'hello', stderr: '', interrupted: false } }))
    const ran = await $.tool.call({ tool: 'Bash', command: 'echo hello' })

    expect(ran).toMatchObject({ result: { stdout: 'hello' } })
  })
})

describe('the pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`starts collapsed, expands all, and copies the report (${surface})`, async ($, on) => {
      host(on, [{ root: '/work/app', head: 'a1', remote: 'https://github.com/o/app' }])
      let copied = ''
      on('ui.copy', (_$, e) => {
        copied = e.text

        return { value: { isCopied: true as const } }
      })
      await $.tool.call({ tool: 'Bash', command: 'git checkout -b feat/x' })

      const ui = await $.ui.mount({
        plugin: 'session-monitor',
        surface,
        component: 'Pane',
        requestId: 'outputs',
        props: {
          title: 'Outputs',
          isFocused: true,
          bodyColumns: 80,
          placement: 'dock',
          scroll: { offset: 0, bodyRows: 40 },
          view: {},
        },
      })
      expect(await ui.find({ text: /1 branch · 1 command/ })).toBeDefined()
      expect(await ui.find({ text: /^branches/ })).toBeUndefined()

      await ui.press({ key: 'all' })
      expect(await ui.find({ text: /feat\/x/ })).toBeDefined()
      expect(await ui.find({ key: 'all', text: 'Collapse all' })).toBeDefined()

      await ui.press({ key: 'copy' })
      expect(copied).toContain('## /work/app (o/app)')
      expect(copied).toContain('- branches: feat/x')
    })
  }
})
