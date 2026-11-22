// The right-hand panel: the selected element's colour, emoji, words and size; an arrow's label; or what to do.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { ICON_COUNT, findIcons, iconByName } from '../icons'
import { ALIGNS, COLORS, LINE_ENDS, LINE_SHAPES, PALETTE, type Look, type TextSize } from '../model'
import { useApp } from '../store'
import { Grip } from './Grip'

const SIZES: TextSize[] = ['title', 'heading', 'label', 'body']

/** A text box as tall as what is in it: a five-line description shows five lines, not the first two. */
function GrowingText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; min?: number }) {
  const { min = 1, ...rest } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const t = ref.current
    if (!t) return
    const fit = () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px` }
    fit()
    // and again whenever its width changes: the panel settles after the first measure, and a long line that
    // wraps once more would otherwise fall off the bottom
    let w = t.clientWidth
    const ro = new ResizeObserver(() => { if (t.clientWidth !== w) { w = t.clientWidth; fit() } })
    ro.observe(t)
    return () => ro.disconnect()
  }, [props.value])
  return <textarea ref={ref} rows={min} {...rest} style={{ resize: 'none', overflow: 'hidden', ...rest.style }} />
}

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
    const groups = new Set(sel.map((n) => n.data.group))
    const oneGroup = groups.size === 1 && !groups.has(undefined)
    return (
      <>
        <h3>{oneGroup ? `Group of ${sel.length}` : `${sel.length} selected`}</h3>
        <p className="faint">{kinds.map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' · ')}</p>
        {oneGroup
          ? <button className="wide" onClick={s.ungroup} title="Ungroup (⇧⌘G)">Ungroup</button>
          : <button className="wide" onClick={s.group} title="Group them, so they select and move as one (⌘G)">Group</button>}
        {oneGroup && <p className="faint" style={{ marginTop: 8 }}>⌥-click picks one of them on its own.</p>}
        <div className="row"><button onClick={s.duplicate}>Duplicate</button><button className="bad" onClick={() => s.remove(sel.map((n) => n.id))}>Delete</button></div>
        <p className="faint" style={{ marginTop: 14 }}>To change them all (colour, words, line them up, put a box around them), ask the AI: "make these teal".</p>
      </>
    )
  }

  if (sel.length === 1 && sel[0].type === 'point') return (
    <>
      <h3>Line end</h3>
      <p className="faint">A free end. Drag it near a shape's edge and it snaps on; leave it anywhere else and it stays put.</p>
      <p className="faint">Click the line itself to change its shape, ends, style and colour.</p>
    </>
  )

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
          <GrowingText id="sub" min={2} value={d.sub ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { sub: e.target.value })} />
        </>)}
        {n.type === 'box' && (<>
          <label htmlFor="title">Label</label>
          <input id="title" value={d.title ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { title: e.target.value })} />
        </>)}
        {(n.type === 'text' || n.type === 'pill') && (<>
          <label htmlFor="text">Words</label>
          <GrowingText id="text" min={n.type === 'text' ? 3 : 1} value={d.text ?? ''} onFocus={s.checkpoint} onChange={(e) => s.update(n.id, { text: e.target.value })} />
        </>)}
        {(n.type === 'card' || n.type === 'text') && (<>
          <label>Align</label>
          <div className="seg">{ALIGNS.map((a) => (
            <button key={a} className={(d.align ?? 'left') === a ? 'on' : ''} onClick={() => set({ align: a })}
              aria-label={`Align ${a}`} aria-pressed={(d.align ?? 'left') === a} title={`Align ${a}`}>{a}</button>
          ))}</div>
        </>)}
        {n.type === 'text' && (<>
          <label>Size</label>
          <div className="seg">{SIZES.map((z) => <button key={z} className={d.size === z ? 'on' : ''} onClick={() => set({ size: z })}>{z}</button>)}</div>
        </>)}
        <label>Size on the canvas</label>
        <p className="faint">{Math.round(n.width ?? 0)} × {Math.round(n.height ?? 0)}{d.locked ? ': locked.' : ': drag a corner to resize.'}</p>
        <button className={`toggle wide ${d.locked ? 'on' : ''}`} aria-pressed={!!d.locked} onClick={() => set({ locked: !d.locked })}
          title={d.locked ? 'Unlock: move, resize, edit and delete it again' : 'Lock: it stays put, and cannot be resized, edited or deleted'}>
          {d.locked ? '🔒 Locked · unlock' : '🔓 Lock'}</button>
        <div className="row">
          <button onClick={() => s.toFront(n.id, true)} title="Bring to front">Front</button>
          <button onClick={() => s.toFront(n.id, false)} title="Send to back">Back</button>
          <button onClick={s.duplicate} title="Duplicate (⌘D)">Duplicate</button>
        </div>
        <button className="bad wide" onClick={() => s.remove([n.id])} disabled={!!d.locked} title={d.locked ? 'Unlock it first' : undefined}>Delete</button>
      </>
    )
  }

  if (edge) {
    const l = (edge.data ?? {}) as Look
    const look = (patch: Look) => s.updateEdgeLook(edge.id, patch)
    const ends = l.ends ?? 'end'
    return (
      <>
        <h3>{ends === 'none' ? 'Line' : 'Arrow'}</h3>
        <label>Shape</label>
        <div className="seg">{LINE_SHAPES.map((x) => (
          <button key={x} className={(l.shape ?? 'elbow') === x ? 'on' : ''} aria-pressed={(l.shape ?? 'elbow') === x} onClick={() => look({ shape: x })}>{x}</button>
        ))}</div>
        <label>Ends</label>
        <div className="seg">{LINE_ENDS.map((x) => (
          <button key={x} className={ends === x ? 'on' : ''} aria-pressed={ends === x} onClick={() => look({ ends: x })}
            title={{ none: 'A plain line', start: 'An arrowhead where it starts', end: 'An arrowhead where it ends', both: 'Arrowheads at both ends' }[x]}>{{ none: 'none', start: '← start', end: '→ end', both: '↔ both' }[x]}</button>
        ))}</div>
        <label>Style</label>
        <div className="seg">
          <button className={!l.dash ? 'on' : ''} aria-pressed={!l.dash} onClick={() => look({ dash: false })}>solid</button>
          <button className={l.dash ? 'on' : ''} aria-pressed={!!l.dash} onClick={() => look({ dash: true })}>dashed</button>
        </div>
        <label>Colour</label>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className={`sw ${(l.color ?? 'grey') === c ? 'on' : ''}`} style={{ background: PALETTE[c].bg, borderColor: PALETTE[c].fg }}
              onClick={() => look({ color: c === 'grey' ? undefined : c })} title={c} aria-label={c}><i style={{ background: PALETTE[c].fg }} /></button>
          ))}
        </div>
        <label htmlFor="elabel">Label</label>
        <input id="elabel" value={String(edge.label ?? '')} placeholder="e.g. HTTPS 443" onFocus={s.checkpoint} onChange={(e) => s.updateEdge(edge.id, e.target.value)} />
        <p className="faint" style={{ marginTop: 10 }}>Drag either end to move it: near a shape's edge it snaps on, in empty space it stays free.</p>
        <button className="bad wide" onClick={() => s.remove([edge.id])}>Delete</button>
      </>
    )
  }

  return (
    <>
      <h3>Nothing selected</h3>
      <p className="faint">Click a shape or an arrow to change it. Drag on the canvas, or Shift-click, to select several. Space + drag moves around.</p>
      <p className="faint">⌘Z undo · ⇧⌘Z redo · ⌘A select all · ⌘D duplicate · Enter edits · Delete removes</p>
    </>
  )
}

// the right column; › hides it to a thin rail (‹ brings it back), remembered per person
export function Inspector({ open, toggle, width, resize, reset }: {
  open: boolean; toggle: () => void; width: number; resize: (w: number, done?: boolean) => void; reset: () => void
}) {
  if (!open) return (
    <aside className="insp shut" aria-label="Details (hidden)">
      <button className="fold" onClick={toggle} title="Show the details panel" aria-label="Show details">‹</button>
      <span className="rail-label">Details</span>
    </aside>
  )
  return (
    <aside className="insp" aria-label="Details">
      <Grip edge="left" width={width} resize={resize} reset={reset} label="Resize the details panel" />
      <div className="insp-in">
        <button className="fold" onClick={toggle} title="Hide the details panel" aria-label="Hide details">›</button>
        <Details />
      </div>
    </aside>
  )
}
