// The four kinds of element on the canvas. Each one resizes from its corners when selected, has a connection
// point on every side (drag from one to another to draw an arrow), and edits its words in place on double-click.
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { iconByName } from '../icons'
import { fitToText } from '../fit'
import { PALETTE, type El, type ElData } from '../model'
import { useApp } from '../store'

// a card's title row is a flex row (icon, then words), so it aligns by justifying, not by text-align
const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const

function Frame({ id, selected, min, children }: { id: string; selected: boolean; min: [number, number]; children: React.ReactNode }) {
  const checkpoint = useApp((s) => s.checkpoint)
  const locked = useApp((s) => !!s.nodes.find((n) => n.id === id)?.data.locked)
  return (
    <>
      {locked && selected && <span className="lock-badge" title="Locked: unlock it in the panel on the right">🔒</span>}
      <NodeResizer isVisible={selected && !locked} minWidth={min[0]} minHeight={min[1]} onResizeStart={checkpoint}
        lineClassName="rz-line" handleClassName="rz-handle" />
      {SIDES.map(([k, p]) => <Handle key={k} id={k} type="source" position={p} className="hd" />)}
      <div className="el-in" onDoubleClick={() => { if (!locked) useApp.getState().setEditing(id) }}>{children}</div>
    </>
  )
}

// A word or two, edited in place. Enter keeps it, in every field, as does Escape or leaving the field.
// Shift+Enter makes a new line where one is allowed. (Enter used to type a newline in a multi-line field,
// and since editing starts with the words selected, that newline replaced them: Enter deleted the text.)
function Field({ id, k, value, className, multiline, placeholder }: { id: string; k: keyof ElData; value?: string; className: string; multiline?: boolean; placeholder?: string }) {
  const editing = useApp((s) => s.editing === id)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing && ref.current && ref.current.dataset.first === '1') { ref.current.focus(); ref.current.select() } }, [editing])
  if (!editing) return value ? <div className={className}><Rich s={value} /></div> : null
  return (
    <textarea ref={ref} data-first={k === 'title' || k === 'text' ? '1' : '0'} className={`${className} edit nodrag nowheel`} value={value ?? ''} placeholder={placeholder}
      rows={multiline ? 2 : 1}
      onChange={(e) => { useApp.getState().update(id, { [k]: e.target.value }); fitToText(id, true) }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && e.shiftKey && !multiline) { e.preventDefault(); return }
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); useApp.getState().setEditing(null) }
      }}
      onBlur={(e) => { if (!e.relatedTarget?.closest?.(`[data-id="${id}"]`)) useApp.getState().setEditing(null) }} />
  )
}

/** `**bold**` and `*italic*`, nothing else. The raw text is what you edit, so what you type is stored. */
function Rich({ s }: { s: string }) {
  return (
    <>
      {s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, i) => {
        if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
        if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

/**
 * A list or a table, edited as plain lines: one item per line, cells separated by `|`.
 *
 * Crude on purpose. A grid editor with cell selection is a week of work, and typing three lines into a
 * textarea is faster than clicking through one for everything a slide actually holds.
 */
function Lines({ id, value, onChange, placeholder, children }: {
  id: string; value: string; onChange: (v: string) => void; placeholder: string; children: React.ReactNode
}) {
  const editing = useApp((s) => s.editing === id)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select() } }, [editing])
  if (!editing) return <>{children}</>
  return (
    <textarea ref={ref} className="lines edit nodrag nowheel" value={value} placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); fitToText(id, true) }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); useApp.getState().setEditing(null) } }}
      onBlur={() => useApp.getState().setEditing(null)} />
  )
}

export function List({ id, data, selected }: NodeProps<El>) {
  const items = data.items ?? []
  return (
    <Frame id={id} selected={selected} min={[120, 40]}>
      <div className={`lst txt-${data.size ?? 'body'}`} style={{ color: PALETTE[data.color].fg, ...(data.fs ? { fontSize: data.fs } : {}) }}>
        <Lines id={id} value={items.join('\n')} placeholder={'One item per line'}
          onChange={(v) => useApp.getState().update(id, { items: v.split('\n') })}>
          <ul>{items.map((it, i) => <li key={i}><Rich s={it} /></li>)}</ul>
        </Lines>
      </div>
    </Frame>
  )
}

export function Table({ id, data, selected }: NodeProps<El>) {
  const rows = data.rows ?? []
  const head = data.head !== false
  return (
    <Frame id={id} selected={selected} min={[160, 40]}>
      <div className="tbl" style={{ color: PALETTE[data.color].fg, borderColor: PALETTE[data.color].line, ...(data.fs ? { fontSize: data.fs } : {}) }}>
        <Lines id={id} value={rows.map((r) => r.join(' | ')).join('\n')} placeholder={'One row per line, cells separated by |'}
          onChange={(v) => useApp.getState().update(id, { rows: v.split('\n').map((r) => r.split('|').map((c) => c.trim())) })}>
          <table>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={head && i === 0 ? 'hd' : ''}>
                  {r.map((c, j) => <td key={j}><Rich s={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Lines>
      </div>
    </Frame>
  )
}

/**
 * A bar chart from numbers, not three rectangles someone sized by hand.
 *
 * The height is the value against the largest one, so changing a number moves the bar — which is the whole
 * difference between a chart and a drawing of a chart. Bars are edited as lines: `label | value | note`.
 */
export function Icon({ id, data, selected }: NodeProps<El>) {
  const I = iconByName(data.icon)
  const c = PALETTE[data.color]
  return (
    <Frame id={id} selected={selected} min={[24, 24]}>
      <div className="ico" style={{ color: c.fg }}>
        {I ? <I /> : <span className="ico-none" title={`No icon called “${data.icon ?? ''}”`}>?</span>}
      </div>
    </Frame>
  )
}

export function Bars({ id, data, selected }: NodeProps<El>) {
  const bars = data.bars ?? []
  const max = Math.max(1, ...bars.map((b) => b.value))
  const c = PALETTE[data.color]
  return (
    <Frame id={id} selected={selected} min={[160, 120]}>
      <div className="bars" style={{ color: c.fg, ...(data.fs ? { fontSize: data.fs } : {}) }}>
        <Lines id={id} value={bars.map((b) => [b.label, b.value, b.note ?? ''].filter((x) => x !== '').join(' | ')).join('\n')}
          placeholder={'One bar per line: label | value | note'}
          onChange={(v) => useApp.getState().update(id, {
            bars: v.split('\n').filter((l) => l.trim()).map((l) => {
              const [label = '', value = '0', note = ''] = l.split('|').map((x) => x.trim())
              return { label, value: Number(value.replace(/[^\d.-]/g, '')) || 0, ...(note ? { note } : {}) }
            }),
          })}>
          <div className="bars-row">
            {bars.map((b, i) => (
              <div key={i} className="bars-one">
                <span className="bars-v">{b.note ?? b.value.toLocaleString()}</span>
                {/* a floor of 2%, so a bar that is nearly nothing is still visibly a bar and not a gap */}
                <span className="bars-b" style={{ height: `${Math.max(2, (b.value / max) * 100)}%`, background: c.fg }} />
                <span className="bars-l">{b.label}</span>
              </div>
            ))}
          </div>
        </Lines>
      </div>
    </Frame>
  )
}

export function Image({ id, data, selected }: NodeProps<El>) {
  return (
    <Frame id={id} selected={selected} min={[60, 40]}>
      <div className="img" style={{ borderColor: PALETTE[data.color].line }}>
        {data.src
          ? <img src={data.src} alt={data.alt ?? ''} style={{ objectFit: data.fit ?? 'contain' }} draggable={false} />
          : <span className="img-empty">No picture yet — choose one in the panel on the right</span>}
      </div>
    </Frame>
  )
}

export function Card({ id, data, selected }: NodeProps<El>) {
  const c = PALETTE[data.color]
  return (
    <Frame id={id} selected={selected} min={[100, 60]}>
      <div className="card" style={{ background: c.bg, borderColor: c.line, textAlign: data.align ?? 'left' }}>
        <div className="card-t" style={{ color: c.fg, justifyContent: JUSTIFY[data.align ?? 'left'] }}>
          {data.icon && !data.emoji && <CardIcon name={data.icon} />}
          {data.emoji && <span className="emoji">{data.emoji}</span>}
          <Field id={id} k="title" value={data.title} className="card-title" placeholder="Title" />
        </div>
        <Field id={id} k="sub" value={data.sub} className="card-sub" multiline placeholder="what it does" />
      </div>
    </Frame>
  )
}

function CardIcon({ name }: { name: string }) {
  const I = iconByName(name)
  return I ? <span className="card-ico"><I size={17} strokeWidth={2} /></span> : null
}

export function Text({ id, data, selected }: NodeProps<El>) {
  return (
    <Frame id={id} selected={selected} min={[40, 20]}>
      <div className={`txt txt-${data.size ?? 'body'}`} style={{ color: data.size === 'label' ? PALETTE.grey.fg : PALETTE[data.color].fg, textAlign: data.align ?? 'left', ...(data.fs ? { fontSize: data.fs } : {}) }}>
        <Field id={id} k="text" value={data.text} className="txt-v" multiline={data.size === 'body'} placeholder="Text" />
      </div>
    </Frame>
  )
}

export function Box({ id, data, selected }: NodeProps<El>) {
  const c = PALETTE[data.color]
  return (
    <Frame id={id} selected={selected} min={[120, 80]}>
      <div className="box" style={{ borderColor: c.line, background: data.color === 'grey' ? '#fbfcfe' : c.bg }}>
        <Field id={id} k="title" value={data.title} className="box-title" placeholder="GROUP" />
      </div>
    </Frame>
  )
}

export function Pill({ id, data, selected }: NodeProps<El>) {
  const c = PALETTE[data.color]
  return (
    <Frame id={id} selected={selected} min={[40, 22]}>
      <div className="pill" style={{ background: c.bg, color: c.fg, borderColor: c.line }}>
        <Field id={id} k="text" value={data.text} className="pill-v" placeholder="label" />
      </div>
    </Frame>
  )
}

/**
 * The free end of a line. Invisible, except as a small dot while it or its line is selected, so there is
 * something to grab. Its one connection point sits at its centre and faces the other end of the line, so a
 * curve leaves it heading the right way.
 */
export function Point({ id, selected }: NodeProps<El>) {
  const facing = useApp((s) => {
    const e = s.edges.find((x) => x.source === id || x.target === id)
    const me = s.nodes.find((n) => n.id === id), other = e && s.nodes.find((n) => n.id === (e.source === id ? e.target : e.source))
    if (!me || !other) return Position.Right
    const dx = other.position.x + (other.width ?? 0) / 2 - me.position.x, dy = other.position.y + (other.height ?? 0) / 2 - me.position.y
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? Position.Right : Position.Left) : (dy >= 0 ? Position.Bottom : Position.Top)
  })
  const lineSelected = useApp((s) => s.edges.some((x) => x.selected && (x.source === id || x.target === id)))
  return (
    <div className={`pt ${selected ? 'on' : ''} ${lineSelected ? 'line-on' : ''}`} title="A line's free end: drag it near a shape to attach it">
      <Handle id="c" type="source" position={facing} className="pt-h" isConnectable={false} />
    </div>
  )
}

export const NODE_TYPES = { card: Card, text: Text, box: Box, pill: Pill, list: List, table: Table, image: Image, bars: Bars, icon: Icon, point: Point }
