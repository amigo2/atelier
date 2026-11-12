// The Atelier API: diagrams saved as JSON files, one per diagram, on this machine.
import type { Doc } from './model'

export type Listing = { id: string; name: string; updated: number }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

export const api = {
  list: () => call<Listing[]>('GET', '/api/diagrams'),
  get: (id: string) => call<Doc>('GET', `/api/diagrams/${encodeURIComponent(id)}`),
  save: (doc: Doc) => call<{ saved: string }>('PUT', `/api/diagrams/${encodeURIComponent(doc.id)}`, doc),
  remove: (id: string) => call<{ deleted: string }>('DELETE', `/api/diagrams/${encodeURIComponent(id)}`),
}
