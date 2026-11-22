// Richer words, still plain text underneath. What you type is what is stored; a little markup says the rest:
//
//   **bold**   *italic*   ~~struck through~~   {red:coloured words}   and a line starting "* " or "- " is a bullet.
//
// Plain text keeps everything else working: the PDF keeps text as text, the AI reads and writes it, an import
// produces it. Select words while editing and a small bar puts the markup in for you.
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, PALETTE, type Color } from '../model'

const INLINE = new RegExp(String.raw`(\*\*[^*]+?\*\*|~~[^~]+?~~|\{(?:${COLORS.join('|')}):[^{}]+\}|\*[^*\s][^*]*?\*)`, 'g')
const COLOURED = new RegExp(String.raw`^\{(${COLORS.join('|')}):([^{}]+)\}$`)
const BULLET = /^(\s*)[*\-•] (.*)$/

/** Bold, italic, struck through and colour inside one line. Colour can hold the others: {red:**this**}. */
export function RichInline({ s }: { s: string }) {
  return <>{s.split(INLINE).map((p, i) => {
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return <strong key={i}><RichInline s={p.slice(2, -2)} /></strong>
    if (p.length > 4 && p.startsWith('~~') && p.endsWith('~~')) return <s key={i}><RichInline s={p.slice(2, -2)} /></s>
    const c = COLOURED.exec(p)
    if (c) return <span key={i} style={{ color: PALETTE[c[1] as Color].fg }}><RichInline s={c[2]} /></span>
    if (p.length > 2 && p.startsWith('*') && p.endsWith('*') && p[1] !== ' ') return <em key={i}><RichInline s={p.slice(1, -1)} /></em>
    return p ? <span key={i}>{p}</span> : null
  })}</>
}

/** A block of words: one line each, and the lines that start "* " or "- " as bullets with a hanging indent. */
export function Rich({ s }: { s: string }) {
  return <>{s.split('\n').map((line, i) => {
    const b = BULLET.exec(line)
    if (b) return (
      <div key={i} className="rich-b" style={{ marginLeft: `${b[1].length * 0.5}em` }}>
        <span className="rich-dot">•</span><span><RichInline s={b[2]} /></span>
      </div>
    )
    return <div key={i} className="rich-l">{line ? <RichInline s={line} /> : '​'}</div>
  })}</>
}

// --- typing

/** On a bullet line, a new line starts the next bullet; on an empty bullet, it ends the list. */
export function newLine(t: HTMLTextAreaElement): string {
  const v = t.value, at = t.selectionStart
  const start = v.lastIndexOf('\n', at - 1) + 1, line = v.slice(start, at)
  const b = /^(\s*[*\-•] )(.*)$/.exec(line)
  if (b && !b[2].trim()) {                                       // "* " and nothing else: the list is over
    t.setRangeText('', start, at, 'end')
    return t.value
  }
  t.setRangeText('\n' + (b ? b[1] : ''), at, t.selectionEnd, 'end')
  return t.value
}

// --- the bar over selected words

type Edit = (value: string, select: [number, number]) => void

function wrap(t: HTMLTextAreaElement, pre: string, post: string, done: Edit) {
  const { value: v, selectionStart: s, selectionEnd: e } = t
  // already wrapped exactly this way: take it off instead
  if (v.slice(s - pre.length, s) === pre && v.slice(e, e + post.length) === post) {
    done(v.slice(0, s - pre.length) + v.slice(s, e) + v.slice(e + post.length), [s - pre.length, e - pre.length])
    return
  }
  done(v.slice(0, s) + pre + v.slice(s, e) + post + v.slice(e), [s + pre.length, e + pre.length])
}

function colour(t: HTMLTextAreaElement, c: Color, done: Edit) {
  const { value: v, selectionStart: s, selectionEnd: e } = t
  // Already coloured? Look past bold, italic and strike marks between the selection and the colour: {red:**words**}.
  const before = /\{([a-z]+):([*~]{0,2})$/.exec(v.slice(0, s))
  const stars = before?.[2] ?? ''
  if (before && COLORS.includes(before[1] as Color) && v.slice(e, e + stars.length + 1) === stars + '}') {
    const from = s - before[0].length, inner = stars + v.slice(s, e) + stars
    if (before[1] === c) {                                           // the same colour again: take it off
      done(v.slice(0, from) + inner + v.slice(e + stars.length + 1), [from + stars.length, from + stars.length + e - s])
    } else {                                                         // another colour: swap it
      const pre = `{${c}:`
      done(v.slice(0, from) + pre + inner + '}' + v.slice(e + stars.length + 1), [from + pre.length + stars.length, from + pre.length + stars.length + e - s])
    }
    return
  }
  wrap(t, `{${c}:`, '}', done)
}

function bullets(t: HTMLTextAreaElement, done: Edit) {
  const { value: v, selectionStart: s, selectionEnd: e } = t
  const a = v.lastIndexOf('\n', s - 1) + 1, z = v.indexOf('\n', e) < 0 ? v.length : v.indexOf('\n', e)
  const lines = v.slice(a, z).split('\n')
  const on = lines.every((l) => BULLET.test(l))
  const next = lines.map((l) => (on ? l.replace(/^(\s*)[*\-•] /, '$1') : `* ${l}`)).join('\n')
  done(v.slice(0, a) + next + v.slice(z), [a, a + next.length])
}

/** Put a change in the text box and keep the same words selected, so marks can be stacked one after another. */
const editing = (box: HTMLTextAreaElement, onEdit: (value: string) => void): Edit => (value, [s, e]) => {
  onEdit(value)
  requestAnimationFrame(() => { box.focus(); box.setSelectionRange(s, e) })
}

/** ⌘B bold, ⌘I italic, ⌘⇧X struck through, while typing. True when the key was one of them. */
export function formatKey(e: React.KeyboardEvent<HTMLTextAreaElement>, onEdit: (value: string) => void): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false
  const k = e.key.toLowerCase(), box = e.currentTarget
  const mark = k === 'b' && !e.shiftKey ? '**' : k === 'i' && !e.shiftKey ? '*' : k === 'x' && e.shiftKey ? '~~' : null
  if (!mark || box.selectionStart === box.selectionEnd) return false
  e.preventDefault()
  wrap(box, mark, mark, editing(box, onEdit))
  return true
}

/**
 * Shown above a text box while words in it are selected. Buttons keep the focus in the text box (mousedown is
 * cancelled), so editing never closes under you.
 */
export function FormatBar({ box, onEdit }: { box: HTMLTextAreaElement | null; onEdit: (value: string) => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (!box) return
    const check = () => {
      if (document.activeElement !== box || box.selectionStart === box.selectionEnd) { setAt(null); return }
      const r = box.getBoundingClientRect()
      setAt({ x: r.left, y: r.top })
    }
    check()
    document.addEventListener('selectionchange', check)
    return () => document.removeEventListener('selectionchange', check)
  }, [box])
  if (!box || !at) return null

  const done = editing(box, onEdit)
  const act = (f: () => void) => (ev: React.MouseEvent) => { ev.preventDefault(); f() }
  return createPortal(
    <div className="fmt-bar" style={{ left: at.x, top: Math.max(4, at.y - 40) }} role="toolbar" aria-label="Format the selected words">
      <button onMouseDown={act(() => wrap(box, '**', '**', done))} title="Bold (⌘B)" aria-label="Bold"><b>B</b></button>
      <button onMouseDown={act(() => wrap(box, '*', '*', done))} title="Italic (⌘I)" aria-label="Italic"><i>I</i></button>
      <button onMouseDown={act(() => wrap(box, '~~', '~~', done))} title="Strikethrough (⌘⇧X)" aria-label="Strikethrough"><s>S</s></button>
      <button onMouseDown={act(() => bullets(box, done))} title="Bullet points" aria-label="Bullets">•</button>
      <span className="fmt-sep" />
      {COLORS.map((c) => (
        <button key={c} className="fmt-sw" onMouseDown={act(() => colour(box, c, done))} title={c} aria-label={`Colour ${c}`}>
          <i style={{ background: PALETTE[c].fg }} />
        </button>
      ))}
    </div>,
    document.body,
  )
}
