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
function natural(id: string, atWidth?: number): { w: number; h: number } | null {
  const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
  const inner = node?.querySelector<HTMLElement>('.el-in > *')
  if (!node || !inner) return null
  const copy = inner.cloneNode(true) as HTMLElement
  // free, its natural width (up to MAX_W); at a given width, how tall the words are when they wrap at it
  Object.assign(copy.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    width: atWidth ? `${atWidth}px` : 'max-content', maxWidth: atWidth ? 'none' : `${MAX_W}px`, height: 'auto' })
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

/**
 * Fit an element to its words. `grow` only ever makes it bigger: what typing does. `keepWidth` grows it taller
 * only, wrapping at the width it has: for words that changed elsewhere, so a card sized narrow stays narrow.
 */
export function fitToText(id: string, grow = false, keepWidth = false) {
  requestAnimationFrame(() => {
    const s = useApp.getState()
    const n = s.nodes.find((x) => x.id === id)
    if (!n || !HUGS.includes(n.type as Kind)) return
    const want = natural(id, keepWidth ? n.width ?? undefined : undefined)
    if (!want) return
    const [mw, mh] = MIN[n.type as Kind] ?? [0, 0]
    const w0 = n.width ?? 0, h0 = n.height ?? 0
    // An element sized by Atelier (a new one, or "Fit to words") follows its words both ways. One sized by hand
    // only grows, so its words are never cut off but the size chosen is never taken away. (Grow-only for
    // everything let a paste into a narrow element balloon it: tall while narrow, then wide, and kept both.)
    const auto = !!n.data.auto || !grow
    // keeping its width means exactly that: only the height moves
    let w = keepWidth && w0 ? w0 : Math.max(mw, want.w), h = Math.max(mh, want.h)
    if (grow) w = Math.max(w0, w)
    if (auto) {
      // the height its words need at the width it ends up with, not at their natural width
      const at = w !== want.w ? natural(id, w) : want
      h = Math.max(mh, at?.h ?? h)
    } else if (grow) h = Math.max(h0, h)
    if (w === w0 && h === h0 && auto === !!n.data.auto) return
    useApp.setState({ nodes: s.nodes.map((x) => (x.id === id
      ? { ...x, width: w, height: h, data: auto && !x.data.auto ? { ...x.data, auto: true } : x.data } : x)), saved: false })
  })
}

/**
 * While a field is open on an element: grow the element (taller only) until what is inside it fits, measured
 * from the real text box, which is a little taller than the same words drawn as text.
 */
export function growToContent(id: string) {
  requestAnimationFrame(() => {
    const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
    const inner = node?.querySelector<HTMLElement>('.el-in > *')
    if (!node || !inner) return
    // the full height of what is inside, top to bottom: centred words spill out above as well as below, and
    // scrollHeight only counts below. Measured on screen, then back to canvas pixels.
    const scale = node.getBoundingClientRect().height / node.offsetHeight || 1
    const kids = [...inner.children].map((k) => k.getBoundingClientRect())
    if (!kids.length) return
    const box = inner.getBoundingClientRect()
    const pad = inner.offsetHeight - inner.clientHeight + (parseFloat(getComputedStyle(inner).paddingTop) + parseFloat(getComputedStyle(inner).paddingBottom))
    const used = (Math.max(...kids.map((k) => k.bottom)) - Math.min(...kids.map((k) => k.top))) / scale + pad
    const over = Math.max(inner.scrollHeight - inner.clientHeight, used - box.height / scale)
    if (over <= 1) return
    useApp.setState((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, height: (n.height ?? node.offsetHeight) + over + 2 } : n)), saved: false }))
  })
}

// Words that changed anywhere (typed on the card, in the panel, by the AI, by an import) or a diagram just
// opened: each changed element grows to fit its words, so nothing is ever cut off. Growing only: a size set by
// hand is never shrunk.
let lastData = new Map<string, unknown>()
useApp.subscribe((s) => {
  const changed: string[] = []
  const now = new Map<string, unknown>()
  for (const n of s.nodes) {
    now.set(n.id, n.data)
    // the element being typed into fits as you type (the field does it); everything else, here
    if (lastData.get(n.id) !== n.data && n.id !== s.editing) changed.push(n.id)
  }
  lastData = now
  for (const id of changed) fitToText(id, true, true)
})

// A field being typed into is a textarea, and the words lay out a little differently once editing ends and
// they are drawn as text again. Fit once more at that moment, so what you leave is never cut off.
let lastEditing: string | null = null
useApp.subscribe((s) => {
  if (lastEditing && s.editing !== lastEditing) fitToText(lastEditing, true)
  lastEditing = s.editing
})
