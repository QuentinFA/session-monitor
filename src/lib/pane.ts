/** The one pane every part draws in, each on its own tab. */
export const MONITOR = 'session-monitor'
export const MONITOR_TITLE = 'Session monitor'

export const TAB_IDS = ['outputs'] as const
export type TabId = (typeof TAB_IDS)[number]

/**
 * The tab on show lives in state `session-monitor.tab`. Each file that reads or writes it declares
 * its own `atom` for it: the validator only follows state references made in the file using them.
 */
export const isTabId = (value: string): value is TabId => (TAB_IDS as readonly string[]).includes(value)
