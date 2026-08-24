import path from 'node:path'
import type { Edge, RelationsFile } from '@shared/types'
import { readJson, writeJson } from './files'

const EMPTY: RelationsFile = { version: 1, edges: [] }

export async function readRelations(dataDir: string): Promise<RelationsFile> {
  const filePath = path.join(dataDir, 'relations.json')
  const data = await readJson<RelationsFile>(filePath, EMPTY)
  // 简单校验 + 修正
  return {
    version: data.version ?? 1,
    edges: Array.isArray(data.edges) ? data.edges.map(normalizeEdge) : []
  }
}

function normalizeEdge(raw: Partial<Edge>): Edge {
  const rule = raw.rule === 'any_of' ? 'any_of' : 'all'
  const prerequisites = Array.isArray(raw.prerequisites)
    ? raw.prerequisites.filter((s): s is string => typeof s === 'string')
    : []
  const threshold =
    typeof raw.threshold === 'number' && raw.threshold >= 1
      ? Math.min(raw.threshold, prerequisites.length)
      : undefined
  return {
    to: String(raw.to ?? ''),
    prerequisites,
    rule,
    ...(rule === 'any_of' && threshold !== undefined ? { threshold } : {})
  }
}

/** 原子写整个 relations 文件；可选传入校验函数 */
export async function writeRelations(
  dataDir: string,
  edges: Edge[],
  validate?: (e: Edge[]) => string | null
): Promise<void> {
  if (validate) {
    const err = validate(edges)
    if (err) throw new Error(`relations validation failed: ${err}`)
  }
  const payload: RelationsFile = { version: 1, edges }
  await writeJson(path.join(dataDir, 'relations.json'), payload)
}
