/** A count in a few characters: 950, 12.4k, 1.2M. */
export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** A length of time, its two largest units: 42s, 3m 05s, 1h 32m, 2d 4h. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`

  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** A percentage as a bar of `width` cells, and the color its level calls for. */
export function bar(percent: number, width = 20): { filled: string; empty: string; color: string } {
  const cells = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))

  return {
    filled: '█'.repeat(cells),
    empty: '░'.repeat(width - cells),
    color: percent >= 80 ? 'red' : percent >= 50 ? 'yellow' : 'green',
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** When a window resets: its local time, the day too when not today, and how long until then. */
export function resetsAt(iso: string, now: number): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const isToday = at.toDateString() === new Date(now).toDateString()
  const left = at.getTime() - now

  return `resets ${isToday ? '' : `${DAYS[at.getDay()]} `}${time}${left > 0 ? ` (in ${duration(left)})` : ''}`
}
