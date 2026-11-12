// The diagram as a PNG: everything on the canvas, cropped to what's drawn with a margin, at 2x, on white.
// Selection outlines, resize handles and connection points are left out.
import { getNodesBounds, type Edge } from '@xyflow/react'
import { toPng } from 'html-to-image'
import type { El } from './model'

const PAD = 40

export async function exportPng(nodes: El[], _edges: Edge[], name: string) {
  const el = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!el || !nodes.length) return
  const b = getNodesBounds(nodes)
  const w = Math.ceil(b.width + PAD * 2), h = Math.ceil(b.height + PAD * 2)
  document.body.classList.add('exporting')
  try {
    const url = await toPng(el, {
      backgroundColor: '#ffffff', width: w, height: h, pixelRatio: 2,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${PAD - b.x}px, ${PAD - b.y}px) scale(1)` },
      filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('react-flow__handle') || n.classList.contains('react-flow__resize-control'))),
    })
    const a = document.createElement('a')
    a.download = `${name.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'diagram'}.png`
    a.href = url
    a.click()
  } finally {
    document.body.classList.remove('exporting')
  }
}
