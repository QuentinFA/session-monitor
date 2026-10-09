import type { Position } from '../../types'

type Counts = Pick<Position, 'branch' | 'upstream' | 'ahead' | 'behind' | 'staged' | 'unstaged' | 'untracked'>

/** Reads `git status --porcelain=v1 --branch`. */
export function parseStatus(out: string): Counts {
  const counts: Counts = { ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0 }
  for (const line of out.split('\n')) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const [refs = '', tracking = ''] = head.split(' [')
      const [branch, upstream] = refs.split('...')
      counts.branch = branch?.startsWith('HEAD (no branch)') ? undefined : branch?.replace(/^No commits yet on /, '')
      counts.upstream = upstream || undefined
      counts.ahead = Number(/ahead (\d+)/.exec(tracking)?.[1] ?? 0)
      counts.behind = Number(/behind (\d+)/.exec(tracking)?.[1] ?? 0)
    } else if (line.startsWith('?? ')) {
      counts.untracked++
    } else if (line.length > 2) {
      if (line[0] !== ' ') counts.staged++
      if (line[1] !== ' ') counts.unstaged++
    }
  }

  return counts
}

type Check = { status?: string; conclusion?: string; state?: string; name?: string; context?: string }

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const PENDING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'])

/** Reads `gh pr view --json number,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup`. */
export function parsePr(json: string): Position['pr'] {
  const pr = JSON.parse(json) as {
    number: number
    url: string
    state: string
    isDraft: boolean
    mergeable: string
    reviewDecision: string
    statusCheckRollup?: Check[]
  }
  let passing = 0
  let failing = 0
  let pending = 0
  const failingNames: string[] = []
  for (const check of pr.statusCheckRollup ?? []) {
    // A check run has status and conclusion; a commit status has state.
    const result = check.conclusion || check.state || ''
    if (FAILED.has(result)) {
      failing++
      failingNames.push(check.name ?? check.context ?? 'check')
    } else if ((check.status && check.status !== 'COMPLETED') || PENDING.has(result)) {
      pending++
    } else {
      passing++
    }
  }

  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    reviewDecision: pr.reviewDecision,
    passing,
    failing,
    pending,
    failingNames,
  }
}

/** The answer's last line when it ends on a question; the first line as its summary. */
export function readAnswer(text: string) {
  const lines = text
    .split('\n')
    .map(l => l.replace(/^[#>*\-\s]+|[*_`]+/g, '').trim())
    .filter(Boolean)
  const last = lines.at(-1) ?? ''

  return { summary: lines[0]?.slice(0, 160), question: last.endsWith('?') ? last.slice(0, 200) : undefined }
}
