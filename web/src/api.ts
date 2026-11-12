// The Atelier API: diagrams saved as JSON files, one per diagram, on this machine.
import type { Doc } from './model'

export type Listing = { id: string; name: string; updated: number; elements: number; framed: boolean }
export type AiStatus = { live: boolean; model: string | null; provider: string | null }
export type AssistReply = { reply: string; doc: Doc; steps: string[]; live: boolean; fallback?: boolean }
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

export const api = {
  list: () => call<Listing[]>('GET', '/api/diagrams'),
  get: (id: string) => call<Doc>('GET', `/api/diagrams/${encodeURIComponent(id)}`),
  save: (doc: Doc) => call<{ saved: string }>('PUT', `/api/diagrams/${encodeURIComponent(doc.id)}`, doc),
  ai: () => call<AiStatus>('GET', '/api/ai'),
  assist: (b: { doc: Doc; selected: string[]; text: string; chat: ChatTurn[] }) => call<AssistReply>('POST', '/api/assist', b),
  remove: (id: string) => call<{ deleted: string }>('DELETE', `/api/diagrams/${encodeURIComponent(id)}`),
}
