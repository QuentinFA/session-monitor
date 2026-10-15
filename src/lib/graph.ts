/** One commit as `git log` lists it, newest first, parents before none of their children. */
export type LogCommit = {
  sha: string
  parents: string[]
  /** The refs pointing at it, as `%D` prints them with `--decorate=full`. */
  refs: string
  author: string
  /** Seconds since the epoch, as `%at` prints it. */
  time: number
  subject: string
}

/** One character of the graph, and the lane color it is drawn in. */
export type GraphChar = { ch: string; color: number | null }

export type GraphRow = {
  commit: LogCommit
  /** The lane the commit sits in. */
  col: number
  /** The graph on the commit's row: two characters a lane, its glyph then a gap. */
  chars: GraphChar[]
  /** The color of every lane running on below the row, null where none does: a detail's gutter. */
  below: (number | null)[]
}

type Lane = { sha: string; color: number } | null

/**
 * The commits laid out in lanes, straight: a lane keeps its column until it ends, and a freed
 * column is taken by the next lane that starts, so no lane ever shifts sideways. The lane under a
 * commit runs to its first parent; each other parent of a merge opens a lane of its own, or joins
 * the lane already heading there. Lanes waiting for the same commit join it on its row.
 *
 * Colors are numbers, one per lane as it starts; the drawing maps them onto a palette.
 */
export function layout(commits: readonly LogCommit[]): GraphRow[] {
  const lanes: Lane[] = []
  let nextColor = 0
  const rows: GraphRow[] = []

  for (const commit of commits) {
    const above = lanes.slice()
    const waiting = lanes.flatMap((lane, i) => (lane?.sha === commit.sha ? [i] : []))
    const col = waiting[0] ?? firstFree(lanes, [])
    const color = waiting.length > 0 ? (lanes[col] as { color: number }).color : nextColor++

    // Branches that started from this commit end here, joining its lane.
    const joined = waiting.slice(1)
    for (const i of joined) {
      lanes[i] = null
    }
    const [first, ...others] = commit.parents
    lanes[col] = first === undefined ? null : { sha: first, color }

    const opened: number[] = []
    const linked: number[] = []
    for (const parent of others) {
      const existing = lanes.findIndex(lane => lane?.sha === parent)
      if (existing >= 0 && existing !== col) {
        linked.push(existing)
        continue
      }
      const i = firstFree(lanes, joined)
      lanes[i] = { sha: parent, color: nextColor++ }
      opened.push(i)
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
    }

    const width = Math.max(above.length, lanes.length, col + 1)
    const chars: GraphChar[] = Array.from({ length: width * 2 }, () => ({ ch: ' ', color: null }))
    // A lane passes the row when it ran above it and still runs below, untouched.
    const passes = (i: number) =>
      i !== col && above[i] != null && lanes[i] != null && !joined.includes(i) && !opened.includes(i)
    for (let i = 0; i < width; i++) {
      if (passes(i)) {
        chars[i * 2] = { ch: '│', color: (above[i] as { color: number }).color }
      }
    }

    const connect = (i: number, glyph: [right: string, left: string], laneColor: number) => {
      const [from, to] = i > col ? [col * 2 + 1, i * 2] : [i * 2 + 1, col * 2]
      for (let x = from; x < to; x++) {
        const cell = chars[x] as GraphChar
        if (cell.ch === '│' || cell.ch === '┼') {
          chars[x] = { ch: '┼', color: cell.color }
        } else if (cell.ch === ' ' || cell.ch === '─') {
          chars[x] = { ch: '─', color: laneColor }
        }
      }
      chars[i * 2] = { ch: i > col ? glyph[0] : glyph[1], color: laneColor }
    }
    // The farthest first, so a nearer connector's glyph is drawn over the farther one's line.
    const byDistance = (a: number, b: number) => Math.abs(b - col) - Math.abs(a - col)
    for (const i of [...joined].sort(byDistance)) {
      connect(i, ['╯', '╰'], (above[i] as { color: number }).color)
    }
    for (const i of [...opened].sort(byDistance)) {
      connect(i, ['╮', '╭'], (lanes[i] as { color: number }).color)
    }
    for (const i of [...linked].sort(byDistance)) {
      connect(i, ['┤', '├'], (lanes[i] as { color: number }).color)
    }
    chars[col * 2] = { ch: '●', color }

    rows.push({ commit, col, chars, below: lanes.map(lane => lane?.color ?? null) })
  }

  return rows
}

/** The first column no lane holds and none just left on this row, or a new one on the right. */
function firstFree(lanes: readonly Lane[], leaving: readonly number[]) {
  const i = lanes.findIndex((lane, k) => lane === null && !leaving.includes(k))

  return i >= 0 ? i : lanes.length
}

/** Adjacent characters of one color joined, blanks with anything blank: the drawing's Text runs. */
export function runs(chars: readonly GraphChar[]): { text: string; color: number | null }[] {
  const out: { text: string; color: number | null }[] = []
  for (const { ch, color } of chars) {
    const last = out[out.length - 1]
    const shade = ch === ' ' ? null : color
    if (last && last.color === shade) {
      last.text += ch
    } else {
      out.push({ text: ch, color: shade })
    }
  }

  return out
}

export type Ref = { name: string; kind: 'head' | 'branch' | 'remote' | 'tag' | 'detached' }

/** The refs `%D` lists with `--decorate=full`, named short; a remote's HEAD left out. */
export function parseRefs(decoration: string): Ref[] {
  return decoration
    .split(', ')
    .filter(Boolean)
    .flatMap((raw): Ref[] => {
      if (raw === 'HEAD') return [{ name: 'HEAD', kind: 'detached' }]
      if (raw.startsWith('HEAD -> ')) return [{ name: raw.slice(8).replace(/^refs\/heads\//, ''), kind: 'head' }]
      if (raw.startsWith('tag: ')) return [{ name: raw.slice(5).replace(/^refs\/tags\//, ''), kind: 'tag' }]
      if (raw.startsWith('refs/heads/')) return [{ name: raw.slice(11), kind: 'branch' }]
      if (raw.startsWith('refs/remotes/')) {
        return raw.endsWith('/HEAD') ? [] : [{ name: raw.slice(13), kind: 'remote' }]
      }

      return []
    })
}
