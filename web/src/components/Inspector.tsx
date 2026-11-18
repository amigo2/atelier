// The right-hand panel: the selected element's colour, emoji, words and size; an arrow's label; or what to do.
import { useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { ICON_COUNT, findIcons, iconByName } from '../icons'
import { COLORS, PALETTE, type TextSize } from '../model'
import { useApp } from '../store'

const SIZES: TextSize[] = ['title', 'heading', 'label', 'body']

/** Search the bundled set by name and pick one. No network, one stroke weight, one licence. */
function IconPicker({ value, onPick }: { value?: string; onPick: (name: string | undefined) => void }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => findIcons(q, 48), [q])
  return (
    <>
      <label htmlFor="iconq">Icon <span className="faint">· {ICON_COUNT} to choose from</span></label>
      <input id="iconq" value={q} placeholder="house, key, chart…" onChange={(e) => setQ(e.target.value)} />
      <div className="icogrid">
        {hits.map((n) => {
          const I = iconByName(n)!
          return (
            <button key={n} className={`icopick ${value === n ? 'on' : ''}`} title={n} aria-label={n} onClick={() => onPick(n)}>
              <I size={17} />
            </button>
          )
        })}
        {!hits.length && <span className="faint">Nothing called “{q}”.</span>}
      </div>
      {value && <div className="row"><button className="bad" onClick={() => onPick(undefined)}>No icon</button></div>}
    </>
  )
}

function ImageFields({ id, src, fit, alt }: { id: string; src?: string; fit?: 'cover' | 'contain'; alt?: string }) {
  const file = useRef<HTMLInputElement>(null)
  const s = useApp.getState()
  const pick = async (f: File) => {
    const { url } = await api.uploadImage(f)
    s.checkpoint()
    s.update(id, { src: url, alt: alt || f.name })
  }
  return (
    <>
      <label>Picture</label>
      <div className="row">
        <button onClick={() => file.current?.click()}>{src ? 'Replace…' : 'Choose…'}</button>
        {src && <button className="bad" onClick={() => { s.checkpoint(); s.update(id, { src: undefined }) }}>Remove</button>}
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = '' }} />
      <label>Fit</label>
      <div className="row">
        {(['contain', 'cover'] as const).map((f) => (
          <button key={f} className={(fit ?? 'contain') === f ? 'on' : ''} onClick={() => { s.checkpoint(); s.update(id, { fit: f }) }}
            title={f === 'contain' ? 'The whole picture, inside the box' : 'Fill the box, cropping what does not fit'}>{f === 'contain' ? 'Whole' : 'Fill'}</button>
        ))}
      </div>
      <label htmlFor="alt">Description</label>
      <input id="alt" value={alt ?? ''} placeholder="what it shows" onFocus={s.checkpoint} onChange={(e) => s.update(id, { alt: e.target.value })} />
    </>
  )
}

function Details() {
  const nodes = useApp((s) => s.nodes)
  const edges = useApp((s) => s.edges)
  const s = useApp.getState()
  const sel = nodes.filter((n) => n.selected)
  const edge = edges.find((e) => e.selected)

  if (sel.length > 1) {
    const kinds = Object.entries(sel.reduce<Record<string, number>>((m, n) => ({ ...m, [n.type!]: (m[n.type!] ?? 0) + 1 }), {}))
    return (
      <>
        <h3>{sel.length} selected</h3>
        <p className="faint">{kinds.map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' · ')}</p>
        <div className="row"><button onClick={s.duplicate}>Duplicate</button><button className="bad" onClick={() => s.remove(sel.map((n) => n.id))}>Delete</button></div>
        <p className="faint" style={{ marginTop: 14 }}>To change them all (colour, words, line them up, put a box around them), ask the AI: "make these teal".</p>
      </>
    )
  }

  if (sel.length === 1) {
    const n = sel[0], d = n.data
    const set = (patch: Partial<typeof d>) => { s.checkpoint(); s.update(n.id, patch) }
    return (
      <>
        <h3>{n.type === 'text' ? `Text · ${d.size}` : n.type![0].toUpperCase() + n.type!.slice(1)}</h3>
        <label>Colour</label>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className={`sw ${d.color === c ? 'on' : ''}`} style={{ background: PALETTE[c].bg, borderColor: PALETTE[c].fg }}
              onClick={() => set({ color: c })} title={c} aria-label={c}><i style={{ background: PALETTE[c].fg }} /></button>
          ))}
        </div>
        {n.type === 'image' && <ImageFields id={n.id} src={d.src} fit={d.fit} alt={d.alt} />}
        {n.type === 'icon' && <IconPicker value={d.icon} onPick={(icon) => set({ icon })} />}
        {n.type === 'card' && <IconPicker value={d.icon} onPick={(icon) => set({ icon })} />}
        {n.type === 'card' && (<>
          <label htmlFor="emoji">Emoji <span className="faint">· wins over the icon</span></label>
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
      </>
    )
  }

  if (edge) return (
    <>
      <h3>Arrow</h3>
      <label htmlFor="elabel">Label</label>
      <input id="elabel" value={String(edge.label ?? '')} placeholder="e.g. HTTPS 443" onFocus={s.checkpoint} onChange={(e) => s.updateEdge(edge.id, e.target.value)} />
      <button className="bad wide" onClick={() => s.remove([edge.id])}>Delete</button>
    </>
  )

  return (
    <>
      <h3>Nothing selected</h3>
      <p className="faint">Click a shape or an arrow to change it. Drag on the canvas, or Shift-click, to select several. Space + drag moves around.</p>
      <p className="faint">⌘Z undo · ⇧⌘Z redo · ⌘A select all · ⌘D duplicate · Enter edits · Delete removes</p>
    </>
  )
}

// the right column; › hides it to a thin rail (‹ brings it back), remembered per person
export function Inspector({ open, toggle }: { open: boolean; toggle: () => void }) {
  if (!open) return (
    <aside className="insp shut" aria-label="Details (hidden)">
      <button className="fold" onClick={toggle} title="Show the details panel" aria-label="Show details">‹</button>
      <span className="rail-label">Details</span>
    </aside>
  )
  return (
    <aside className="insp" aria-label="Details">
      <button className="fold" onClick={toggle} title="Hide the details panel" aria-label="Hide details">›</button>
      <Details />
    </aside>
  )
}
