// Where a line end lands: on an element's edge if it was let go near one, or free on the canvas.
//
// Gentle on purpose. Within SNAP screen pixels of an element (or anywhere inside it), the end attaches to the
// nearest side; any further and it stays exactly where it was dropped. A strong magnet makes it impossible to
// end a line in the empty space beside a card, which is half of what lines are for.

export const SNAP = 12
export type Side = 't' | 'r' | 'b' | 'l'
export type Snapped = { id: string; side: Side; rect: DOMRect }

/** The element a point on screen snaps to, if any. `skip` leaves out ids (a line's own free end). */
export function snapAt(x: number, y: number, skip: ReadonlySet<string> = new Set()): Snapped | null {
  let best: { id: string; rect: DOMRect; score: number; area: number } | null = null
  document.querySelectorAll<HTMLElement>('.react-flow__node').forEach((el) => {
    const id = el.dataset.id
    if (!id || skip.has(id) || el.classList.contains('react-flow__node-point')) return
    const r = el.getBoundingClientRect()
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
    if (d > SNAP) return
    // A box is a frame around other things: being inside one is not a wish to attach to it. Anything else
    // within reach wins over it, and among equals the smaller (inner) element wins.
    const score = d + (el.classList.contains('react-flow__node-box') ? SNAP + 1 : 0)
    const area = r.width * r.height
    if (!best || score < best.score || (score === best.score && area < best.area)) best = { id, rect: r, score, area }
  })
  if (!best) return null
  const { id, rect: r } = best as { id: string; rect: DOMRect }
  const dist: Record<Side, number> = { l: Math.abs(x - r.left), r: Math.abs(r.right - x), t: Math.abs(y - r.top), b: Math.abs(r.bottom - y) }
  const side = (Object.keys(dist) as Side[]).reduce((a, b) => (dist[a] <= dist[b] ? a : b))
  return { id, side, rect: r }
}
