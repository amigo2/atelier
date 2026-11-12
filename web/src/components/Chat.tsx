// The AI chat, beside the canvas. Each message goes with the diagram and what's selected ("make this amber");
// the AI's change comes back as one step, so Undo (here or ⌘Z) takes it back whole.
import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { api, type AiStatus, type ChatTurn } from '../api'
import { fromDoc, toDoc } from '../model'
import { useApp } from '../store'

type Msg = { who: 'me' | 'ai' | 'note'; text: string; undo?: boolean }

const EXAMPLES = [
  'Draw a RAG pipeline: question, embed, retrieve, generate, verify, cited answer',
  'Add a title and a section label above the cards',
  'Group these in a box called AWS · eu-west-1',
]

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()
  const nSel = useApp((s) => s.nodes.filter((n) => n.selected).length)

  useEffect(() => { api.ai().then(setAi).catch(() => setAi(null)) }, [])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [msgs, busy])

  async function send(raw?: string) {
    const t = (raw ?? text).trim()
    if (!t || busy) return
    setText('')
    const chat: ChatTurn[] = msgs.filter((m) => m.who !== 'note').map((m) => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text }))
    setMsgs((m) => [...m.map((x) => ({ ...x, undo: false })), { who: 'me', text: t }])
    setBusy(true)
    try {
      const s = useApp.getState()
      const before = s.nodes.length
      const r = await api.assist({ doc: toDoc(s.id, s.name, s.nodes, s.edges, s.frame), selected: s.nodes.filter((n) => n.selected).map((n) => n.id), text: t, chat })
      const changed = r.steps.length > 0
      if (changed) {
        s.replace(fromDoc(r.doc))
        if (useApp.getState().nodes.length !== before) setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 30)
      }
      setMsgs((m) => [
        ...m,
        ...(r.fallback ? [{ who: 'note' as const, text: "The live model didn't answer: scripted reply" }] : []),
        ...(changed ? [{ who: 'note' as const, text: r.steps.join(' · '), undo: true }] : []),
        { who: 'ai', text: r.reply },
      ])
    } catch (e) {
      setMsgs((m) => [...m, { who: 'ai', text: `That didn't work: ${(e as Error).message ?? e}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="chat" aria-label="AI chat">
      <div className="chat-h"><b>✦ AI</b><span className="grow" />
        {msgs.length > 0 && <button className="link" onClick={() => setMsgs([])}>Start again</button>}</div>
      <div className="chat-log" ref={log}>
        {!msgs.length && (
          <div className="msg ai">
            Tell me what to draw, or what to change. Select shapes first to talk about them ("make these teal").
            <div className="ex">{EXAMPLES.map((x) => <button key={x} onClick={() => send(x)}>{x}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            {m.text}
            {m.undo && <button className="link undo" onClick={() => { useApp.getState().undo(); setMsgs((x) => x.map((y, j) => (j === i ? { ...y, undo: false, text: `${y.text} (undone)` } : y))) }}>Undo</button>}
          </div>
        ))}
        {busy && <div className="msg ai"><span className="spin" /> Drawing…</div>}
      </div>
      <div className="chat-in">
        {nSel > 0 && <div className="sel-chip">{nSel} selected: "this" / "these" means {nSel > 1 ? 'them' : 'it'}</div>}
        <textarea value={text} rows={3} placeholder="Describe a diagram, or a change to this one" disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <div className="chat-f">
          <span className={`dot ${ai?.live ? 'on' : ''}`} />{ai?.live ? ai.model?.replace('anthropic/', '').replace(/-/g, ' ') : 'scripted'} · Enter sends
          <span className="grow" />
          <button className="primary" disabled={!text.trim() || busy} onClick={() => send()}>Send</button>
        </div>
      </div>
    </section>
  )
}
