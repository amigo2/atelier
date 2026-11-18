// The deck as a PDF: every page, in order, drawn as SVG and printed by Chromium on the API side.
//
// SVG and not PNG, and that is the whole reason this file exists. A PNG in a PDF is a photograph of a
// slide: blurry the moment anyone zooms, and nobody can select a figure out of it. html-to-image's toSvg
// keeps the DOM inside a foreignObject, so the text stays text all the way into the print.
import { toSvg } from 'html-to-image'
import { pagesInOrder, type Page } from './model'

const HIDE = ['react-flow__handle', 'react-flow__resize-control', 'xframe', 'xpage-label']

/** One page's rectangle, as an SVG string the size of the page. */
async function pageToSvg(viewport: HTMLElement, p: Page): Promise<string> {
  const url = await toSvg(viewport, {
    backgroundColor: '#ffffff',
    width: p.w,
    height: p.h,
    // Slide the drawing so this page's top-left sits at the origin, then cut to the page's size.
    style: { width: `${p.w}px`, height: `${p.h}px`, transform: `translate(${-p.x}px, ${-p.y}px) scale(1)` },
    filter: (n) => !(n instanceof HTMLElement && HIDE.some((c) => n.classList.contains(c))),
  })
  // toSvg returns a data: URL; the API wants the markup.
  return decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length))
}

export async function exportPdf(pages: Page[], name: string): Promise<void> {
  const el = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!el || !pages.length) return
  const ordered = pagesInOrder(pages)

  document.body.classList.add('exporting')
  let svgs: string[]
  try {
    // One at a time: toSvg clones the whole viewport each call, and several at once on a big deck is how a
    // tab runs out of memory.
    svgs = []
    for (const p of ordered) svgs.push(await pageToSvg(el, p))
  } finally {
    document.body.classList.remove('exporting')
  }

  const res = await fetch('/api/export/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, width: ordered[0].w, height: ordered[0].h, pages: svgs }),
  })
  if (!res.ok) throw new Error(`export failed: ${res.status} ${await res.text()}`)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.download = `${name.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'deck'}.pdf`
  a.href = url
  a.click()
  URL.revokeObjectURL(url)
}
