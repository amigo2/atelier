// The right-hand panel: the selected element's colour, emoji, words and size; an arrow's label; or what to do.
import { COLORS, PALETTE, type TextSize } from '../model'
import { useApp } from '../store'

const SIZES: TextSize[] = ['title', 'heading', 'label', 'body']

export function Inspector() {
  const nodes = useApp((s) => s.nodes)
  const edges = useApp((s) => s.edges)
  const s = useApp.getState()
  const sel = nodes.filter((n) => n.selected)
  const edge = edges.find((e) => e.selected)

  if (sel.length > 1) return (
    <aside className="insp">
      <h3>{sel.length} selected</h3>
      <div className="row"><button onClick={s.duplicate}>Duplicate</button><button className="bad" onClick={() => s.remove(sel.map((n) => n.id))}>Delete</button></div>
    </aside>
  )

  if (sel.length === 1) {
    const n = sel[0], d = n.data
    const set = (patch: Partial<typeof d>) => { s.checkpoint(); s.update(n.id, patch) }
    return (
      <aside className="insp" aria-label="Selected">
        <h3>{n.type === 'text' ? `Text · ${d.size}` : n.type![0].toUpperCase() + n.type!.slice(1)}</h3>
        <label>Colour</label>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className={`sw ${d.color === c ? 'on' : ''}`} style={{ background: PALETTE[c].bg, borderColor: PALETTE[c].fg }}
              onClick={() => set({ color: c })} title={c} aria-label={c}><i style={{ background: PALETTE[c].fg }} /></button>
          ))}
        </div>
        {n.type === 'card' && (<>
          <label htmlFor="emoji">Emoji</label>
          <input id="emoji" value={d.emoji ?? ''} placeholder="e.g. 🔍" onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { emoji: e.target.value })} />
          <label htmlFor="title">Title</label>
          <input id="title" value={d.title ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { title: e.target.value })} />
          <label htmlFor="sub">Line under it</label>
          <textarea id="sub" rows={2} value={d.sub ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { sub: e.target.value })} />
        </>)}
        {n.type === 'box' && (<>
          <label htmlFor="title">Label</label>
          <input id="title" value={d.title ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { title: e.target.value })} />
        </>)}
        {(n.type === 'text' || n.type === 'pill') && (<>
          <label htmlFor="text">Words</label>
          <textarea id="text" rows={n.type === 'text' ? 3 : 1} value={d.text ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { text: e.target.value })} />
        </>)}
        {n.type === 'text' && (<>
          <label>Size</label>
          <div className="seg">{SIZES.map((z) => <button key={z} className={d.size === z ? 'on' : ''} onClick={() => set({ size: z })}>{z}</button>)}</div>
        </>)}
        <label>Size on the canvas</label>
        <p className="faint">{Math.round(n.width ?? 0)} × {Math.round(n.height ?? 0)}: drag a corner to resize.</p>
        <div className="row">
          <button onClick={() => s.toFront(n.id, true)} title="Bring to front">Front</button>
          <button onClick={() => s.toFront(n.id, false)} title="Send to back">Back</button>
          <button onClick={s.duplicate} title="Duplicate (⌘D)">Duplicate</button>
        </div>
        <button className="bad wide" onClick={() => s.remove([n.id])}>Delete</button>
      </aside>
    )
  }

  if (edge) return (
    <aside className="insp" aria-label="Selected arrow">
      <h3>Arrow</h3>
      <label htmlFor="elabel">Label</label>
      <input id="elabel" value={String(edge.label ?? '')} placeholder="e.g. HTTPS 443" onFocus={s.checkpoint} onChange={(e) => s.updateEdge(edge.id, e.target.value)} />
      <button className="bad wide" onClick={() => s.remove([edge.id])}>Delete</button>
    </aside>
  )

  return (
    <aside className="insp">
      <h3>Nothing selected</h3>
      <p className="faint">Click a shape or an arrow to change it. Shift-click or drag a box around several to select them all.</p>
      <p className="faint">⌘Z undo · ⇧⌘Z redo · ⌘D duplicate · Enter edits · Delete removes</p>
    </aside>
  )
}
