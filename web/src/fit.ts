// Sizing an element to its words: a new card is as big as what it says, and grows as you type rather than
// cutting off. It never shrinks something you sized by hand: growing is automatic, shrinking is yours.
import type { Kind } from './model'
import { useApp } from './store'

// The kinds whose size is their text. A box is a frame for other things, and an image, an icon or a chart
// has a size of its own.
const HUGS: Kind[] = ['card', 'text', 'pill', 'list', 'table']

// A paragraph would otherwise measure as one long line.
const MAX_W = 480
const MIN: Partial<Record<Kind, [number, number]>> = { card: [120, 60], text: [40, 24], pill: [56, 26], list: [80, 30], table: [120, 40] }

/**
 * How big the element's content wants to be. A hidden copy of it is laid out inside the same node, so it gets
 * the same fonts and rules, but with nothing holding its width.
 */
function natural(id: string): { w: number; h: number } | null {
  const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
  const inner = node?.querySelector<HTMLElement>('.el-in > *')
  if (!node || !inner) return null
  const copy = inner.cloneNode(true) as HTMLElement
  Object.assign(copy.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    width: 'max-content', maxWidth: `${MAX_W}px`, height: 'auto' })
  // a field being edited is a textarea, which has no natural width: measure its words instead
  copy.querySelectorAll('textarea').forEach((t) => {
    const d = document.createElement('div')
    d.className = t.className.replace(/\bedit\b/, '')
    d.style.whiteSpace = 'pre-wrap'
    d.textContent = (t.value || t.placeholder) + (t.value.endsWith('\n') ? ' ' : '')
    t.replaceWith(d)
  })
  node.appendChild(copy)
  // offsetWidth rounds to a whole pixel, and a line that needs 64.4px wraps in a 64px box: give it two spare
  const size = { w: Math.ceil(copy.offsetWidth) + 2, h: Math.ceil(copy.offsetHeight) + 2 }
  copy.remove()
  return size
}

/** Fit an element to its words. `grow` only ever makes it bigger: what typing does. */
export function fitToText(id: string, grow = false) {
  requestAnimationFrame(() => {
    const s = useApp.getState()
    const n = s.nodes.find((x) => x.id === id)
    if (!n || !HUGS.includes(n.type as Kind)) return
    const want = natural(id)
    if (!want) return
    const [mw, mh] = MIN[n.type as Kind] ?? [0, 0]
    const w0 = n.width ?? 0, h0 = n.height ?? 0
    let w = Math.max(mw, want.w), h = Math.max(mh, want.h)
    if (grow) { w = Math.max(w0, w); h = Math.max(h0, h) }
    if (w === w0 && h === h0) return
    useApp.setState({ nodes: s.nodes.map((x) => (x.id === id ? { ...x, width: w, height: h } : x)), saved: false })
  })
}

// A field being typed into is a textarea, and the words lay out a little differently once editing ends and
// they are drawn as text again. Fit once more at that moment, so what you leave is never cut off.
let lastEditing: string | null = null
useApp.subscribe((s) => {
  if (lastEditing && s.editing !== lastEditing) fitToText(lastEditing, true)
  lastEditing = s.editing
})
