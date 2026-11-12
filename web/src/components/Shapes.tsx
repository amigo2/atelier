// The four kinds of element on the canvas. Each one resizes from its corners when selected, has a connection
// point on every side (drag from one to another to draw an arrow), and edits its words in place on double-click.
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { useEffect, useRef } from 'react'
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
  if (!editing) return value ? <div className={className}>{value}</div> : null
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

export function Card({ id, data, selected }: NodeProps<El>) {
  const c = PALETTE[data.color]
  return (
    <Frame id={id} selected={selected} min={[100, 60]}>
      <div className="card" style={{ background: c.bg, borderColor: c.line }}>
        <div className="card-t" style={{ color: c.fg }}>
          {data.emoji && <span className="emoji">{data.emoji}</span>}
          <Field id={id} k="title" value={data.title} className="card-title" placeholder="Title" />
        </div>
        <Field id={id} k="sub" value={data.sub} className="card-sub" multiline placeholder="what it does" />
      </div>
    </Frame>
  )
}

export function Text({ id, data, selected }: NodeProps<El>) {
  return (
    <Frame id={id} selected={selected} min={[40, 20]}>
      <div className={`txt txt-${data.size ?? 'body'}`} style={{ color: data.size === 'label' ? PALETTE.grey.fg : PALETTE[data.color].fg }}>
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

export const NODE_TYPES = { card: Card, text: Text, box: Box, pill: Pill }
