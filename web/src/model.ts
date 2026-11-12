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

export type Kind = 'card' | 'text' | 'box' | 'pill'
export type TextSize = 'title' | 'heading' | 'label' | 'body'

export type ElData = {
  color: Color
  emoji?: string // card
  title?: string // card, box (its label)
  sub?: string // card
  text?: string // text, pill
  size?: TextSize // text
}
export type El = Node<ElData, Kind>

// the default size of each kind, and what a new one says
export const NEW: Record<Kind, { w: number; h: number; data: ElData }> = {
  card: { w: 180, h: 110, data: { color: 'blue', emoji: '', title: 'Title', sub: 'what it does' } },
  text: { w: 260, h: 44, data: { color: 'ink', text: 'Text', size: 'heading' } },
  box: { w: 420, h: 260, data: { color: 'grey', title: 'GROUP' } },
  pill: { w: 96, h: 30, data: { color: 'blue', text: 'label' } },
}

export const arrow = (color = '#8a94a8') => ({ type: MarkerType.ArrowClosed, color, width: 18, height: 18 })
export const EDGE_DEFAULTS = { type: 'smoothstep', markerEnd: arrow(), style: { stroke: '#8a94a8', strokeWidth: 1.5 } } as const

// --- the file

export type DocElement = { id: string; kind: Kind; x: number; y: number; w: number; h: number } & ElData
export type DocArrow = { id: string; from: string; to: string; fromSide?: string; toSide?: string; label?: string }
export type Frame = { x: number; y: number; w: number; h: number; preset: string }
export type Doc = { id: string; name: string; elements: DocElement[]; arrows: DocArrow[]; frame?: Frame | null }

// the export frame's sizes: what the PNG will be, drawn on the canvas to draw into
export const PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: '16:9', label: '16:9 · 1600 × 900', w: 1600, h: 900 },
  { id: '4:3', label: '4:3 · 1200 × 900', w: 1200, h: 900 },
  { id: 'square', label: 'Square · 1080 × 1080', w: 1080, h: 1080 },
  { id: 'a4-land', label: 'A4 landscape · 1600 × 1131', w: 1600, h: 1131 },
  { id: 'a4-port', label: 'A4 portrait · 1131 × 1600', w: 1131, h: 1600 },
]

const num = (n: number | undefined, d: number) => Math.round(n ?? d)

export function toDoc(id: string, name: string, nodes: El[], edges: Edge[], frame: Frame | null = null): Doc {
  return {
    id, name, frame,
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
