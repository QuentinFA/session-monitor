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
      /** The Git tab's repository, by its root; empty for the session's own. */
      gitRepo: string
      /** The Git tab's branches: `all`, or `current` for HEAD's history alone. */
      gitScope: string
      /** The commit the Git tab shows open, as `<root>|<sha>`; empty for none. */
      gitOpen: string
      /** The repositories, by root, of directories granted during the session (`/add-dir`). */
      gitDirs: string[]
      /** How many commits the Git tab reads. */
      gitLimit: number
      /** The file the Changed tab shows the diff of, as `<root>|<section>|<path>`; empty for the first. */
      changedFile: string
      /** The Stats tab shows each figure's definition. */
      statsDefs: boolean
      /** The Stats tab's context breakdown is open. */
      statsBreakdown: boolean
      /** The session's transcript, as the last prompt reported it: where the cache's lifetime is read. */
      transcript: string
    }
  }
}
