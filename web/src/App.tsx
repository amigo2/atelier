// Atelier: a diagram editor. The canvas in the middle, what you can add on the left, the selected thing's
// colour and words on the right, the diagram's name, undo and export along the top. Saved as you go.
import { Background, BackgroundVariant, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal, useReactFlow, type Connection, type Edge, type FinalConnectionState, type HandleType } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { OpenDialog, uniqueName } from './components/OpenDialog'
import { NODE_TYPES } from './components/Shapes'
import { Inspector } from './components/Inspector'
import { Chat } from './components/Chat'
import { LineDraw } from './components/LineDraw'
import { exportPdf } from './exportPdf'
import { fitToText } from './fit'
import { exportPng } from './exportPng'
import { POINT, PRESETS, fromDoc, newId, pagesFromDoc, pagesInOrder, toDoc, type El, type ElData, type Kind, type Look } from './model'
import { SNAP, snapAt } from './snap'
import { withLayers } from './layers'
import { useApp } from './store'

const LAST = 'atelier.last'
const CHAT_W = 330
const clampChat = (w: number) => Math.round(Math.min(720, Math.max(240, w)))
const INSP_W = 250
const clampInsp = (w: number) => Math.round(Math.min(720, Math.max(220, w)))

type Tool = { label: string; hint: string } & ({ kind: Kind; data?: Partial<ElData> } | { line: Look } | { image: true })

// The toolbar, in groups: what a slide is made of, then words, then what joins things, then the rest.
const GROUPS: { label: string; tools: Tool[] }[] = [
  { label: 'Shapes', tools: [
    { label: 'Card', kind: 'card', hint: 'A step or a part: emoji, title and a line under it' },
    { label: 'Box', kind: 'box', hint: 'A frame around a group' },
    { label: 'Pill', kind: 'pill', hint: 'A small tag' },
  ] },
  { label: 'Text', tools: [
    { label: 'Title', kind: 'text', data: { size: 'title', text: 'Title' }, hint: 'The diagram\'s title' },
    { label: 'Heading', kind: 'text', data: { size: 'heading', text: 'Heading' }, hint: 'A heading' },
    { label: 'Label', kind: 'text', data: { size: 'label', text: 'SECTION' }, hint: 'A small section label, in capitals' },
    { label: 'Text', kind: 'text', data: { size: 'body', text: 'Some text' }, hint: 'A paragraph' },
  ] },
  { label: 'Lines', tools: [
    { label: 'Line', line: { shape: 'curved', ends: 'none' }, hint: 'Draw a curved line: press and drag. Near a shape\'s edge, an end snaps to it' },
    { label: 'Arrow', line: { shape: 'straight' }, hint: 'Draw a straight arrow: press and drag. Near a shape\'s edge, an end snaps to it' },
    { label: 'Elbow', line: { shape: 'elbow' }, hint: 'Draw an elbow arrow, all right angles: press and drag' },
  ] },
  { label: 'Extras', tools: [
    { label: 'List', kind: 'list', hint: 'A bulleted list: one item per line' },
    { label: 'Table', kind: 'table', hint: 'A table: one row per line, cells separated by |' },
    { label: 'Bars', kind: 'bars', hint: 'A bar chart from numbers: one bar per line, label | value' },
    { label: 'Icon', kind: 'icon', hint: 'One icon from the bundled set, searchable on the right' },
    { label: 'Image', image: true, hint: 'Put a picture on the page: a screenshot, a photo, a logo' },
  ] },
]

/** The bounds of each group that has something selected: a dashed outline shows what moves together. */
function groupOutlines(nodes: El[]) {
  const by = new Map<string, El[]>()
  for (const n of nodes) if (n.data.group) by.set(n.data.group, [...(by.get(n.data.group) ?? []), n])
  return [...by].filter(([, ns]) => ns.some((n) => n.selected)).map(([id, ns]) => {
    const x = Math.min(...ns.map((n) => n.position.x)), y = Math.min(...ns.map((n) => n.position.y))
    const r = Math.max(...ns.map((n) => n.position.x + (n.width ?? 0))), b = Math.max(...ns.map((n) => n.position.y + (n.height ?? 0)))
    return { id, x, y, w: r - x, h: b - y }
  })
}

function Editor() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, checkpoint, name, saved, past, future, pages } = useApp()
  const rf = useReactFlow()
  // what sits inside something is drawn above it, worked out afresh as things move (layers.ts)
  const layered = useMemo(() => withLayers(nodes), [nodes])
  const [dialog, setDialog] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pic = useRef<HTMLInputElement>(null)
  const [inspOpen, setInspOpen] = useState(() => localStorage.getItem('atelier.details') !== 'shut')
  const toggleInsp = () => setInspOpen((o) => { localStorage.setItem('atelier.details', o ? 'shut' : 'open'); return !o })
  // and its left edge drags, like the chat's right edge: a wider panel for writing in
  const [inspW, setInspW] = useState(() => clampInsp(Number(localStorage.getItem('atelier.inspW')) || INSP_W))
  const resizeInsp = (w: number, done = false) => { const c = clampInsp(w); setInspW(c); if (done) localStorage.setItem('atelier.inspW', String(c)) }
  // the chat folds away like the details panel, and its right edge drags to make it wider or narrower
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem('atelier.chat') !== 'shut')
  const toggleChat = () => setChatOpen((o) => { localStorage.setItem('atelier.chat', o ? 'shut' : 'open'); return !o })
  const [chatW, setChatW] = useState(() => clampChat(Number(localStorage.getItem('atelier.chatW')) || CHAT_W))
  const resizeChat = (w: number, done = false) => { const c = clampChat(w); setChatW(c); if (done) localStorage.setItem('atelier.chatW', String(c)) }
  // a line tool, while it is on: the next press-and-drag on the canvas draws that line
  const [lineTool, setLineTool] = useState<{ label: string; look: Look } | null>(null)
  const lineToolRef = useRef(lineTool); lineToolRef.current = lineTool
  // a line's label, being typed in place: where the box sits (the middle of the line), and what it said before
  const [labelEdit, setLabelEdit] = useState<{ id: string; x: number; y: number; was: string } | null>(null)
  const editLabel = (id: string) => {
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(id)}"] path.react-flow__edge-path`)
    const e = useApp.getState().edges.find((x) => x.id === id)
    if (!path || !e) return
    const m = path.getPointAtLength(path.getTotalLength() / 2)
    checkpoint()
    setLabelEdit({ id, x: m.x, y: m.y, was: String(e.label ?? '') })
  }
  const endLabel = (keep: boolean) => {
    if (labelEdit && !keep) useApp.getState().updateEdge(labelEdit.id, labelEdit.was)
    setLabelEdit(null)
  }
  const reconnecting = useRef(false)

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
    fitToText(id)
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
      else if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroup(); else s.group() }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); useApp.setState({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }) }
      else if (e.key === 'Enter') { const one = s.nodes.filter((n) => n.selected); if (one.length === 1 && !one[0].data.locked) { e.preventDefault(); s.setEditing(one[0].id) } }
      else if (e.key === 'Escape') { s.setEditing(null); useApp.setState({ nodes: s.nodes.map((n) => ({ ...n, selected: false })), edges: s.edges.map((x) => ({ ...x, selected: false })) }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rf])

  const at = (e: MouseEvent | TouchEvent) => { const p = 'changedTouches' in e ? e.changedTouches[0] : e; return { x: p.clientX, y: p.clientY } }

  // An arrow dragged from a dot and let go on a shape, or within a few pixels of its edge, connects to the
  // side nearest the drop. (Dragging an existing arrow's end also ends here; that is handled below instead.)
  const onConnectEnd = (e: MouseEvent | TouchEvent, c: FinalConnectionState) => {
    if (reconnecting.current || c.isValid || !c.fromNode) return
    const p = at(e), hit = snapAt(p.x, p.y, new Set([c.fromNode.id]))
    if (hit) onConnect({ source: c.fromNode.id, sourceHandle: c.fromHandle?.id ?? null, target: hit.id, targetHandle: hit.handle })
  }

  // An existing line's end, dragged somewhere else: onto a dot, near an edge (it snaps), or into empty space (it
  // comes loose, and stays where it was let go).
  const onReconnect = (old: Edge, c: Connection) => {
    const moved = c.source === old.source && c.sourceHandle === old.sourceHandle ? 'target' : 'source'
    const to = moved === 'source' ? { node: c.source, side: c.sourceHandle ?? 'r' } : { node: c.target, side: c.targetHandle ?? 'l' }
    useApp.getState().moveEnd(old.id, moved, to)
  }
  const onReconnectEnd = (e: MouseEvent | TouchEvent, edge: Edge, fixed: HandleType, c: FinalConnectionState) => {
    setTimeout(() => { reconnecting.current = false }, 0)
    if (c.isValid) return
    const moved = fixed === 'source' ? 'target' : 'source'
    const other = moved === 'source' ? edge.target : edge.source
    const p = at(e), hit = snapAt(p.x, p.y, new Set([other]))
    useApp.getState().moveEnd(edge.id, moved, hit ? { node: hit.id, side: hit.handle } : rf.screenToFlowPosition(p))
  }

  // A group moves as one even when the drag starts on a member that was not selected yet: React Flow settles what
  // it drags when the pointer goes down, before the rest of the group is selected, so the rest follows by hand.
  const followers = useRef<{ lead: string; from: { x: number; y: number }; rest: { id: string; x: number; y: number }[] } | null>(null)
  const onNodeDragStart = (_: unknown, n: El, dragged: El[]) => {
    checkpoint()
    const s = useApp.getState(), moving = new Set(dragged.map((d) => d.id))
    const groups = new Set(dragged.map((d) => d.data.group).filter(Boolean))
    const rest = s.nodes.filter((x) => x.data.group && groups.has(x.data.group) && !moving.has(x.id) && !x.data.locked)
    followers.current = rest.length ? { lead: n.id, from: { ...n.position }, rest: rest.map((x) => ({ id: x.id, ...x.position })) } : null
  }
  const onNodeDrag = (_: unknown, n: El) => {
    const f = followers.current
    if (!f || n.id !== f.lead) return
    const dx = n.position.x - f.from.x, dy = n.position.y - f.from.y
    const to = new Map(f.rest.map((r) => [r.id, { x: r.x + dx, y: r.y + dy }]))
    useApp.setState((s) => ({ nodes: s.nodes.map((x) => (to.has(x.id) ? { ...x, position: to.get(x.id)! } : x)), saved: false }))
  }

  // A whole line, dragged by its body. A press on a line that moves more than a few pixels picks it up: both
  // ends turn into free points and follow the pointer, and on release each end snaps to a shape's edge if it is
  // near one. A press that does not move is a click, and only selects the line.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      const edgeEl = t.closest?.('.react-flow__edge')
      if (e.button !== 0 || !edgeEl || t.closest('.react-flow__edgeupdater') || lineToolRef.current) return
      const id = edgeEl.getAttribute('data-id')
      const path = edgeEl.querySelector<SVGPathElement>('path.react-flow__edge-path')
      if (!id || !path) return
      const x0 = e.clientX, y0 = e.clientY
      let pts: [string, string] | null = null, start: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null
      const move = (m: PointerEvent) => {
        if (!pts) {
          if (Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return
          // the path is drawn in flow coordinates: its first and last points are the two ends
          const len = path.getTotalLength(), a = path.getPointAtLength(0), b = path.getPointAtLength(len)
          start = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }
          checkpoint()
          pts = useApp.getState().liftLine(id, start.a, start.b)
          if (!pts) return
          document.body.classList.add('dragging-line')
        }
        const zoom = rf.getViewport().zoom, dx = (m.clientX - x0) / zoom, dy = (m.clientY - y0) / zoom
        const [pa, pb] = pts, st = start!
        const place = (p: { x: number; y: number }) => ({ x: Math.round(p.x + dx - POINT / 2), y: Math.round(p.y + dy - POINT / 2) })
        useApp.setState((s) => ({ nodes: s.nodes.map((n) => (n.id === pa ? { ...n, position: place(st.a) } : n.id === pb ? { ...n, position: place(st.b) } : n)) }))
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.classList.remove('dragging-line')
        if (!pts) return
        // each end that landed near an edge attaches there, in the same undo step as the move
        requestAnimationFrame(() => {
          const s = useApp.getState(), [pa, pb] = pts!
          for (const [pid, end] of [[pa, 'source'], [pb, 'target']] as const) {
            const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(pid)}"]`)
            if (!node) continue
            const r = node.getBoundingClientRect()
            const hit = snapAt(r.left + r.width / 2, r.top + r.height / 2, new Set([pa, pb]))
            if (hit) s.moveEnd(id, end, { node: hit.id, side: hit.handle }, false)
          }
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    el.addEventListener('pointerdown', down)
    return () => el.removeEventListener('pointerdown', down)
  }, [rf, checkpoint])

  // a free end dragged near a shape's edge attaches to it, and stops being free
  const onNodeDragStop = (_: unknown, n: El) => {
    followers.current = null
    if (n.type !== 'point') return
    const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`)
    const s = useApp.getState(), e = s.edges.find((x) => x.source === n.id || x.target === n.id)
    if (!el || !e) return
    const r = el.getBoundingClientRect(), other = e.source === n.id ? e.target : e.source
    const hit = snapAt(r.left + r.width / 2, r.top + r.height / 2, new Set([n.id, other]))
    if (hit) s.moveEnd(e.id, e.source === n.id ? 'source' : 'target', { node: hit.id, side: hit.handle })
  }

  const fresh = async () => { const list = await api.list().catch(() => []); useApp.getState().load(newId('d'), uniqueName('Untitled', list), { nodes: [], edges: [] }); setDialog(false) }
  const open = async (id: string) => { const d = await api.get(id); useApp.getState().load(d.id, d.name, fromDoc(d), pagesFromDoc(d)); localStorage.setItem(LAST, d.id); setDialog(false); fit() }

  return (
    <div className={`app ${inspOpen ? '' : 'insp-shut'}`} style={{ '--chat': chatOpen ? `${chatW}px` : '34px', '--insp': inspOpen ? `${inspW}px` : '34px' } as React.CSSProperties}>
      <header className="top">
        <b className="brand">✦ Atelier</b>
        <input className="name" value={name} onChange={(e) => useApp.getState().rename(e.target.value)} aria-label="Diagram name" />
        <span className="saved" title="Saved as you go (⌘S saves now)">{saved ? 'Saved' : 'Saving…'}</span>
        <span className="sep" />
        <nav className="tools" aria-label="Add">
          {GROUPS.map((g) => (
            <div key={g.label} className="tgroup" role="group" aria-label={g.label}>
              <span className="tgroup-l">{g.label}</span>
              <div className="tgroup-b">
                {g.tools.map((t) => {
                  if ('line' in t) {
                    const on = lineTool?.label === t.label
                    return <button key={t.label} className={on ? 'on' : ''} aria-pressed={on} title={t.hint}
                      onClick={() => setLineTool(on ? null : { label: t.label, look: t.line })}>{t.label}</button>
                  }
                  if ('image' in t) return <button key={t.label} onClick={() => pic.current?.click()} title={t.hint}>{t.label}</button>
                  return <button key={t.label} onClick={() => add(t.kind, t.data)} title={t.hint}>{t.label}</button>
                })}
              </div>
            </div>
          ))}
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
      <Chat open={chatOpen} toggle={toggleChat} width={chatW} resize={resizeChat} reset={() => resizeChat(CHAT_W, true)} />
      <main className="canvas" ref={box}>
        <ReactFlow nodes={layered} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onConnectEnd={onConnectEnd} connectionRadius={SNAP} elevateNodesOnSelect={false}
          reconnectRadius={7} zoomOnDoubleClick={false} onEdgeDoubleClick={(_, e) => editLabel(e.id)} onReconnect={onReconnect} onReconnectStart={() => { reconnecting.current = true }} onReconnectEnd={onReconnectEnd} onNodeDragStop={onNodeDragStop} onNodeDragStart={onNodeDragStart} onNodeDrag={onNodeDrag} connectionMode={ConnectionMode.Loose} deleteKeyCode={['Backspace', 'Delete']}
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
          {labelEdit && (
            <ViewportPortal>
              <input className="edge-label-edit nodrag nopan" autoFocus placeholder="Label"
                style={{ transform: `translate(${labelEdit.x}px, ${labelEdit.y}px) translate(-50%, -50%)` }}
                value={String(edges.find((x) => x.id === labelEdit.id)?.label ?? '')}
                onChange={(e) => useApp.getState().updateEdge(labelEdit.id, e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') endLabel(true); if (e.key === 'Escape') endLabel(false) }}
                onBlur={() => endLabel(true)} />
            </ViewportPortal>
          )}
          <ViewportPortal>
            {groupOutlines(nodes).map((g) => (
              <div key={g.id} className="grp-outline" style={{ transform: `translate(${g.x - 6}px, ${g.y - 6}px)`, width: g.w + 12, height: g.h + 12 }} />
            ))}
          </ViewportPortal>
          <Controls showInteractive={false} />
        </ReactFlow>
        {lineTool && <LineDraw look={lineTool.look} label={lineTool.label} done={() => setLineTool(null)} />}
        {pages.length > 1 && (
          <div className="pagestrip" role="navigation" aria-label="Pages">
            {pagesInOrder(pages).map((p, i) => (
              <button key={p.id} onClick={() => fitPage(p.id)} title={`${p.name} — click to fill the view`}>{i + 1}</button>
            ))}
          </div>
        )}
        {!nodes.length && <div className="empty">Ask the AI on the left, or add a card, a title or a box from the top.<br />Drag from a dot on a shape’s side to another shape to draw an arrow; double-click to edit words.<br />Drag on the canvas to select · Space + drag to move around</div>}
      </main>
      <Inspector open={inspOpen} toggle={toggleInsp} width={inspW} resize={resizeInsp} reset={() => resizeInsp(INSP_W, true)} />
      {dialog && <OpenDialog close={() => setDialog(false)} open={open} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

export function App() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>
}
