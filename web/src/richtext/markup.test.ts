// Text must survive being edited. Reading markup and writing it back gives the same words with the same styles,
// and writing what was written changes nothing more: otherwise text slowly corrupts with every edit.
import { describe, expect, test } from 'vitest'
import { merge, parse, parseInline, serialize, type Block, type Run } from './markup'

const roundTrip = (x: string) => serialize(parse(x))
// A space at the edge of a styled phrase is written outside its marks ("*word *" would not read back as italic):
// nothing visible changes, so styles are compared with edge spaces counted as plain.
const edges = (r: Run): Run[] => {
  const lead = /^\s*/.exec(r.text)![0], trail = /\s*$/.exec(r.text)![0], core = r.text.slice(lead.length, r.text.length - trail.length)
  return core ? [{ text: lead, marks: {} }, { text: core, marks: r.marks }, { text: trail, marks: {} }] : [{ text: r.text, marks: {} }]
}
const styles = (bs: Block[]) => bs.map((b) => ({ bullet: b.bullet, runs: merge(b.runs.flatMap(edges)).map((r) => [r.text, r.marks]) }))

/** The heart of it: same styled words after a round trip, and a second round trip changes nothing. */
function survives(x: string) {
  const once = roundTrip(x)
  expect(styles(parse(once))).toEqual(styles(parse(x)))
  expect(roundTrip(once)).toBe(once)
}

describe('existing text is left exactly as it was', () => {
  test.each([
    'api waits for redis forever',
    'Why it fails: **api** cannot see redis',
    'a *quiet* word and ~~a struck one~~',
    'Why it fails: {red:api} cannot see redis',
    'Why it fails:\n* api is on edge_net only\n* redis is on internal_net\nSo DNS fails.',
    '(FastAPI :8000)\n1 JSON batch (20 items, ~5 KB)\n[P2 ~30MB]',
    'edge_net and internal_net',
    '',
  ])('%j', (x) => expect(roundTrip(x)).toBe(x))
})

describe('styles read correctly', () => {
  test('bold, italic, strike, colour', () => {
    expect(parseInline('**b** *i* ~~s~~ {red:r}').filter((r) => r.text.trim()).map((r) => [r.text, r.marks]))
      .toEqual([['b', { b: true }], ['i', { i: true }], ['s', { s: true }], ['r', { color: 'red' }]])
  })
  test('marks inside colour, and colour inside bold', () => {
    expect(parseInline('{red:**x**}')).toEqual([{ text: 'x', marks: { color: 'red', b: true } }])
    expect(parseInline('**{blue:x}**')).toEqual([{ text: 'x', marks: { b: true, color: 'blue' } }])
  })
  test('the braced form carries everything at once', () => {
    expect(parseInline('{red,large,b,i:all}')).toEqual([{ text: 'all', marks: { color: 'red', size: 'large', b: true, i: true } }])
  })
  test('a lone star, a sum and an unknown brace stay as they are', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4', marks: {} }])
    expect(parseInline('{id: 3}')).toEqual([{ text: '{id: 3}', marks: {} }])
    expect(parseInline('**not closed')).toEqual([{ text: '**not closed', marks: {} }])
  })
})

describe('edited text survives being written and read again', () => {
  test.each([
    '**bold *and italic* inside**',
    '{red,b,i:bold italic red}',
    '{large:Big} and {small:tiny} and {huge,red:HUGE}',
    '**a***b*',                                   // bold then italic, touching
    'plain \\*star\\* and \\{red:not a colour}',  // literal markup characters
    'a \\ backslash',
    '- not a bullet\n\\* not one either',
    '* bullet one\n* {green:bullet two}\n\n* after a blank line',
    '   leading spaces and  double  gaps  ',
    '{red:a}{blue:b}',                            // two colours touching
    '~~struck **and bold**~~',
    '[ P1 ~40MB ] → flat green Stats ✅',
  ])('%j', survives)
})

describe('blocks written from scratch read back the same', () => {
  test('styles that touch, spaces at the edges, markup characters in the words', () => {
    const blocks: Block[] = [
      { bullet: false, runs: [{ text: 'a', marks: { b: true } }, { text: 'b', marks: { i: true } }, { text: ' c ', marks: { s: true } }, { text: '!', marks: {} }] },
      { bullet: true, runs: [{ text: '2*3 {red:x} ~~y', marks: {} }, { text: 'big}', marks: { size: 'huge', color: 'teal' } }] },
      { bullet: false, runs: [{ text: '* looks like a bullet', marks: {} }] },
    ]
    const text = serialize(blocks)
    expect(styles(parse(text))).toEqual(styles(blocks))
  })
})

// --- through the editor's document and back
import { fromDoc, toDoc } from './doc'

describe('markup → editor document → markup', () => {
  test.each([
    'api waits for redis forever',
    'Why it fails: **api** cannot see redis',
    'Why it fails:\n* api is on edge_net only\n* redis is on internal_net\nSo DNS fails.',
    '{red,large,b,i:all of it} and {small:fine print}',
    '* one\n* two\n\n* three, after a blank line',
    '',
  ])('%j comes back unchanged', (x) => expect(serialize(fromDoc(toDoc(parse(x))))).toBe(serialize(parse(x))))

  test('a bullet list is one list, and lines around it are paragraphs', () => {
    const d = toDoc(parse('before\n* a\n* b\nafter'))
    expect(d.content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
    expect(d.content![1].content!.length).toBe(2)
  })
  test('colour and size travel as marks with a name', () => {
    const t = toDoc(parse('{teal,huge:x}')).content![0].content![0]
    expect(t.marks).toEqual([{ type: 'colour', attrs: { name: 'teal' } }, { type: 'size', attrs: { name: 'huge' } }])
  })
  test('a line break typed in the editor becomes a new line', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }
    expect(serialize(fromDoc(doc))).toBe('a\nb')
  })
  test('an empty editor is an empty text', () => {
    expect(serialize(fromDoc({ type: 'doc', content: [{ type: 'paragraph' }] }))).toBe('')
  })
})
