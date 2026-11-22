// The rich editor in the details panel: words look like what they will be, and are stored as markup underneath
// (markup.ts), so the canvas, the PDF, the AI and every saved diagram keep reading the same text.
import { EditorContent, Extension, Mark, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { COLORS, PALETTE, type Color } from '../model'
import { SIZE_EM } from '../components/RichText'
import { fromDoc, toDoc } from './doc'
import { parse, serialize, type Size } from './markup'

// colour and size: one mark each, carrying a name from the palette or the size scale
const Colour = Mark.create({
  name: 'colour',
  addAttributes: () => ({ name: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-colour]', getAttrs: (el) => ({ name: (el as HTMLElement).dataset.colour }) }],
  renderHTML: ({ mark }) => ['span', { 'data-colour': mark.attrs.name, style: `color: ${PALETTE[mark.attrs.name as Color]?.fg}` }, 0],
})
const SizeMark = Mark.create({
  name: 'size',
  addAttributes: () => ({ name: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-size]', getAttrs: (el) => ({ name: (el as HTMLElement).dataset.size }) }],
  renderHTML: ({ mark }) => ['span', { 'data-size': mark.attrs.name, style: `font-size: ${SIZE_EM[mark.attrs.name as Size] ?? 1}em` }, 0],
})
// the same strikethrough key as on the canvas
const StrikeKey = Extension.create({
  name: 'strikeKey',
  addKeyboardShortcuts() { return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() } },
})

const SIZE_STEPS: { label: string; size: Size | null; title: string }[] = [
  { label: 'S', size: 'small', title: 'Small' }, { label: 'M', size: null, title: 'Normal size' },
  { label: 'L', size: 'large', title: 'Large' }, { label: 'XL', size: 'huge', title: 'Huge' },
]

export function RichEditor({ value, onChange, onFocus, label, minRows = 2 }: {
  value: string; onChange: (v: string) => void; onFocus?: () => void; label: string; minRows?: number
}) {
  // the text this editor last wrote: a value that differs came from somewhere else (the canvas, undo, the AI)
  const last = useRef(value)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, orderedList: false,
        horizontalRule: false, underline: false, link: false, trailingNode: false, dropcursor: false }),
      Colour, SizeMark, StrikeKey,
    ],
    content: toDoc(parse(value)),
    editorProps: { attributes: { 'aria-label': label, class: 'rte-text', style: `min-height: ${minRows * 1.45}em` } },
    onUpdate: ({ editor }) => {
      const v = serialize(fromDoc(editor.getJSON()))
      if (v === last.current) return
      last.current = v
      onChange(v)
    },
    onFocus: () => onFocus?.(),
  })

  useEffect(() => {
    if (!editor || value === last.current) return
    last.current = value
    editor.commands.setContent(toDoc(parse(value)), { emitUpdate: false })
  }, [editor, value])

  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      b: e.isActive('bold'), i: e.isActive('italic'), s: e.isActive('strike'), list: e.isActive('bulletList'),
      colour: (e.getAttributes('colour').name as Color | undefined) ?? null, size: (e.getAttributes('size').name as Size | undefined) ?? null,
    } : null,
  })
  if (!editor || !on) return null

  const run = (f: () => void) => (ev: React.MouseEvent) => { ev.preventDefault(); f() }
  const chain = () => editor.chain().focus()
  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label={`Format ${label}`}>
        <button className={on.b ? 'on' : ''} aria-pressed={on.b} onMouseDown={run(() => chain().toggleBold().run())} title="Bold (⌘B)"><b>B</b></button>
        <button className={on.i ? 'on' : ''} aria-pressed={on.i} onMouseDown={run(() => chain().toggleItalic().run())} title="Italic (⌘I)"><i>I</i></button>
        <button className={on.s ? 'on' : ''} aria-pressed={on.s} onMouseDown={run(() => chain().toggleStrike().run())} title="Strikethrough (⌘⇧X)"><s>S</s></button>
        <button className={on.list ? 'on' : ''} aria-pressed={on.list} onMouseDown={run(() => chain().toggleBulletList().run())} title="Bullet points (or start a line with * )">•</button>
        <span className="rte-sep" />
        {SIZE_STEPS.map((z) => (
          <button key={z.label} className={on.size === z.size ? 'on' : ''} aria-pressed={on.size === z.size} title={z.title}
            onMouseDown={run(() => (z.size ? chain().setMark('size', { name: z.size }).run() : chain().unsetMark('size').run()))}>{z.label}</button>
        ))}
        <span className="rte-sep" />
        {COLORS.map((c) => (
          <button key={c} className={`rte-sw ${on.colour === c ? 'on' : ''}`} aria-pressed={on.colour === c} aria-label={`Colour ${c}`} title={on.colour === c ? `${c} (click again to remove)` : c}
            onMouseDown={run(() => (on.colour === c ? chain().unsetMark('colour').run() : chain().setMark('colour', { name: c }).run()))}>
            <i style={{ background: PALETTE[c].fg }} />
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
