// Your diagrams: open one, rename it, duplicate it (save as), delete it, download it as a file to keep anywhere,
// or import one from a file. Everything is also saved as you go; this is where you find and manage it.
import { useEffect, useRef, useState } from 'react'
import { api, type Listing } from '../api'
import { newId, type Doc } from '../model'
import { useApp } from '../store'

export function OpenDialog({ close, open }: { close: () => void; open: (id: string) => void }) {
  const [list, setList] = useState<Listing[] | null>(null)
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const mdFile = useRef<HTMLInputElement>(null)
  const current = useApp((s) => s.id)

  const reload = () => api.list().then(setList).catch((e) => setErr(String(e.message ?? e)))
  useEffect(() => { reload() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !renaming) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, renaming])

  const act = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); await reload() } catch (e) { setErr(String((e as Error).message ?? e)) } }
  const rename = (d: Listing, name: string) => act(async () => {
    const doc = await api.get(d.id)
    await api.save({ ...doc, name: name.trim() || doc.name })
    if (d.id === current) useApp.setState({ name: name.trim() || doc.name })
    setRenaming(null)
  })
  const duplicate = (d: Listing) => act(async () => {
    const doc = await api.get(d.id)
    await api.save({ ...doc, id: newId('d'), name: uniqueName(`${doc.name} copy`, list ?? []) })
  })
  const remove = (d: Listing) => act(async () => {
    await api.remove(d.id)
    setDeleting(null)
    if (d.id === current) { useApp.getState().load(newId('d'), uniqueName('Untitled', list ?? []), { nodes: [], edges: [] }); localStorage.removeItem('atelier.last') }
  })
  // Imported, then saved and opened — so an import that came out wrong is thrown away by not keeping it,
  // and never lands on top of something already there.
  const importMd = (f: File) => act(async () => {
    const text = await f.text()
    const name = uniqueName(f.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported', list ?? [])
    const doc = await api.importMarkdown({ markdown: text, name, id: newId('d') })
    await api.save(doc)
    open(doc.id)
    if (doc.overflow?.length) {
      setErr(`Imported. ${doc.overflow.length} page${doc.overflow.length > 1 ? 's run' : ' runs'} past the bottom and want tidying: ${doc.overflow.join(', ')}.`)
    }
  })

  const download = async (d: Listing) => {
    const doc = await api.get(d.id)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }))
    a.download = `${doc.name.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'diagram'}.atelier.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importFile = (f: File) => act(async () => {
    const doc = JSON.parse(await f.text()) as Doc
    if (!Array.isArray(doc.elements) || !Array.isArray(doc.arrows)) throw new Error(`${f.name} isn't an Atelier diagram`)
    const id = newId('d')
    await api.save({ ...doc, id, name: uniqueName(doc.name || f.name.replace(/\.atelier\.json$|\.json$/, ''), list ?? []) })
    open(id)
  })

  const shown = (list ?? []).filter((d) => d.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="dialog" role="dialog" aria-label="Your diagrams">
        <div className="dlg-h">
          <h2>Your diagrams</h2>
          <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button onClick={() => file.current?.click()} title="Open a .atelier.json file from anywhere">Import file…</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
          <button onClick={() => mdFile.current?.click()} title="A markdown deck as pages: one page per --- separator, with its tables and lists">Import markdown…</button>
          <input ref={mdFile} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importMd(f); e.target.value = '' }} />
          <button className="x" onClick={close} aria-label="Close">✕</button>
        </div>
        {err && <p className="err">{err}</p>}
        <div className="dlg-list">
          {list === null && <p className="faint">Loading…</p>}
          {list && !shown.length && <p className="faint">{list.length ? 'Nothing matches.' : 'No saved diagrams yet. They save as you draw.'}</p>}
          {shown.map((d) => (
            <div key={d.id} className={`dlg-row ${d.id === current ? 'cur' : ''}`}>
              {renaming === d.id ? (
                <input className="rn" defaultValue={d.name} autoFocus aria-label="New name"
                  onKeyDown={(e) => { if (e.key === 'Enter') rename(d, e.currentTarget.value); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) } }}
                  onBlur={(e) => rename(d, e.currentTarget.value)} />
              ) : (
                <button className="dlg-name" onClick={() => open(d.id)} title="Open">
                  <b>{d.name}</b>{d.id === current && <em>open now</em>}
                  <span>{d.elements} shape{d.elements === 1 ? '' : 's'}{d.pages ? ` · ${d.pages} page${d.pages === 1 ? '' : 's'}` : ''} · {new Date(d.updated * 1000).toLocaleString()}</span>
                </button>
              )}
              {deleting === d.id ? (
                <span className="confirm">Delete “{d.name}”? <button className="bad" onClick={() => remove(d)}>Delete</button><button onClick={() => setDeleting(null)}>Keep</button></span>
              ) : (
                <span className="acts">
                  <button onClick={() => setRenaming(d.id)}>Rename</button>
                  <button onClick={() => duplicate(d)} title="Save a copy under a new name">Duplicate</button>
                  <button onClick={() => download(d)} title="Download as a .atelier.json file, to keep anywhere">Download</button>
                  <button className="bad" onClick={() => setDeleting(d.id)}>Delete</button>
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="dlg-f faint">Saved as you draw, in atelier/data on this machine. Download keeps a copy anywhere; Import brings one back.</p>
      </div>
    </div>
  )
}

export function uniqueName(base: string, list: { name: string }[]) {
  const taken = new Set(list.map((d) => d.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}
