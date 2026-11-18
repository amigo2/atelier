// The four kinds of element on the canvas. Each one resizes from its corners when selected, has a connection
// point on every side (drag from one to another to draw an arrow), and edits its words in place on double-click.
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { iconByName } from '../icons'
import { PALETTE, type El, type ElData } from '../model'
import { useApp } from '../store'

const SIDES = [['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]] as const

function Frame({ id, selected, min, children }: { id: string; selected: boolean; min: [number, number]; children: React.ReactNode }) {
  const checkpoint = useApp((s) => s.checkpoint)
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={min[0]} minHeight={min[1]} onResizeStart={checkpoint}
        lineClassName="rz-line" handleClassName="rz-handle" />
      {SIDES.map(([k, p]) => <Handle key={k} id={k} type="source" position={p} className="hd" />)}
      <div className="el-in" onDoubleClick={() => useApp.getState().setEditing(id)}>{children}</div>
    </>
  )
}

// a word or two, edited in place: Enter (or leaving the field) keeps it, Escape too; Shift+Enter for a new line
function Field({ id, k, value, className, multiline, placeholder }: { id: string; k: keyof ElData; value?: string; className: string; multiline?: boolean; placeholder?: string }) {
  const editing = useApp((s) => s.editing === id)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing && ref.current && ref.current.dataset.first === '1') { ref.current.focus(); ref.current.select() } }, [editing])
  if (!editing) return value ? <div className={className}><Rich s={value} /></div> : null
  return (
    <textarea ref={ref} data-first={k === 'title' || k === 'text' ? '1' : '0'} className={`${className} edit nodrag nowheel`} value={value ?? ''} placeholder={placeholder}
      rows={multiline ? 2 : 1}
      onChange={(e) => useApp.getState().update(id, { [k]: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !multiline)) { e.preventDefault(); useApp.getState().setEditing(null) }
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
      onChange={(e) => onChange(e.target.value)}
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
      <div className="card" style={{ background: c.bg, borderColor: c.line }}>
        <div className="card-t" style={{ color: c.fg }}>
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
      <div className={`txt txt-${data.size ?? 'body'}`} style={{ color: data.size === 'label' ? PALETTE.grey.fg : PALETTE[data.color].fg, ...(data.fs ? { fontSize: data.fs } : {}) }}>
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

export const NODE_TYPES = { card: Card, text: Text, box: Box, pill: Pill, list: List, table: Table, image: Image, bars: Bars, icon: Icon }
