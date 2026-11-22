// The open diagram and everything that changes it. One store, so the canvas, the inspector and (later) the AI
// change the same thing the same way. Undo keeps snapshots: checkpoint() is called before a change that should
// be one step (a drag, a resize, an edit, an add), never on selection.
import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react'
import { EDGE_DEFAULTS, NEW, POINT, PRESETS, edgeLook, lockProps, nextPageAt, newId, toNode, type El, type ElData, type Kind, type Look, type Page } from './model'

type Snap = { nodes: El[]; edges: Edge[] }

/** One end of a line: on a side of an element, or free at a spot on the canvas (flow coordinates). */
export type End = { node: string; side: string } | { x: number; y: number }

const pointAt = (x: number, y: number): El => toNode(newId('pt'), 'point', Math.round(x - POINT / 2), Math.round(y - POINT / 2), POINT, POINT, { color: 'ink' })

// ⌥-click picks one member of a group on its own. The click's modifier is read when the pointer goes down,
// before React Flow turns it into a selection change.
let solo = false
if (typeof window !== 'undefined') window.addEventListener('pointerdown', (e) => { solo = e.altKey }, true)

/** Selecting one member of a group selects all of it; deselecting one deselects all of it (unless ⌥ is held). */
function withGroups(changes: NodeChange<El>[], nodes: El[]): El[] {
  if (solo) return nodes
  const groupOf = new Map(nodes.filter((n) => n.data.group).map((n) => [n.id, n.data.group!]))
  const on = new Set<string>(), off = new Set<string>()
  for (const c of changes) if (c.type === 'select' && groupOf.has(c.id)) (c.selected ? on : off).add(groupOf.get(c.id)!)
  if (!on.size && !off.size) return nodes
  return nodes.map((n) => {
    const g = n.data.group
    if (!g) return n
    if (on.has(g) && !n.selected) return { ...n, selected: true }
    if (off.has(g) && !on.has(g) && n.selected) return { ...n, selected: false }
    return n
  })
}

/** A free end belongs to its line: when no line uses it any more, it goes. */
function prune(nodes: El[], edges: Edge[]): El[] {
  const used = new Set(edges.flatMap((e) => [e.source, e.target]))
  return nodes.some((n) => n.type === 'point' && !used.has(n.id)) ? nodes.filter((n) => n.type !== 'point' || used.has(n.id)) : nodes
}
const LIMIT = 100
let pending = false

export interface State {
  id: string
  name: string
  nodes: El[]
  edges: Edge[]
  past: Snap[]
  future: Snap[]
  editing: string | null // the element whose text is being edited in place
  pages: Page[] // the artboards: one per page of the PDF, in reading order
  saved: boolean
  onNodesChange: (c: NodeChange<El>[]) => void
  onEdgesChange: (c: EdgeChange[]) => void
  onConnect: (c: Connection) => void
  checkpoint: () => void
  add: (kind: Kind, at: { x: number; y: number }, data?: Partial<ElData>) => string
  update: (id: string, patch: Partial<ElData>) => void
  updateEdge: (id: string, label: string) => void
  updateEdgeLook: (id: string, patch: Look) => void
  addLine: (from: End, to: End, look: Look) => string
  moveEnd: (edgeId: string, end: 'source' | 'target', to: End, step?: boolean) => void
  liftLine: (edgeId: string, from: { x: number; y: number }, to: { x: number; y: number }) => [string, string] | null
  remove: (ids: string[]) => void
  duplicate: () => void
  group: () => void
  ungroup: () => void
  toFront: (id: string, front: boolean) => void
  undo: () => void
  redo: () => void
  setEditing: (id: string | null) => void
  load: (id: string, name: string, s: Snap, pages?: Page[]) => void
  setFrame: (on: boolean, preset?: string) => void
  addPage: (preset?: string) => string
  removePage: (id: string) => void
  setPagePreset: (id: string, preset: string) => void
  renamePage: (id: string, name: string) => void
  replace: (s: Snap) => void
  rename: (name: string) => void
  markSaved: () => void
}

const snap = (s: State): Snap => ({ nodes: s.nodes, edges: s.edges })

export const useApp = create<State>((set, get) => ({
  id: newId('d'),
  name: 'Untitled',
  nodes: [],
  edges: [],
  past: [],
  future: [],
  editing: null,
  pages: [],
  saved: true,

  onNodesChange: (changes) => {
    // removing is a step of its own (Delete/Backspace on the canvas); moves and resizes are checkpointed when they start
    if (changes.some((c) => c.type === 'remove')) get().checkpoint()
    const changed = changes.some((c) => c.type !== 'select')
    set((s) => ({ nodes: withGroups(changes, applyNodeChanges(changes, s.nodes)), ...(changed ? { saved: false } : {}) }))
    if (changes.some((c) => c.type === 'remove')) {
      const gone = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
      set((s) => { const edges = s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)); return { edges, nodes: prune(s.nodes, edges) } })
    }
  },
  onEdgesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) get().checkpoint()
    const changed = changes.some((c) => c.type !== 'select')
    set((s) => { const edges = applyEdgeChanges(changes, s.edges); return { edges, nodes: prune(s.nodes, edges), ...(changed ? { saved: false } : {}) } })
  },
  onConnect: (c) => {
    if (!c.source || !c.target || c.source === c.target) return
    get().checkpoint()
    set((s) => ({ edges: addEdge({ ...c, id: newId('a'), ...EDGE_DEFAULTS }, s.edges), saved: false }))
  },

  // changes made together (a shape and its arrows deleted with one key) are one step: one checkpoint per tick
  checkpoint: () => {
    if (pending) return
    pending = true
    queueMicrotask(() => { pending = false })
    set((s) => ({ past: [...s.past.slice(-LIMIT + 1), snap(s)], future: [] }))
  },

  add: (kind, at, data) => {
    get().checkpoint()
    const d = NEW[kind], id = newId(kind)
    let x = Math.round(at.x - d.w / 2), y = Math.round(at.y - d.h / 2)
    while (get().nodes.some((n) => n.position.x === x && n.position.y === y)) { x += 24; y += 24 }   // never exactly on another
    const n = toNode(id, kind, x, y, d.w, d.h, { ...d.data, ...data })
    set((s) => ({ nodes: [...s.nodes.map((x) => ({ ...x, selected: false })), { ...n, selected: true }], saved: false }))
    return id
  },
  update: (id, patch) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch }, ...('locked' in patch ? lockProps(patch.locked) : {}) } : n)), saved: false })),
  updateEdgeLook: (id, patch) => {
    get().checkpoint()
    set((s) => ({ edges: s.edges.map((e) => (e.id === id ? { ...e, ...edgeLook({ ...(e.data as Look), ...patch }) } : e)), saved: false }))
  },
  addLine: (from, to, look) => {
    get().checkpoint()
    const pts: El[] = []
    const ref = (e: End) => {
      if ('node' in e) return { id: e.node, handle: e.side }
      const p = pointAt(e.x, e.y); pts.push(p); return { id: p.id, handle: 'c' }
    }
    const a = ref(from), b = ref(to), id = newId('a')
    const edge: Edge = { id, source: a.id, sourceHandle: a.handle, target: b.id, targetHandle: b.handle, ...edgeLook(look), selected: true }
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...pts],
      edges: [...s.edges.map((e) => ({ ...e, selected: false })), edge], saved: false,
    }))
    return id
  },
  moveEnd: (edgeId, end, to, step = true) => {
    if (step) get().checkpoint()
    set((s) => {
      const e = s.edges.find((x) => x.id === edgeId)
      if (!e) return {}
      let nodes = s.nodes, at = { id: '', handle: 'c' }
      if ('node' in to) at = { id: to.node, handle: to.side }
      else { const p = pointAt(to.x, to.y); nodes = [...nodes, p]; at = { id: p.id, handle: 'c' } }
      const moved = end === 'source' ? { ...e, source: at.id, sourceHandle: at.handle } : { ...e, target: at.id, targetHandle: at.handle }
      if (moved.source === moved.target) return {}
      const edges = s.edges.map((x) => (x.id === edgeId ? moved : x))
      return { edges, nodes: prune(nodes, edges), saved: false }
    })
  },
  // Picking a whole line up to move it: both ends become free points where they are now (an end on a shape
  // comes loose), so dragging the two points moves the line. The caller has already made this one undo step.
  liftLine: (edgeId, from, to) => {
    const s = get(), e = s.edges.find((x) => x.id === edgeId)
    if (!e) return null
    const nodes = [...s.nodes]
    const free = (id: string, at: { x: number; y: number }) => {
      if (nodes.find((n) => n.id === id)?.type === 'point') return id
      const p = pointAt(at.x, at.y); nodes.push(p); return p.id
    }
    const a = free(e.source, from), b = free(e.target, to)
    const edges = s.edges.map((x) => (x.id === edgeId ? { ...x, source: a, sourceHandle: 'c', target: b, targetHandle: 'c', selected: true } : { ...x, selected: false }))
    set({ nodes: prune(nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), edges), edges, saved: false })
    return [a, b]
  },
  updateEdge: (id, label) => set((s) => ({ edges: s.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)), saved: false })),
  remove: (ids) => {
    // a locked element is not deleted, however it was asked for: by key, by button, or among several
    const locked = new Set(get().nodes.filter((n) => n.data.locked).map((n) => n.id))
    ids = ids.filter((i) => !locked.has(i))
    if (!ids.length) return
    get().checkpoint()
    const gone = new Set(ids)
    set((s) => ({
      nodes: s.nodes.filter((n) => !gone.has(n.id)),
      edges: s.edges.filter((e) => !gone.has(e.id) && !gone.has(e.source) && !gone.has(e.target)),
      saved: false,
    }))
    set((s) => ({ nodes: prune(s.nodes, s.edges) }))
  },
  duplicate: () => {
    const sel = get().nodes.filter((n) => n.selected && n.type !== 'point')   // a line's end is not copied without its line
    if (!sel.length) return
    get().checkpoint()
    // a copied group is a new group: the copy and the original move separately
    const regroup = new Map<string, string>()
    const g = (id?: string) => { if (!id) return undefined; if (!regroup.has(id)) regroup.set(id, newId('g')); return regroup.get(id) }
    const copies = sel.map((n) => ({ ...n, id: newId(n.type!), position: { x: n.position.x + 24, y: n.position.y + 24 }, selected: true,
      data: { ...n.data, ...(n.data.group ? { group: g(n.data.group) } : {}) } }))
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...copies], saved: false }))
  },
  group: () => {
    const sel = get().nodes.filter((n) => n.selected && n.type !== 'point')
    if (sel.length < 2) return
    get().checkpoint()
    // groups do not nest: grouping members of other groups folds them all into the new one
    const ids = new Set(sel.map((n) => n.id)), id = newId('g')
    set((s) => ({ nodes: s.nodes.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, group: id } } : n)), saved: false }))
  },
  ungroup: () => {
    const sel = get().nodes.filter((n) => n.selected && n.data.group)
    if (!sel.length) return
    get().checkpoint()
    const gone = new Set(sel.map((n) => n.data.group))
    set((s) => ({ nodes: s.nodes.map((n) => {
      if (!n.data.group || !gone.has(n.data.group)) return n
      const { group: _, ...data } = n.data
      return { ...n, data }
    }), saved: false }))
  },
  toFront: (id, front) => {
    get().checkpoint()
    set((s) => {
      const n = s.nodes.find((x) => x.id === id)
      if (!n) return {}
      const rest = s.nodes.filter((x) => x.id !== id)
      return { nodes: front ? [...rest, n] : [n, ...rest], saved: false }
    })
  },

  undo: () => set((s) => {
    const prev = s.past[s.past.length - 1]
    return prev ? { ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future], editing: null, saved: false } : {}
  }),
  redo: () => set((s) => {
    const next = s.future[0]
    return next ? { ...next, future: s.future.slice(1), past: [...s.past, snap(s)], editing: null, saved: false } : {}
  }),

  setEditing: (id) => {
    if (id && get().editing !== id) get().checkpoint() // the edit, whatever is typed, is one step
    set({ editing: id })
  },
  // the AI's change, as one step; what was selected stays selected if it's still there
  replace: (next) => {
    get().checkpoint()
    const sel = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id))
    set({ nodes: next.nodes.map((n) => (sel.has(n.id) ? { ...n, selected: true } : n)), edges: next.edges, editing: null, saved: false })
  },
  load: (id, name, s, pages = []) => set({ id, name, ...s, pages, past: [], future: [], editing: null, saved: true }),
  // The ▭ toggle: on gives the document its first page, sized to the preset and centred on whatever is
  // drawn; off removes every page, and the export goes back to cropping to the drawing.
  setFrame: (on, preset) => set((s) => {
    if (!on) return { pages: [], saved: false }
    const p = PRESETS.find((x) => x.id === (preset ?? s.pages[0]?.preset)) ?? PRESETS[0]
    if (s.pages.length) {
      // Changing the preset keeps each page's centre, so the deck does not jump around.
      return {
        pages: s.pages.map((pg) => ({
          ...pg, preset: p.id, w: p.w, h: p.h,
          x: Math.round((pg.x + pg.w / 2 - p.w / 2) / 8) * 8,
          y: Math.round((pg.y + pg.h / 2 - p.h / 2) / 8) * 8,
        })),
        saved: false,
      }
    }
    let cx: number, cy: number
    if (s.nodes.length) {
      const xs = s.nodes.flatMap((n) => [n.position.x, n.position.x + (n.width ?? 0)]), ys = s.nodes.flatMap((n) => [n.position.y, n.position.y + (n.height ?? 0)])
      cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2
    } else { cx = p.w / 2; cy = p.h / 2 }
    return { pages: [{ id: newId('p'), name: 'Page 1', x: Math.round((cx - p.w / 2) / 8) * 8, y: Math.round((cy - p.h / 2) / 8) * 8, w: p.w, h: p.h, preset: p.id }], saved: false }
  }),

  addPage: (preset) => {
    get().checkpoint()
    const s = get()
    const p = PRESETS.find((x) => x.id === (preset ?? s.pages[0]?.preset)) ?? PRESETS[0]
    const at = nextPageAt(s.pages)
    const id = newId('p')
    set({ pages: [...s.pages, { id, name: `Page ${s.pages.length + 1}`, ...at, w: p.w, h: p.h, preset: p.id }], saved: false })
    return id
  },
  // Only the page goes: what was drawn on it stays on the canvas as scratch, because deleting a page and
  // silently deleting an afternoon's work are not the same thing and one of them is unforgivable.
  removePage: (id) => {
    get().checkpoint()
    set((s) => ({ pages: s.pages.filter((p) => p.id !== id), saved: false }))
  },
  setPagePreset: (id, preset) => set((s) => {
    const p = PRESETS.find((x) => x.id === preset)
    if (!p) return {}
    return {
      pages: s.pages.map((pg) => (pg.id === id ? {
        ...pg, preset: p.id, w: p.w, h: p.h,
        x: Math.round((pg.x + pg.w / 2 - p.w / 2) / 8) * 8,
        y: Math.round((pg.y + pg.h / 2 - p.h / 2) / 8) * 8,
      } : pg)),
      saved: false,
    }
  }),
  renamePage: (id, name) => set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)), saved: false })),

  rename: (name) => set({ name, saved: false }),
  markSaved: () => set({ saved: true }),
}))
