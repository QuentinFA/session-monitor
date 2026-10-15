import type { Outputs } from '../../types'

/**
 * The repositories the Git and Changed tabs offer, by root: the working directory's first, then every
 * one Outputs recorded, then those of the directories granted with `/add-dir`; each once.
 */
export function orderRepos(own: string | null, out: Outputs, granted: readonly string[]): string[] {
  return [...new Set([...(own ? [own] : []), ...out.places.filter(p => p.isRepo).map(p => p.root), ...granted])]
}

export const shortPath = (home: string, path: string) =>
  home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
