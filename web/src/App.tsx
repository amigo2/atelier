// Atelier: a diagram editor. The canvas in the middle, what you can add on the left, the selected thing's
// colour and words on the right, the diagram's name, undo and export along the top. Saved as you go.
import { Background, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type FinalConnectionState } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { api, type Listing } from './api'
import { NODE_TYPES } from './components/Shapes'
import { Inspector } from './components/Inspector'
import { Chat } from './components/Chat'
import { exportPng } from './exportPng'
import { fromDoc, newId, toDoc, type ElData, type Kind } from './model'
import { useApp } from './store'

const LAST = 'atelier.last'

const TOOLS: { label: string; kind: Kind; data?: Partial<ElData>; hint: string }[] = [
  { label: 'Card', kind: 'card', hint: 'A step or a part: emoji, title and a line under it' },
  { label: 'Title', kind: 'text', data: { size: 'title', text: 'Title' }, hint: 'The diagram\'s title' },
  { label: 'Heading', kind: 'text', data: { size: 'heading', text: 'Heading' }, hint: 'A heading' },
  { label: 'Label', kind: 'text', data: { size: 'label', text: 'SECTION' }, hint: 'A small section label, in capitals' },
  { label: 'Text', kind: 'text', data: { size: 'body', text: 'Some text' }, hint: 'A paragraph' },
  { label: 'Box', kind: 'box', hint: 'A frame around a group' },
  { label: 'Pill', kind: 'pill', hint: 'A small tag' },
]

function Editor() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, checkpoint, name, saved, past, future } = useApp()
  const rf = useReactFlow()
  const [list, setList] = useState<Listing[] | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // add one where the view's centre is
  const add = (kind: Kind, data?: Partial<ElData>) => {
    const r = box.current!.getBoundingClientRect()
    const at = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    const id = useApp.getState().add(kind, at, data)
    useApp.getState().setEditing(null)
    return id
  }

  // open the last diagram, or start one
  useEffect(() => {
    const id = localStorage.getItem(LAST)
    if (id) api.get(id).then((d) => { useApp.getState().load(d.id, d.name, fromDoc(d)); setTimeout(() => rf.fitView({ padding: 0.2 }), 50) }).catch(() => localStorage.removeItem(LAST))
  }, [rf])

  // save as you go, a moment after the last change
  useEffect(() => {
    if (saved) return
    const t = setTimeout(async () => {
      const s = useApp.getState(), at = { nodes: s.nodes, edges: s.edges, name: s.name }
      await api.save(toDoc(s.id, s.name, s.nodes, s.edges))
      localStorage.setItem(LAST, s.id)
      const now = useApp.getState()
      if (now.nodes === at.nodes && now.edges === at.edges && now.name === at.name) now.markSaved()
    }, 600)
    return () => clearTimeout(t)
  }, [saved, nodes, edges, name])

  // keys: undo, redo, duplicate, and Escape to stop editing / deselect
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const mod = e.metaKey || e.ctrlKey, s = useApp.getState()
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicate() }
      else if (e.key === 'Enter') { const one = s.nodes.filter((n) => n.selected); if (one.length === 1) { e.preventDefault(); s.setEditing(one[0].id) } }
      else if (e.key === 'Escape') { s.setEditing(null); rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: false }))) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rf])

  // an arrow dropped anywhere on a shape (not only on its dot) connects to the side of it nearest the drop
  const onConnectEnd = (e: MouseEvent | TouchEvent, c: FinalConnectionState) => {
    if (c.isValid || !c.fromNode) return
    const p = 'changedTouches' in e ? e.changedTouches[0] : e
    const el = document.elementFromPoint(p.clientX, p.clientY)?.closest<HTMLElement>('.react-flow__node')
    const to = el?.dataset.id
    if (!el || !to || to === c.fromNode.id) return
    const r = el.getBoundingClientRect()
    const dx = (p.clientX - (r.left + r.width / 2)) / r.width, dy = (p.clientY - (r.top + r.height / 2)) / r.height
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't')
    onConnect({ source: c.fromNode.id, sourceHandle: c.fromHandle?.id ?? null, target: to, targetHandle: side })
  }

  const fresh = () => { useApp.getState().load(newId('d'), 'Untitled', { nodes: [], edges: [] }); setList(null) }
  const open = async (id: string) => { const d = await api.get(id); useApp.getState().load(d.id, d.name, fromDoc(d)); localStorage.setItem(LAST, d.id); setList(null); setTimeout(() => rf.fitView({ padding: 0.2 }), 50) }

  return (
    <div className="app">
      <header className="top">
        <b className="brand">✦ Atelier</b>
        <input className="name" value={name} onChange={(e) => useApp.getState().rename(e.target.value)} aria-label="Diagram name" />
        <span className="saved">{saved ? 'Saved' : 'Saving…'}</span>
        <span className="sep" />
        <nav className="tools" aria-label="Add">
          {TOOLS.map((t) => <button key={t.label} onClick={() => add(t.kind, t.data)} title={t.hint}>{t.label}</button>)}
        </nav>
        <span className="grow" />
        <button onClick={fresh} title="Start a new diagram">New</button>
        <div className="open">
          <button onClick={async () => setList(list ? null : await api.list())} title="Open a saved diagram">Open ▾</button>
          {list && (
            <div className="menu" role="menu">
              {list.length ? list.map((d) => <button key={d.id} role="menuitem" onClick={() => open(d.id)}>{d.name}<span>{new Date(d.updated * 1000).toLocaleString()}</span></button>)
                : <p>No saved diagrams yet.</p>}
            </div>
          )}
        </div>
        <button onClick={() => useApp.getState().undo()} disabled={!past.length} title="Undo (⌘Z)">↶</button>
        <button onClick={() => useApp.getState().redo()} disabled={!future.length} title="Redo (⇧⌘Z)">↷</button>
        <button className="primary" onClick={() => exportPng(nodes, edges, name)} disabled={!nodes.length} title="Download the diagram as a PNG">Export PNG</button>
      </header>
      <Chat />
      <main className="canvas" ref={box}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onConnectEnd={onConnectEnd} connectionRadius={30} onNodeDragStart={checkpoint} connectionMode={ConnectionMode.Loose} deleteKeyCode={['Backspace', 'Delete']}
          snapToGrid snapGrid={[8, 8]} defaultViewport={{ x: 0, y: 0, zoom: 1 }} minZoom={0.2} maxZoom={3} proOptions={{ hideAttribution: true }}
          onPaneClick={() => useApp.getState().setEditing(null)}>
          <Background gap={16} size={1} color="#d9dde8" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {!nodes.length && <div className="empty">Ask the AI on the left, or add a card, a title or a box from the top.<br />Drag from a dot on a shape’s side to another shape to draw an arrow; double-click to edit words.</div>}
      </main>
      <Inspector />
    </div>
  )
}

export function App() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>
}
