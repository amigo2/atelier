// A panel's draggable edge: drag to make the panel wider or narrower, double-click for its default width.
// `edge` is the side of the panel the grip sits on; on the left edge, dragging left makes the panel wider.
export function Grip({ edge, width, resize, reset, label }: {
  edge: 'left' | 'right'; width: number; resize: (w: number, done?: boolean) => void; reset: () => void; label: string
}) {
  const grab = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = width, grip = e.currentTarget, sign = edge === 'right' ? 1 : -1
    grip.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing')
    const move = (m: PointerEvent) => resize(w0 + sign * (m.clientX - x0))
    const up = (u: PointerEvent) => {
      resize(w0 + sign * (u.clientX - x0), true)
      document.body.classList.remove('resizing')
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
  }
  return <div className={`grip grip-${edge}`} onPointerDown={grab} onDoubleClick={reset} role="separator" aria-orientation="vertical"
    aria-label={label} title="Drag to resize · double-click for the default width" />
}
