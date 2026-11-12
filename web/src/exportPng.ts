// The diagram as a PNG: everything on the canvas, cropped to what's drawn with a margin, at 2x, on white.
// Selection outlines, resize handles and connection points are left out.
import { getNodesBounds, type Edge } from '@xyflow/react'
import { toPng } from 'html-to-image'
import type { El, Frame } from './model'

const PAD = 40

// with a frame on: exactly the frame, whatever is outside it is cut; without: cropped to the drawing
export async function exportPng(nodes: El[], _edges: Edge[], name: string, frame: Frame | null = null) {
  const el = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!el || (!nodes.length && !frame)) return
  const nb = getNodesBounds(nodes)
  const b = frame ? { x: frame.x + PAD, y: frame.y + PAD, width: frame.w - PAD * 2, height: frame.h - PAD * 2 } : nb
  const w = Math.ceil(b.width + PAD * 2), h = Math.ceil(b.height + PAD * 2)
  document.body.classList.add('exporting')
  try {
    const url = await toPng(el, {
      backgroundColor: '#ffffff', width: w, height: h, pixelRatio: 2,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${PAD - b.x}px, ${PAD - b.y}px) scale(1)` },
      filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('react-flow__handle') || n.classList.contains('react-flow__resize-control') || n.classList.contains('xframe'))),
    })
    const a = document.createElement('a')
    a.download = `${name.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'diagram'}.png`
    a.href = url
    a.click()
  } finally {
    document.body.classList.remove('exporting')
  }
}
