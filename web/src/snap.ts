// Where a line end lands: on an element's edge if it was let go near one, or free on the canvas.
//
// Gentle on purpose. Within SNAP screen pixels of an element's edge, the end attaches to the nearest side; any
// further and it stays exactly where it was dropped. A strong magnet makes it impossible to end a line in the
// empty space beside a card, which is half of what lines are for.
//
// Containers are the trap. A box, or a big card with other elements on it, covers a lot of empty space, and
// "anywhere inside counts" meant a line ending in the gap between two inner cards jumped to the container's far
// edge. So: on a plain element, anywhere inside it counts (drop on a card, it attaches). On a container, only
// near its border does.

export const SNAP = 12
export type Side = 't' | 'r' | 'b' | 'l'
/**
 * `at` is how far along the side the end landed, 0 to 1 (top and bottom: left to right; left and right: top to
 * bottom). `handle` is the connection id that means it: the plain side (`t`) for the middle, `t@0.82` elsewhere.
 * An end attaches where it was let go, not at the middle of the side.
 */
export type Snapped = { id: string; side: Side; at: number; handle: string; rect: DOMRect }

/** Within this of the middle, an end goes to the middle: centred lines are the common case, and easy to hit. */
const MIDDLE = 0.06

/** The handle id for a spot on a side. */
export const handleAt = (side: Side, at: number) => (Math.abs(at - 0.5) <= MIDDLE ? side : `${side}@${at.toFixed(2)}`)
/** A handle id back to its side and spot: `t@0.82` -> t, 0.82; `t` -> t, 0.5. */
export function parseHandle(h: string): { side: Side; at: number } | null {
  const m = /^([trbl])(?:@([\d.]+))?$/.exec(h)
  return m ? { side: m[1] as Side, at: m[2] ? Number(m[2]) : 0.5 } : null
}

type Seen = { id: string; rect: DOMRect; box: boolean }

const inside = (x: number, y: number, r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

/**
 * The element a point on screen snaps to, if any. `skip` leaves out ids (a line's own free end). `toward` is the
 * line's other end: dropped well inside an element, the nearest side is a coin toss, so the side facing it wins.
 */
export function snapAt(x: number, y: number, skip: ReadonlySet<string> = new Set(), toward?: { x: number; y: number }): Snapped | null {
  const all: Seen[] = []
  document.querySelectorAll<HTMLElement>('.react-flow__node').forEach((el) => {
    const id = el.dataset.id
    if (!id || el.classList.contains('react-flow__node-point')) return
    all.push({ id, rect: el.getBoundingClientRect(), box: el.classList.contains('react-flow__node-box') })
  })
  // a container: a box, or anything with the centre of another element on it
  const isContainer = (s: Seen) => s.box || all.some((o) => o !== s && inside(o.rect.left + o.rect.width / 2, o.rect.top + o.rect.height / 2, s.rect)
    && o.rect.width * o.rect.height < s.rect.width * s.rect.height)

  let best: { s: Seen; score: number; area: number; deep: boolean } | null = null
  for (const s of all) {
    if (skip.has(s.id)) continue
    const r = s.rect, inRect = inside(x, y, r)
    const outside = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
    const toBorder = inRect ? Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y) : outside
    const container = isContainer(s)
    // how far the point is from counting: 0 anywhere on a plain element, the distance to the border on a container
    const d = container ? toBorder : inRect ? 0 : outside
    if (d > SNAP) continue
    // anything else within reach wins over a container, and among equals the smaller (inner) element wins
    const score = d + (container ? SNAP + 1 : 0), area = r.width * r.height
    if (!best || score < best.score || (score === best.score && area < best.area)) best = { s, score, area, deep: inRect && toBorder > SNAP }
  }
  if (!best) return null
  const r = best.s.rect
  const dist: Record<Side, number> = { l: Math.abs(x - r.left), r: Math.abs(r.right - x), t: Math.abs(y - r.top), b: Math.abs(r.bottom - y) }
  let side = (Object.keys(dist) as Side[]).reduce((a, b) => (dist[a] <= dist[b] ? a : b))
  // where along that side: the drop's own position, kept off the very corners
  let at = side === 't' || side === 'b' ? (x - r.left) / r.width : (y - r.top) / r.height
  at = Math.round(Math.min(0.95, Math.max(0.05, at)) * 100) / 100
  if (best.deep && toward) {
    // dropped well inside: meet the side that faces the other end, at its middle
    const dx = toward.x - (r.left + r.width / 2), dy = toward.y - (r.top + r.height / 2)
    side = Math.abs(dx) / r.width >= Math.abs(dy) / r.height ? (dx >= 0 ? 'r' : 'l') : (dy >= 0 ? 'b' : 't')
    at = 0.5
  }
  return { id: best.s.id, side, at, handle: handleAt(side, at), rect: r }
}
