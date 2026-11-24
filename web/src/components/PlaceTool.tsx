// Placing an element where you click: pick it in the toolbar, then click on the canvas. Laid over the canvas only
// while a tool is picked, so it never competes with selecting and moving. Esc, or picking the tool again, cancels.
import { useEffect } from 'react'

export function PlaceTool({ label, place, done }: { label: string; place: (screen: { x: number; y: number }) => void; done: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [done])
  return (
    <div className="place-tool" role="application" aria-label={`Placing a ${label.toLowerCase()}: click where it goes`}
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); place({ x: e.clientX, y: e.clientY }); done() }}>
      <div className="hint">{label}: click where it goes · Esc cancels</div>
    </div>
  )
}
