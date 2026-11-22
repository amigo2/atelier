// Drawing a line with the toolbar's line tools: press, drag, let go. Laid over the canvas only while a line tool
// is on, so it never competes with selecting and moving. Each end snaps to an element's edge if it is let go
// within a few pixels of one (see snap.ts), and is free on the canvas otherwise.
import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import type { Look } from '../model'
import { snapAt, type Snapped } from '../snap'
import { useApp, type End } from '../store'

type Pt = { x: number; y: number }

/** The side of a snapped element, as a segment in the overlay's own coordinates: what lights up. */
function sideSegment(s: Snapped, o: DOMRect): [Pt, Pt] {
  const r = s.rect, L = r.left - o.left, T = r.top - o.top, R = r.right - o.left, B = r.bottom - o.top
  return s.side === 't' ? [{ x: L, y: T }, { x: R, y: T }] : s.side === 'b' ? [{ x: L, y: B }, { x: R, y: B }]
    : s.side === 'l' ? [{ x: L, y: T }, { x: L, y: B }] : [{ x: R, y: T }, { x: R, y: B }]
}

/** Where a snapped end touches its element: the middle of that side. That is where its connection dot is. */
function sideMiddle(s: Snapped): Pt {
  const r = s.rect
  return s.side === 't' ? { x: r.left + r.width / 2, y: r.top } : s.side === 'b' ? { x: r.left + r.width / 2, y: r.bottom }
    : s.side === 'l' ? { x: r.left, y: r.top + r.height / 2 } : { x: r.right, y: r.top + r.height / 2 }
}

export function LineDraw({ look, label, done }: { look: Look; label: string; done: () => void }) {
  const rf = useReactFlow()
  const me = useRef<HTMLDivElement>(null)
  const [from, setFrom] = useState<{ at: Pt; snap: Snapped | null } | null>(null)
  const [to, setTo] = useState<{ at: Pt; snap: Snapped | null } | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [done])

  const end = (p: { at: Pt; snap: Snapped | null }): End =>
    p.snap ? { node: p.snap.id, side: p.snap.side } : rf.screenToFlowPosition(p.at)

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = { x: e.clientX, y: e.clientY }
    setFrom({ at, snap: snapAt(at.x, at.y) }); setTo({ at, snap: null })
  }
  const move = (e: React.PointerEvent) => {
    const at = { x: e.clientX, y: e.clientY }
    const skip = new Set(from?.snap ? [from.snap.id] : [])
    if (from) setTo({ at, snap: snapAt(at.x, at.y, skip) })
    else setTo({ at, snap: snapAt(at.x, at.y) })        // before pressing: show what the first end would snap to
  }
  const up = (e: React.PointerEvent) => {
    if (!from) return
    const at = { x: e.clientX, y: e.clientY }
    const last = { at, snap: snapAt(at.x, at.y, new Set(from.snap ? [from.snap.id] : [])) }
    // a click, not a drag: nothing to draw
    if (Math.hypot(at.x - from.at.x, at.y - from.at.y) > 6) useApp.getState().addLine(end(from), end(last), look)
    setFrom(null); setTo(null); done()
  }

  const o = me.current?.getBoundingClientRect()
  const local = (p: Pt): Pt => (o ? { x: p.x - o.left, y: p.y - o.top } : p)
  const a = from && local(from.snap ? sideMiddle(from.snap) : from.at)
  const b = to && local(to.snap ? sideMiddle(to.snap) : to.at)
  const lit = [from?.snap, to?.snap].filter((s): s is Snapped => !!s)

  return (
    <div ref={me} className="line-draw" onPointerDown={down} onPointerMove={move} onPointerUp={up}
      role="application" aria-label={`Drawing a ${label.toLowerCase()}: press and drag`}>
      <svg>
        {o && lit.map((s, i) => { const [p, q] = sideSegment(s, o); return <line key={i} className="snap-side" x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> })}
        {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={2} strokeDasharray={look.dash ? '6 5' : undefined} />}
      </svg>
      <div className="hint">{label}: press and drag · near a shape's edge it snaps · Esc cancels</div>
    </div>
  )
}
