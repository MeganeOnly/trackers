import path from 'node:path'
import type { Config } from '@shared/types'
import { ensureDir, readJson, writeJson } from './files'

const DEFAULT: Config = {
  version: 1,
  data_dir: '',
  language: 'zh-CN',
  default_mode: 'clean'
}

const CONFIG_FILENAME = 'config.json'

export async function readConfig(dataDir: string): Promise<Config> {
  const filePath = path.join(dataDir, CONFIG_FILENAME)
  const data = await readJson<Config>(filePath, DEFAULT)
  return {
    version: data.version ?? 1,
    data_dir: String(data.data_dir ?? ''),
    language: data.language === 'zh-CN' ? 'zh-CN' : 'zh-CN',
    default_mode: data.default_mode === 'edit' ? 'edit' : 'clean'
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await ensureDir(config.data_dir)
  await writeJson(path.join(config.data_dir, CONFIG_FILENAME), config)
}

/** 数据目录布局（约定） */
export const PATHS = {
  booksDir: (dataDir: string) => path.join(dataDir, 'books'),
  relations: (dataDir: string) => path.join(dataDir, 'relations.json'),
  config: (dataDir: string) => path.join(dataDir, 'config.json')
}
