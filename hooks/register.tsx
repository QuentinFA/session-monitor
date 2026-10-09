import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import { isTabId, MONITOR, MONITOR_TITLE, TAB_IDS } from '../src/lib/pane'

import type { TabId } from '../src/lib/pane'
import { registerOutputs } from '../src/outputs'

type $ = EngineInterface

const activeTab = atom({ plugin: 'session-monitor', key: 'tab' } as const, 'outputs')
const homeDir = atom({ plugin: 'session-monitor', key: 'home' } as const, '')

const LABELS: Record<TabId, string> = { outputs: 'Outputs' }

/** The tab row, then the body the active part's render hook answers further down the chain. */
async function drawMonitor($: $, e: RenderInput<'Pane'>, body: Promise<unknown>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const stored = await read($, activeTab)
  const tab: TabId = isTabId(stored) ? stored : 'outputs'

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {TAB_IDS.map((id, i) => (
          <Box key={`tabwrap:${id}`} marginRight={1}>
            <Button
              key={`tab:${id}`}
              label={LABELS[id]}
              hotkey={String(i + 1)}
              variant={id === tab ? 'primary' : undefined}
              onPress={() => update($, activeTab, () => id)}
            />
          </Box>
        ))}
        <Text dimColor> session monitor</Text>
      </Box>
      {(await body) as never}
    </Box>
  )
}

export const register: Register = (on, options) => {
  // The plugin's one session.start: every part's commands are declared here, and what parts read
  // before anything is recorded — the home directory — is put in state. It fires again on a reload.
  on('session.start', async ($, e, next) => {
    const got = await $.process.run(['printenv', 'HOME']).catch(() => undefined)
    if (got?.exitCode === 0 && got.stdout.trim()) {
      await update($, homeDir, () => got.stdout.trim())
    }
    await $.command.register({
      name: 'session-monitor',
      description: `Open the session monitor, optionally on a tab: ${TAB_IDS.join(', ')}`,
    })

    return next(e)
  })

  on('command.run', { command: 'session-monitor' }, async ($, e) => {
    const wanted = e.args.trim()
    if (wanted && !isTabId(wanted)) {
      return { text: `No tab "${wanted}". Tabs: ${TAB_IDS.join(', ')}.` }
    }
    if (wanted) {
      await update($, activeTab, () => wanted)
    }
    await $.ui.open({ id: MONITOR, title: MONITOR_TITLE })

    return { text: `Session monitor opened${wanted ? ` on ${wanted}` : ''}.` }
  })

  // Registered before the parts, so it runs first and wraps what they draw.
  on('ui.render', { component: 'Pane', requestId: MONITOR }, ($, e, next) => drawMonitor($, e, next(e)))

  registerOutputs(on, options)
}
