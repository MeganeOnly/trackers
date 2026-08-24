import type { Config } from '@shared/types'
import { readConfig, writeConfig } from '../data/config'
import { getDataDir, resetDataDir } from './data-dir'

export async function getConfig(): Promise<Config> {
  return readConfig(getDataDir())
}

export async function setConfig(patch: Partial<Config>): Promise<Config> {
  const cur = await readConfig(getDataDir())
  const next: Config = { ...cur, ...patch, version: cur.version }
  if (patch.data_dir && patch.data_dir !== cur.data_dir) {
    resetDataDir()
  }
  await writeConfig(next)
  return next
}
