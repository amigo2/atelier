// Which element is drawn over which. One rule, worked out from where things are, never stored:
//
//   what sits inside something is drawn above it.
//
// A card dropped into a frame comes to the front of that frame; dragged out, it drops back. A box is not special:
// a box on top of a card is drawn on top of it. Among elements at the same depth, the order of the list decides,
// and that is what Front and Back change. Lines are drawn above every element, and a line's free end with them.
import type { El } from './model'

/** Lines (and their free ends) sit above any depth an element can reach. */
export const LINE_Z = 10_000

const box = (n: El) => ({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0 })

/** Each element with its zIndex: how many elements it sits inside. Unchanged elements are returned as they were. */
export function withLayers(nodes: El[]): El[] {
  const rects = nodes.map(box)
  return nodes.map((n, i) => {
    let z: number
    if (n.type === 'point') z = LINE_Z
    else {
      const r = rects[i]
      z = 0
      for (let j = 0; j < nodes.length; j++) {
        if (j === i || nodes[j].type === 'point') continue
        const o = rects[j]
        // inside: wholly within it, and smaller (two identical rectangles do not hold each other)
        if (o.x <= r.x && o.y <= r.y && o.x + o.w >= r.x + r.w && o.y + o.h >= r.y + r.h && o.w * o.h > r.w * r.h) z++
      }
    }
    return n.zIndex === z ? n : { ...n, zIndex: z }
  })
}
