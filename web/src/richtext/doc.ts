// Blocks of styled runs (markup.ts) to and from the rich editor's document (TipTap's JSON), and nothing else:
// no editor here, so the conversion can be tested on its own.
//
// Paragraphs are lines; a run of bullet lines is one bullet list. Bold, italic and strike are the editor's own
// marks; colour and size are two marks of ours (extensions.ts), each with a name.
import type { Color } from '../model'
import { merge, type Block, type Marks, type Run, type Size } from './markup'

export type JMark = { type: string; attrs?: Record<string, unknown> }
export type JNode = { type: string; content?: JNode[]; text?: string; marks?: JMark[]; attrs?: Record<string, unknown> }

function marksOut(m: Marks): JMark[] {
  return [
    ...(m.b ? [{ type: 'bold' }] : []), ...(m.i ? [{ type: 'italic' }] : []), ...(m.s ? [{ type: 'strike' }] : []),
    ...(m.color ? [{ type: 'colour', attrs: { name: m.color } }] : []), ...(m.size ? [{ type: 'size', attrs: { name: m.size } }] : []),
  ]
}

function marksIn(ms: JMark[] = []): Marks {
  const m: Marks = {}
  for (const x of ms) {
    if (x.type === 'bold') m.b = true
    else if (x.type === 'italic') m.i = true
    else if (x.type === 'strike') m.s = true
    else if (x.type === 'colour' && x.attrs?.name) m.color = x.attrs.name as Color
    else if (x.type === 'size' && x.attrs?.name) m.size = x.attrs.name as Size
  }
  return m
}

const paragraph = (runs: Run[]): JNode => ({
  type: 'paragraph',
  ...(runs.length ? { content: runs.map((r) => ({ type: 'text', text: r.text, ...(marksOut(r.marks).length ? { marks: marksOut(r.marks) } : {}) })) } : {}),
})

/** Blocks into an editor document. */
export function toDoc(blocks: Block[]): JNode {
  const content: JNode[] = []
  for (const b of blocks) {
    if (!b.bullet) { content.push(paragraph(b.runs)); continue }
    const last = content[content.length - 1]
    const item = { type: 'listItem', content: [paragraph(b.runs)] }
    if (last?.type === 'bulletList') last.content!.push(item)
    else content.push({ type: 'bulletList', content: [item] })
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/** An editor document back into blocks. A line break inside a paragraph starts a new line, like Enter. */
export function fromDoc(doc: JNode): Block[] {
  const out: Block[] = []
  const lines = (p: JNode, bullet: boolean) => {
    let runs: Run[] = []
    for (const n of p.content ?? []) {
      if (n.type === 'hardBreak') { out.push({ bullet, runs: merge(runs) }); runs = []; continue }
      if (n.type === 'text' && n.text) runs.push({ text: n.text, marks: marksIn(n.marks) })
    }
    out.push({ bullet, runs: merge(runs) })
  }
  const walk = (n: JNode, bullet: boolean) => {
    if (n.type === 'paragraph') lines(n, bullet)
    else if (n.type === 'bulletList' || n.type === 'listItem') for (const c of n.content ?? []) walk(c, true)
    else for (const c of n.content ?? []) walk(c, bullet)
  }
  for (const n of doc.content ?? []) walk(n, false)
  return out.length ? out : [{ bullet: false, runs: [] }]
}
