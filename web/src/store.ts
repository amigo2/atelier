// The open diagram and everything that changes it. One store, so the canvas, the inspector and (later) the AI
// change the same thing the same way. Undo keeps snapshots: checkpoint() is called before a change that should
// be one step (a drag, a resize, an edit, an add), never on selection.
import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react'
import { EDGE_DEFAULTS, NEW, newId, toNode, type El, type ElData, type Kind } from './model'

type Snap = { nodes: El[]; edges: Edge[] }
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
  saved: boolean
  onNodesChange: (c: NodeChange<El>[]) => void
  onEdgesChange: (c: EdgeChange[]) => void
  onConnect: (c: Connection) => void
  checkpoint: () => void
  add: (kind: Kind, at: { x: number; y: number }, data?: Partial<ElData>) => string
  update: (id: string, patch: Partial<ElData>) => void
  updateEdge: (id: string, label: string) => void
  remove: (ids: string[]) => void
  duplicate: () => void
  toFront: (id: string, front: boolean) => void
  undo: () => void
  redo: () => void
  setEditing: (id: string | null) => void
  load: (id: string, name: string, s: Snap) => void
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
  saved: true,

  onNodesChange: (changes) => {
    // removing is a step of its own (Delete/Backspace on the canvas); moves and resizes are checkpointed when they start
    if (changes.some((c) => c.type === 'remove')) get().checkpoint()
    const changed = changes.some((c) => c.type !== 'select')
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), ...(changed ? { saved: false } : {}) }))
    if (changes.some((c) => c.type === 'remove')) {
      const gone = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
      set((s) => ({ edges: s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)) }))
    }
  },
  onEdgesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) get().checkpoint()
    const changed = changes.some((c) => c.type !== 'select')
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges), ...(changed ? { saved: false } : {}) }))
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
  update: (id, patch) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), saved: false })),
  updateEdge: (id, label) => set((s) => ({ edges: s.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)), saved: false })),
  remove: (ids) => {
    if (!ids.length) return
    get().checkpoint()
    const gone = new Set(ids)
    set((s) => ({
      nodes: s.nodes.filter((n) => !gone.has(n.id)),
      edges: s.edges.filter((e) => !gone.has(e.id) && !gone.has(e.source) && !gone.has(e.target)),
      saved: false,
    }))
  },
  duplicate: () => {
    const sel = get().nodes.filter((n) => n.selected)
    if (!sel.length) return
    get().checkpoint()
    const copies = sel.map((n) => ({ ...n, id: newId(n.type!), position: { x: n.position.x + 24, y: n.position.y + 24 }, selected: true, data: { ...n.data } }))
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...copies], saved: false }))
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
  load: (id, name, s) => set({ id, name, ...s, past: [], future: [], editing: null, saved: true }),
  rename: (name) => set({ name, saved: false }),
  markSaved: () => set({ saved: true }),
}))
