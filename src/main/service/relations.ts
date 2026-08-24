import type { Edge } from '@shared/types'
import { readRelations, writeRelations } from '../data/relations'
import { getDataDir } from './data-dir'

export async function getRelations(): Promise<Edge[]> {
  const data = await readRelations(getDataDir())
  return data.edges
}

export async function setRelations(edges: Edge[]): Promise<void> {
  return writeRelations(getDataDir(), edges)
}
