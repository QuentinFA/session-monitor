import type { Register } from 'claude-code'

import { registerOutputs } from '../src/outputs'

export const register: Register = (on, options) => {
  registerOutputs(on, options)
}
