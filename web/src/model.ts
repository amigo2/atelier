// What a diagram is, on disk and for the AI: elements (cards, text, boxes, pills) and arrows between them.
// The canvas works on React Flow nodes and edges; toDoc / fromDoc translate, so the saved file stays small
// and readable (no React Flow internals in it).
import { MarkerType, type Edge, type Node } from '@xyflow/react'

export const PALETTE = {
  ink: { fg: '#1a2233', bg: '#ffffff', line: '#1a2233' },
  grey: { fg: '#616c81', bg: '#f6f7fb', line: '#d7dced' },
  blue: { fg: '#3a6df0', bg: '#e9f0ff', line: '#b9ccfb' },
  violet: { fg: '#6a4fd0', bg: '#efeaff', line: '#cfc2f5' },
  teal: { fg: '#0e8a86', bg: '#e2f5f3', line: '#a9ddd9' },
  green: { fg: '#12835a', bg: '#e6f4ec', line: '#acdcc2' },
  amber: { fg: '#a9700a', bg: '#f9efd8', line: '#ecd29a' },
  red: { fg: '#c9362d', bg: '#fdeceb', line: '#f2b9b5' },
} as const
export type Color = keyof typeof PALETTE
export const COLORS = Object.keys(PALETTE) as Color[]

export type Kind = 'card' | 'text' | 'box' | 'pill' | 'list' | 'table' | 'image' | 'bars' | 'icon'
export type TextSize = 'title' | 'heading' | 'label' | 'body'

export type ElData = {
  color: Color
  emoji?: string // card
  title?: string // card, box (its label)
  sub?: string // card
  text?: string // text, pill
  size?: TextSize // text, list
  items?: string[] // list: one line each
  rows?: string[][] // table: rows of cells, the first one the header unless head is false
  head?: boolean // table
  src?: string // image: the URL the API serves it from
  fit?: 'cover' | 'contain' // image: fill the box and crop, or sit inside it whole
  alt?: string // image
  bars?: { label: string; value: number; note?: string }[] // bars
  icon?: string // card, icon: a Lucide name in kebab-case, e.g. "house", "key-round"
  // Type size in px, when the named size is not what this element needs. A diagram's title on a 180px
  // card and a slide's title on a 1600px page are both "title" and cannot be the same size; without this
  // every import onto a page comes out looking like a text dump.
  fs?: number
}

// Anywhere words are shown, **two asterisks** make a word bold. One word emphasised is what a slide needs;
// anything more is a word processor, and this is not one.
export type El = Node<ElData, Kind>

// the default size of each kind, and what a new one says
export const NEW: Record<Kind, { w: number; h: number; data: ElData }> = {
  card: { w: 180, h: 110, data: { color: 'blue', emoji: '', title: 'Title', sub: 'what it does' } },
  text: { w: 260, h: 44, data: { color: 'ink', text: 'Text', size: 'heading' } },
  box: { w: 420, h: 260, data: { color: 'grey', title: 'GROUP' } },
  pill: { w: 96, h: 30, data: { color: 'blue', text: 'label' } },
  list: { w: 420, h: 120, data: { color: 'ink', size: 'body', items: ['First', 'Second', 'Third'] } },
  table: { w: 520, h: 120, data: { color: 'ink', head: true, rows: [['Column', 'Column'], ['Cell', 'Cell'], ['Cell', 'Cell']] } },
  image: { w: 420, h: 280, data: { color: 'grey', fit: 'contain' } },
  icon: { w: 64, h: 64, data: { color: 'blue', icon: 'sparkles' } },
  bars: { w: 460, h: 260, data: { color: 'blue', bars: [{ label: '2027', value: 458 }, { label: '2028', value: 1260 }, { label: '2029', value: 2700 }] } },
}

export const arrow = (color = '#8a94a8') => ({ type: MarkerType.ArrowClosed, color, width: 18, height: 18 })
export const EDGE_DEFAULTS = { type: 'smoothstep', markerEnd: arrow(), style: { stroke: '#8a94a8', strokeWidth: 1.5 } } as const

// --- the file

export type DocElement = { id: string; kind: Kind; x: number; y: number; w: number; h: number } & ElData
export type DocArrow = { id: string; from: string; to: string; fromSide?: string; toSide?: string; label?: string }
export type Frame = { x: number; y: number; w: number; h: number; preset: string }

// A page is a frame with a name: one artboard on the canvas, one page of the PDF. Several of them make a
// deck. Elements are not owned by a page — the page that contains an element's centre is its page, the way
// an artboard works in every drawing tool. Anything outside every page is scratch, and is not exported.
export type Page = Frame & { id: string; name: string }

// `frame` is what a one-page document used to be, and is still written on save so an older reader (and the
// AI's summary) keeps working. `pages` is the truth when it is there.
export type Doc = { id: string; name: string; elements: DocElement[]; arrows: DocArrow[]; frame?: Frame | null; pages?: Page[] }

// the export frame's sizes: what the PNG will be, drawn on the canvas to draw into
export const PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: '16:9', label: '16:9 · 1600 × 900', w: 1600, h: 900 },
  { id: '4:3', label: '4:3 · 1200 × 900', w: 1200, h: 900 },
  { id: 'square', label: 'Square · 1080 × 1080', w: 1080, h: 1080 },
  { id: 'a4-land', label: 'A4 landscape · 1600 × 1131', w: 1600, h: 1131 },
  { id: 'a4-port', label: 'A4 portrait · 1131 × 1600', w: 1131, h: 1600 },
]

const num = (n: number | undefined, d: number) => Math.round(n ?? d)

export function toDoc(id: string, name: string, nodes: El[], edges: Edge[], pages: Page[] = []): Doc {
  const ordered = pagesInOrder(pages)
  return {
    id, name, pages: ordered,
    // the first page, as the old single frame: what reads `frame` keeps reading something sensible
    frame: ordered.length ? { x: ordered[0].x, y: ordered[0].y, w: ordered[0].w, h: ordered[0].h, preset: ordered[0].preset } : null,
    elements: nodes.map((n) => ({
      id: n.id, kind: n.type as Kind, x: Math.round(n.position.x), y: Math.round(n.position.y),
      w: num(n.width ?? n.measured?.width, NEW[n.type as Kind].w), h: num(n.height ?? n.measured?.height, NEW[n.type as Kind].h), ...n.data,
    })),
    arrows: edges.map((e) => ({
      id: e.id, from: e.source, to: e.target,
      ...(e.sourceHandle ? { fromSide: e.sourceHandle } : {}), ...(e.targetHandle ? { toSide: e.targetHandle } : {}),
      ...(e.label ? { label: String(e.label) } : {}),
    })),
  }
}

export function fromDoc(doc: Doc): { nodes: El[]; edges: Edge[] } {
  return {
    nodes: doc.elements.map(({ id, kind, x, y, w, h, ...data }) => toNode(id, kind, x, y, w, h, data)),
    edges: doc.arrows.map((a) => toEdge(a)),
  }
}

export function toNode(id: string, kind: Kind, x: number, y: number, w: number, h: number, data: ElData): El {
  return { id, type: kind, position: { x, y }, width: w, height: h, data, ...(kind === 'box' ? { zIndex: -1 } : {}) }
}

export function toEdge(a: DocArrow): Edge {
  return { id: a.id, source: a.from, target: a.to, sourceHandle: a.fromSide ?? null, targetHandle: a.toSide ?? null,
           ...(a.label ? { label: a.label } : {}), ...EDGE_DEFAULTS }
}

let seq = 0
export const newId = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`

// --- pages

// Reading order, and it is the page order: left to right, then top to bottom. Rows are judged by overlap
// rather than exact y, so a page nudged a few pixels up does not jump to the front of the deck.
export function pagesInOrder(pages: Page[]): Page[] {
  return [...pages].sort((a, b) => (a.y + a.h <= b.y ? -1 : b.y + b.h <= a.y ? 1 : a.x - b.x))
}

/** The page an element belongs to: the one its centre is inside. Null means it is scratch. */
export function pageOf(x: number, y: number, w: number, h: number, pages: Page[]): Page | null {
  const cx = x + w / 2, cy = y + h / 2
  return pages.find((p) => cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h) ?? null
}

/** Where a new page goes: to the right of the last one, with a gap, so a deck reads left to right. */
export function nextPageAt(pages: Page[]): { x: number; y: number } {
  if (!pages.length) return { x: 0, y: 0 }
  const last = pagesInOrder(pages)[pages.length - 1]
  return { x: last.x + last.w + 120, y: last.y }
}

export function pagesFromDoc(doc: Doc): Page[] {
  if (doc.pages?.length) return doc.pages
  // A document saved before pages existed: its one frame becomes page 1.
  if (doc.frame) return [{ ...doc.frame, id: newId('p'), name: 'Page 1' }]
  return []
}
