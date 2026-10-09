export type LineCount = { path: string; added: number; removed: number }

export type FileChange = LineCount & { isCreated?: boolean; isDeleted?: boolean }

export type FileUse = { path: string; reads: number; searches: number }

export type Command = {
  command: string
  description?: string
  isError?: boolean
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

export type Outputs = {
  places: Place[]
  github: Action[]
  services: Action[]
  scheduled: Action[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-monitor': { outputs: Outputs; expanded: string[] }
  }
}
