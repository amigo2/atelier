// The icon set: Lucide, bundled, not fetched.
//
// Local on purpose. Icons pulled off the web come in five different stroke weights with five different
// licences, and a deck built from them looks assembled rather than designed. Lucide is ~1,500 icons drawn
// to one grid with one stroke, ISC licensed, and it is the same family the Manahata frontend uses — so a
// diagram and the product it describes look related.
import * as lucide from 'lucide-react'
import type { ComponentType } from 'react'

type IconComponent = ComponentType<{ size?: number | string; strokeWidth?: number; className?: string }>

// Lucide exports its icons in PascalCase alongside a few helpers; the icons are the ones whose name starts
// with a capital and that are not the aliases or the `Icon`/`createLucideIcon` machinery.
// A forwardRef component is an **object**, not a function — checking for a function here found nothing at
// all and every icon silently vanished. `$$typeof` is what actually marks a React element type.
const isComponent = (v: unknown) =>
  typeof v === 'function' || (typeof v === 'object' && v !== null && '$$typeof' in (v as object))

// Lucide exports every icon twice, as `Sparkles` and `SparklesIcon`. Taking the short name keeps one of
// each and makes the names match what Lucide's own site calls them.
const ALL = Object.entries(lucide as unknown as Record<string, unknown>)
  .filter(([k, v]) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !k.endsWith('Icon') && isComponent(v))
  .sort(([a], [b]) => a.localeCompare(b)) as [string, IconComponent][]

const BY_NAME = new Map(ALL.map(([k, v]) => [k.toLowerCase(), v]))

/** kebab-case, which is how Lucide names icons publicly and how a person would type one. */
export const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

export function iconByName(name?: string): IconComponent | null {
  if (!name) return null
  const key = name.trim().toLowerCase().replace(/[-_\s]+/g, '')
  return BY_NAME.get(key) ?? null
}

/** Icons whose name contains the words typed, best match first. For the picker and for the AI's tool. */
export function findIcons(query: string, limit = 60): string[] {
  const q = query.trim().toLowerCase().replace(/[-_\s]+/g, '')
  if (!q) return ALL.slice(0, limit).map(([k]) => kebab(k))
  const hits: [string, number][] = []
  for (const [k] of ALL) {
    const flat = k.toLowerCase()
    const at = flat.indexOf(q)
    if (at === -1) continue
    // an exact name first, then one that starts with it, then the rest
    hits.push([kebab(k), flat === q ? 0 : at === 0 ? 1 : 2 + at])
  }
  return hits.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).slice(0, limit).map(([k]) => k)
}

export const ICON_COUNT = ALL.length
