export type LineCount = { path: string; added: number; removed: number }

export type FileChange = LineCount & {
  isCreated?: boolean
  isDeleted?: boolean
  /** Changed, but neither the engine nor git said by how many lines. */
  isUncounted?: boolean
}

export type FileUse = {
  path: string
  reads: number
  searches: number
  /** Reads of it refused before they ran. */
  blocked?: number
}

export type Command = {
  command: string
  description?: string
  isError?: boolean
  /** Refused before it ran: by a hook, a permission rule or check, or the person at the prompt. */
  isBlocked?: boolean
  isBackground?: boolean
}

export type Commit = {
  sha: string
  subject: string
  kind: string
  branch?: string
  files: LineCount[]
}

/** One directory the session worked in: a git root, or a plain directory outside any repo. */
export type Place = {
  root: string
  isRepo: boolean
  /** Git could not be run there, so whether it is a repository is unknown. */
  isRepoUnknown?: boolean
  remote?: string
  commands: Command[]
  used: FileUse[]
  changed: FileChange[]
  branches: string[]
  /** Local branches the session deleted, created here or not. */
  deleted?: string[]
  /** Branches the session deleted on a remote. */
  remoteDeleted?: string[]
  commits: Commit[]
  pushes: string[]
}

export type Action = { label: string; url?: string; isUse?: boolean; taskId?: string; isDone?: boolean }

/** A tool call refused before it ran. */
export type Blocked = {
  /** The call's tool_use_id: a refusal reported twice is kept once. */
  id: string
  tool: string
  /** What it would have touched: the command, the file, the service. */
  target: string
  reason: string
  /** The directory it would have run in, when it has one. */
  dir?: string
}

export type Outputs = {
  /** Absent in a record kept from before blocked calls were followed. */
  blocked?: Blocked[]
  places: Place[]
  github: Action[]
  services: Action[]
  scheduled: Action[]
}

/** Where the session's working directory stands in git and on GitHub, as last read. */
export type Position = {
  dir: string
  isRepo: boolean
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  pr?: {
    number: number
    url: string
    state: string
    isDraft: boolean
    mergeable: string
    reviewDecision: string
    passing: number
    failing: number
    pending: number
    failingNames: string[]
  }
  /** Why the PR could not be read, when `gh` failed for a reason other than "no PR". */
  prError?: string
  /** Milliseconds since the epoch. */
  readAt: number
}

/** One main-loop turn: from the prompt to the answer. */
export type Turn = {
  startedAt: number
  endedAt?: number
  /** As the engine measured it. */
  durationMs?: number
  reason?: string
  /** The first line of the answer. */
  summary?: string
  /** The answer's last line, when it ends on a question. */
  question?: string
}

/** What the main loop is doing right now. */
export type Now = {
  isWorking: boolean
  since: number
  /** The tool running, with a short subject. */
  tool?: string
  /** An AskUserQuestion waiting for the person's answer. */
  asking?: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-monitor': {
      /** The monitor's tab on show. */
      tab: string
      /** The home directory, read when the session starts: `~` in shown paths. */
      home: string
      outputs: Outputs
      expanded: string[]
      /** The Outputs tab's Reset was pressed once and awaits its confirmation. */
      confirmReset: boolean
      position: Position | null
      turns: Turn[]
      now: Now | null
    }
  }
}
