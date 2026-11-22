// The words of an element, as stored: plain text with a little markup.
//
//   **bold**   *italic*   ~~struck~~   {red:coloured}   {large:bigger}   {red,large,b,i:all of them at once}
//   a line starting "* " or "- " is a bullet         a backslash makes the next character plain: \*  \{
//
// One reader (parse) turns that into blocks of styled runs; one writer (serialize) turns blocks back into it.
// The canvas draws from parse, and the rich editor goes through both, so what the editor shows, what the canvas
// draws and what is stored never disagree.
//
// The writer is careful in two ways. A single mark keeps its familiar short form (**bold**); anything combined,
// and anything butting against another styled run, uses the braced form, which cannot be misread (***x*** can).
// And characters that would read as markup are escaped, so text survives being edited: writing what parse read
// gives back the same blocks, every time.
import { COLORS, type Color } from '../model'

export type Size = 'small' | 'large' | 'huge'
export const SIZES: Size[] = ['small', 'large', 'huge']
export type Marks = { b?: true; i?: true; s?: true; color?: Color; size?: Size }
export type Run = { text: string; marks: Marks }
export type Block = { bullet: boolean; runs: Run[] }

const FLAGS = { b: 'b', i: 'i', s: 's' } as const
const ATTRS = new RegExp(String.raw`^\{([a-z]+(?:,[a-z]+)*):`)
const BULLET = /^\s*[*\-•] /

const isAttr = (a: string) => (COLORS as string[]).includes(a) || (SIZES as string[]).includes(a) || a in FLAGS

/** `{red,large:` at s[i]: its attributes and where the words start; null if it is not one. */
function attrsAt(s: string, i: number): { attrs: string[]; start: number } | null {
  const m = ATTRS.exec(s.slice(i))
  if (!m) return null
  const attrs = m[1].split(',')
  return attrs.every(isAttr) ? { attrs, start: i + m[0].length } : null
}

/** The `}` that closes a braced group whose words start at `from`, allowing groups inside it. -1 if none. */
function closeBrace(s: string, from: number): number {
  let depth = 0
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '{' && attrsAt(s, j)) { depth++; continue }
    if (s[j] === '}') { if (depth === 0) return j; depth-- }
  }
  return -1
}

/** Where `tok` closes, scanning from `from`: skipping escapes and whole braced groups. -1 if it never does. */
function closeToken(s: string, from: number, tok: string, italic = false): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '{') { const a = attrsAt(s, j); if (a) { const c = closeBrace(s, a.start); if (c >= 0) { j = c; continue } } }
    if (italic) {
      if (s.startsWith('**', j)) { j++; continue }                       // a bold pair inside the italic
      if (s[j] === '*' && j > from && s[j - 1] !== ' ') return j
    } else if (s.startsWith(tok, j) && j > from) return j
  }
  return -1
}

function marksFrom(attrs: string[], base: Marks): Marks {
  const m: Marks = { ...base }
  for (const a of attrs) {
    if (a in FLAGS) m[a as 'b' | 'i' | 's'] = true
    else if ((SIZES as string[]).includes(a)) m.size = a as Size
    else m.color = a as Color
  }
  return m
}

/** One line's words into styled runs. */
export function parseInline(s: string, marks: Marks = {}): Run[] {
  const out: Run[] = []
  let buf = ''
  const flush = () => { if (buf) { out.push({ text: buf, marks }); buf = '' } }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) { buf += s[++i]; continue }
    if (s.startsWith('**', i)) {
      const c = closeToken(s, i + 2, '**')
      if (c > i + 2) { flush(); out.push(...parseInline(s.slice(i + 2, c), { ...marks, b: true })); i = c + 1; continue }
    }
    if (s.startsWith('~~', i)) {
      const c = closeToken(s, i + 2, '~~')
      if (c > i + 2) { flush(); out.push(...parseInline(s.slice(i + 2, c), { ...marks, s: true })); i = c + 1; continue }
    }
    if (ch === '*' && i + 1 < s.length && s[i + 1] !== ' ' && s[i + 1] !== '*') {
      const c = closeToken(s, i + 1, '*', true)
      if (c > i + 1) { flush(); out.push(...parseInline(s.slice(i + 1, c), { ...marks, i: true })); i = c; continue }
    }
    if (ch === '{') {
      const a = attrsAt(s, i)
      const c = a ? closeBrace(s, a.start) : -1
      if (a && c > a.start) { flush(); out.push(...parseInline(s.slice(a.start, c), marksFrom(a.attrs, marks))); i = c; continue }
    }
    buf += ch
  }
  flush()
  return merge(out)
}

/** The whole text: one block per line, bullets marked. */
export function parse(text: string): Block[] {
  return (text ?? '').split('\n').map((line) => {
    const bullet = BULLET.test(line)
    return { bullet, runs: parseInline(bullet ? line.replace(BULLET, '') : line) }
  })
}

const same = (a: Marks, b: Marks) => !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && a.color === b.color && a.size === b.size

/** Neighbouring runs styled alike become one. */
export function merge(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && same(last.marks, r.marks)) last.text += r.text
    else out.push({ text: r.text, marks: { ...r.marks } })
  }
  return out
}

// --- writing

const plain = (m: Marks) => !m.b && !m.i && !m.s && !m.color && !m.size

/** Characters that would read as markup, made plain. `inBrace`: a `}` would close the group, so it is escaped too. */
function esc(t: string, inBrace: boolean): string {
  let out = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' || ch === '*') out += '\\' + ch
    else if (ch === '~' && t[i + 1] === '~') out += '\\~'
    else if (ch === '{' && attrsAt(t, i)) out += '\\{'
    else if (ch === '}' && inBrace) out += '\\}'
    else out += ch
  }
  return out
}

function writeRun(r: Run, short: boolean): string {
  const m = r.marks
  if (plain(m)) return esc(r.text, false)
  // spaces at the edges go outside the marks: "*word *" would not read back as italic
  const lead = /^\s*/.exec(r.text)![0], trail = /\s*$/.exec(r.text)![0]
  const core = r.text.slice(lead.length, r.text.length - trail.length)
  if (!core) return r.text
  const flags = (['b', 'i', 's'] as const).filter((f) => m[f])
  if (short && !m.color && !m.size && flags.length === 1) {
    const tok = { b: '**', i: '*', s: '~~' }[flags[0]]
    return lead + tok + esc(core, false) + tok + trail
  }
  const attrs = [m.color, m.size, ...flags].filter(Boolean)
  return `${lead}{${attrs.join(',')}:${esc(core, true)}}${trail}`
}

/** A run with spaces at its edges, as plain spaces around the styled words: how it will be written anyway. */
function edgesPlain(r: Run): Run[] {
  if (plain(r.marks)) return [r]
  const lead = /^\s*/.exec(r.text)![0], trail = /\s*$/.exec(r.text)![0]
  const core = r.text.slice(lead.length, r.text.length - trail.length)
  return core ? [{ text: lead, marks: {} }, { text: core, marks: r.marks }, { text: trail, marks: {} }] : [{ text: r.text, marks: {} }]
}

/** Styled runs back into one line of markup. */
export function serializeInline(runs: Run[]): string {
  // edge spaces first, so the choice of short or braced form below sees the neighbours that will be read back
  const rs = merge(runs.flatMap(edgesPlain))
  return rs.map((r, k) => {
    // the short form only between plain words: next to another styled run it could be misread
    const short = (k === 0 || plain(rs[k - 1].marks)) && (k === rs.length - 1 || plain(rs[k + 1].marks))
    return writeRun(r, short)
  }).join('')
}

/** Blocks back into the stored text. */
export function serialize(blocks: Block[]): string {
  return blocks.map((b) => {
    const line = serializeInline(b.runs)
    if (b.bullet) return '* ' + line
    return BULLET.test(line) ? '\\' + line : line                   // a plain line that would read as a bullet
  }).join('\n')
}
