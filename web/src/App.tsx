// Atelier: a diagram editor. The canvas in the middle, what you can add on the left, the selected thing's
// colour and words on the right, the diagram's name, undo and export along the top. Saved as you go.
import { Background, BackgroundVariant, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, useReactFlow, type FinalConnectionState } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { OpenDialog, uniqueName } from './components/OpenDialog'
import { NODE_TYPES } from './components/Shapes'
import { Inspector } from './components/Inspector'
import { Chat } from './components/Chat'
import { exportPdf } from './exportPdf'
import { exportPng } from './exportPng'
import { PRESETS, fromDoc, newId, pagesFromDoc, pagesInOrder, toDoc, type ElData, type Kind } from './model'
import { useApp } from './store'

const LAST = 'atelier.last'

const TOOLS: { label: string; kind: Kind; data?: Partial<ElData>; hint: string }[] = [
  { label: 'Card', kind: 'card', hint: 'A step or a part: emoji, title and a line under it' },
  { label: 'Title', kind: 'text', data: { size: 'title', text: 'Title' }, hint: 'The diagram\'s title' },
  { label: 'Heading', kind: 'text', data: { size: 'heading', text: 'Heading' }, hint: 'A heading' },
  { label: 'Label', kind: 'text', data: { size: 'label', text: 'SECTION' }, hint: 'A small section label, in capitals' },
  { label: 'Text', kind: 'text', data: { size: 'body', text: 'Some text' }, hint: 'A paragraph' },
  { label: 'List', kind: 'list', hint: 'A bulleted list: one item per line' },
  { label: 'Table', kind: 'table', hint: 'A table: one row per line, cells separated by |' },
  { label: 'Icon', kind: 'icon', hint: 'One icon from the bundled set, searchable on the right' },
  { label: 'Bars', kind: 'bars', hint: 'A bar chart from numbers: one bar per line, label | value' },
  { label: 'Box', kind: 'box', hint: 'A frame around a group' },
  { label: 'Pill', kind: 'pill', hint: 'A small tag' },
]

function Editor() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, checkpoint, name, saved, past, future, pages } = useApp()
  const rf = useReactFlow()
  const [dialog, setDialog] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pic = useRef<HTMLInputElement>(null)
  const [inspOpen, setInspOpen] = useState(() => localStorage.getItem('atelier.details') !== 'shut')
  const toggleInsp = () => setInspOpen((o) => { localStorage.setItem('atelier.details', o ? 'shut' : 'open'); return !o })

  // show the whole drawing, or the whole export frame when it's on
  const fit = () => setTimeout(() => {
    const ps = useApp.getState().pages
    if (ps.length) {
      const x = Math.min(...ps.map((p) => p.x)), y = Math.min(...ps.map((p) => p.y))
      const r = Math.max(...ps.map((p) => p.x + p.w)), b = Math.max(...ps.map((p) => p.y + p.h))
      rf.fitBounds({ x, y: y - 30, width: r - x, height: b - y + 30 }, { padding: 0.06 })
    } else rf.fitView({ padding: 0.2, maxZoom: 1 })
  }, 50)

  // one page, filling the view: what you want while you are working on a slide
  const fitPage = (id: string) => {
    const p = useApp.getState().pages.find((x) => x.id === id)
    if (p) rf.fitBounds({ x: p.x, y: p.y - 30, width: p.w, height: p.h + 30 }, { padding: 0.06, duration: 300 })
  }

  // add one where the view's centre is
  const add = (kind: Kind, data?: Partial<ElData>) => {
    const r = box.current!.getBoundingClientRect()
    const at = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    const id = useApp.getState().add(kind, at, data)
    useApp.getState().setEditing(null)
    return id
  }

  // A picture is chosen first and placed second: an empty image element is a hole on a slide, and nobody
  // adds one on purpose.
  const addImage = async (f: File) => {
    try {
      const { url } = await api.uploadImage(f)
      const id = add('image', { src: url, alt: f.name })
      useApp.getState().setEditing(null)
      return id
    } catch (e) {
      setToast(String((e as Error).message ?? e))
    }
  }

  // open the last diagram, or start one
  useEffect(() => {
    const id = localStorage.getItem(LAST)
    if (id) api.get(id).then((d) => { useApp.getState().load(d.id, d.name, fromDoc(d), pagesFromDoc(d)); fit() }).catch(() => localStorage.removeItem(LAST))
  }, [rf])

  // save now (⌘S), and as you go, a moment after the last change
  const saveNow = async () => {
    const s = useApp.getState(), at = { nodes: s.nodes, edges: s.edges, name: s.name, pages: s.pages }
    await api.save(toDoc(s.id, s.name, s.nodes, s.edges, s.pages))
    localStorage.setItem(LAST, s.id)
    const now = useApp.getState()
    if (now.nodes === at.nodes && now.edges === at.edges && now.name === at.name && now.pages === at.pages) now.markSaved()
  }
  useEffect(() => {
    if (saved) return
    const t = setTimeout(saveNow, 600)
    return () => clearTimeout(t)
  }, [saved, nodes, edges, name, pages])
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
  const open = async (id: string) => { const d = await api.get(id); useApp.getState().load(d.id, d.name, fromDoc(d), pagesFromDoc(d)); localStorage.setItem(LAST, d.id); setDialog(false); fit() }

  return (
    <div className={`app ${inspOpen ? '' : 'insp-shut'}`}>
      <header className="top">
        <b className="brand">✦ Atelier</b>
        <input className="name" value={name} onChange={(e) => useApp.getState().rename(e.target.value)} aria-label="Diagram name" />
        <span className="saved" title="Saved as you go (⌘S saves now)">{saved ? 'Saved' : 'Saving…'}</span>
        <span className="sep" />
        <nav className="tools" aria-label="Add">
          {TOOLS.map((t) => <button key={t.label} onClick={() => add(t.kind, t.data)} title={t.hint}>{t.label}</button>)}
          <button onClick={() => pic.current?.click()} title="Put a picture on the page: a screenshot, a photo, a logo">Image</button>
          <input ref={pic} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = '' }} />
        </nav>
        <span className="grow" />
        <button onClick={fresh} title="Start a new diagram">New</button>
        <button onClick={() => setDialog(true)} title="Your diagrams: open, rename, duplicate, delete, download, import (⌘O)">Open…</button>
        <button onClick={() => useApp.getState().undo()} disabled={!past.length} title="Undo (⌘Z)">↶</button>
        <button onClick={() => useApp.getState().redo()} disabled={!future.length} title="Redo (⇧⌘Z)">↷</button>
        <span className="sep" />
        <button className={`toggle ${pages.length ? 'on' : ''}`} onClick={() => { const on = !pages.length; useApp.getState().setFrame(on); if (on) setTimeout(() => { const p = useApp.getState().pages[0]; if (p) fitPage(p.id) }, 30) }}
          title={pages.length ? 'Hide the export frame: export crops to the drawing' : 'Show the export frame: draw inside it, export exactly it'} aria-pressed={!!pages.length}>▭ Frame</button>
        {!!pages.length && (
          <select className="preset" value={pages[0].preset} onChange={(e) => useApp.getState().setFrame(true, e.target.value)} aria-label="Export size">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        {!!pages.length && <button onClick={() => { const id = useApp.getState().addPage(); setTimeout(() => fitPage(id), 30) }} title="Add a page to the right: each page is one page of the PDF">+ Page</button>}
        <button onClick={() => exportPng(nodes, edges, name, pages[0] ?? null)} disabled={!nodes.length && !pages.length} title={pages.length ? `Download page 1 as a ${pages[0].w} × ${pages[0].h} PNG` : 'Download the diagram as a PNG'}>PNG</button>
        <button className="primary" onClick={() => exportPdf(pages, name).catch((e) => setToast(String(e.message || e)))} disabled={!pages.length}
          title={pages.length ? `Download all ${pages.length} page${pages.length > 1 ? 's' : ''} as one PDF, text kept as text` : 'Turn the frame on to make pages'}>Export PDF</button>
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
          {!!pages.length && (
            <ViewportPortal>
              {pagesInOrder(pages).map((p, i) => (
                <div key={p.id} className="xframe" style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: p.h }}>
                  <span className="xframe-l">{pages.length > 1 ? `${i + 1} · ` : 'Export · '}{p.w} × {p.h}</span>
                </div>
              ))}
            </ViewportPortal>
          )}
          <Controls showInteractive={false} />
        </ReactFlow>
        {pages.length > 1 && (
          <div className="pagestrip" role="navigation" aria-label="Pages">
            {pagesInOrder(pages).map((p, i) => (
              <button key={p.id} onClick={() => fitPage(p.id)} title={`${p.name} — click to fill the view`}>{i + 1}</button>
            ))}
          </div>
        )}
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
