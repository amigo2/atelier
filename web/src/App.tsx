// Atelier: a diagram editor. The canvas in the middle, what you can add on the left, the selected thing's
// colour and words on the right, the diagram's name, undo and export along the top. Saved as you go.
import { Background, BackgroundVariant, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, useReactFlow, type FinalConnectionState } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { OpenDialog, uniqueName } from './components/OpenDialog'
import { NODE_TYPES } from './components/Shapes'
import { Inspector } from './components/Inspector'
import { Chat } from './components/Chat'
import { exportPng } from './exportPng'
import { PRESETS, fromDoc, newId, toDoc, type ElData, type Kind } from './model'
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
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, checkpoint, name, saved, past, future, frame } = useApp()
  const rf = useReactFlow()
  const [dialog, setDialog] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [inspOpen, setInspOpen] = useState(() => localStorage.getItem('atelier.details') !== 'shut')
  const toggleInsp = () => setInspOpen((o) => { localStorage.setItem('atelier.details', o ? 'shut' : 'open'); return !o })

  // show the whole drawing, or the whole export frame when it's on
  const fit = () => setTimeout(() => {
    const f = useApp.getState().frame
    if (f) rf.fitBounds({ x: f.x, y: f.y - 30, width: f.w, height: f.h + 30 }, { padding: 0.06 })
    else rf.fitView({ padding: 0.2, maxZoom: 1 })
  }, 50)

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
    if (id) api.get(id).then((d) => { useApp.getState().load(d.id, d.name, fromDoc(d), d.frame ?? null); fit() }).catch(() => localStorage.removeItem(LAST))
  }, [rf])

  // save now (⌘S), and as you go, a moment after the last change
  const saveNow = async () => {
    const s = useApp.getState(), at = { nodes: s.nodes, edges: s.edges, name: s.name, frame: s.frame }
    await api.save(toDoc(s.id, s.name, s.nodes, s.edges, s.frame))
    localStorage.setItem(LAST, s.id)
    const now = useApp.getState()
    if (now.nodes === at.nodes && now.edges === at.edges && now.name === at.name && now.frame === at.frame) now.markSaved()
  }
  useEffect(() => {
    if (saved) return
    const t = setTimeout(saveNow, 600)
    return () => clearTimeout(t)
  }, [saved, nodes, edges, name, frame])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 1600); return () => clearTimeout(t) }, [toast])

  // keys: undo, redo, duplicate, and Escape to stop editing / deselect
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey, s = useApp.getState()
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().then(() => setToast(`Saved “${useApp.getState().name}”`)); return }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); setDialog(true); return }
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicate() }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); useApp.setState({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }) }
      else if (e.key === 'Enter') { const one = s.nodes.filter((n) => n.selected); if (one.length === 1) { e.preventDefault(); s.setEditing(one[0].id) } }
      else if (e.key === 'Escape') { s.setEditing(null); useApp.setState({ nodes: s.nodes.map((n) => ({ ...n, selected: false })), edges: s.edges.map((x) => ({ ...x, selected: false })) }) }
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

  const fresh = async () => { const list = await api.list().catch(() => []); useApp.getState().load(newId('d'), uniqueName('Untitled', list), { nodes: [], edges: [] }); setDialog(false) }
  const open = async (id: string) => { const d = await api.get(id); useApp.getState().load(d.id, d.name, fromDoc(d), d.frame ?? null); localStorage.setItem(LAST, d.id); setDialog(false); fit() }

  return (
    <div className={`app ${inspOpen ? '' : 'insp-shut'}`}>
      <header className="top">
        <b className="brand">✦ Atelier</b>
        <input className="name" value={name} onChange={(e) => useApp.getState().rename(e.target.value)} aria-label="Diagram name" />
        <span className="saved" title="Saved as you go (⌘S saves now)">{saved ? 'Saved' : 'Saving…'}</span>
        <span className="sep" />
        <nav className="tools" aria-label="Add">
          {TOOLS.map((t) => <button key={t.label} onClick={() => add(t.kind, t.data)} title={t.hint}>{t.label}</button>)}
        </nav>
        <span className="grow" />
        <button onClick={fresh} title="Start a new diagram">New</button>
        <button onClick={() => setDialog(true)} title="Your diagrams: open, rename, duplicate, delete, download, import (⌘O)">Open…</button>
        <button onClick={() => useApp.getState().undo()} disabled={!past.length} title="Undo (⌘Z)">↶</button>
        <button onClick={() => useApp.getState().redo()} disabled={!future.length} title="Redo (⇧⌘Z)">↷</button>
        <span className="sep" />
        <button className={`toggle ${frame ? 'on' : ''}`} onClick={() => { useApp.getState().setFrame(!frame); if (!frame) setTimeout(() => { const f = useApp.getState().frame; if (f) rf.fitBounds({ x: f.x, y: f.y - 30, width: f.w, height: f.h + 30 }, { padding: 0.08, duration: 300 }) }, 30) }}
          title={frame ? 'Hide the export frame: export crops to the drawing' : 'Show the export frame: draw inside it, export exactly it'} aria-pressed={!!frame}>▭ Frame</button>
        {frame && (
          <select className="preset" value={frame.preset} onChange={(e) => useApp.getState().setFrame(true, e.target.value)} aria-label="Export size">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        <button className="primary" onClick={() => exportPng(nodes, edges, name, frame)} disabled={!nodes.length && !frame} title={frame ? `Download the frame as a ${frame.w} × ${frame.h} PNG` : 'Download the diagram as a PNG'}>Export PNG</button>
      </header>
      <Chat />
      <main className="canvas" ref={box}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onConnectEnd={onConnectEnd} connectionRadius={30} onNodeDragStart={checkpoint} connectionMode={ConnectionMode.Loose} deleteKeyCode={['Backspace', 'Delete']}
          selectionOnDrag selectionMode={SelectionMode.Partial} panOnDrag={[1, 2]} panActivationKeyCode="Space" panOnScroll
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          snapToGrid snapGrid={[8, 8]} defaultViewport={{ x: 0, y: 0, zoom: 1 }} minZoom={0.2} maxZoom={3} proOptions={{ hideAttribution: true }}
          onPaneClick={() => useApp.getState().setEditing(null)}>
          <Background id="minor" variant={BackgroundVariant.Lines} gap={16} lineWidth={0.5} color="#eceff5" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={80} lineWidth={0.75} color="#dfe3ec" />
          {frame && (
            <ViewportPortal>
              <div className="xframe" style={{ transform: `translate(${frame.x}px, ${frame.y}px)`, width: frame.w, height: frame.h }}>
                <span className="xframe-l">Export · {frame.w} × {frame.h}</span>
              </div>
            </ViewportPortal>
          )}
          <Controls showInteractive={false} />
        </ReactFlow>
        {!nodes.length && <div className="empty">Ask the AI on the left, or add a card, a title or a box from the top.<br />Drag from a dot on a shape’s side to another shape to draw an arrow; double-click to edit words.<br />Drag on the canvas to select · Space + drag to move around</div>}
      </main>
      <Inspector open={inspOpen} toggle={toggleInsp} />
      {dialog && <OpenDialog close={() => setDialog(false)} open={open} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

export function App() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>
}
