import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pickDataDir } from '../data/pick-dir'

interface AppConfig {
  version: number
  data_dir: string
}

let cached: string | null = null

async function readAppConfig(): Promise<AppConfig> {
  const p = join(app.getPath('userData'), 'config.json')
  try {
    const raw = await fs.readFile(p, 'utf8')
    const data = JSON.parse(raw)
    return { version: Number(data.version ?? 1), data_dir: String(data.data_dir ?? '') }
  } catch {
    return { version: 1, data_dir: '' }
  }
}

async function writeAppConfig(cfg: AppConfig): Promise<void> {
  const p = join(app.getPath('userData'), 'config.json')
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

async function dirExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 应用启动时调用一次：找到 / 弹出选择数据目录 */
export async function initDataDir(): Promise<string> {
  if (cached) return cached
  const cfg = await readAppConfig()
  if (cfg.data_dir && (await dirExists(cfg.data_dir))) {
    cached = cfg.data_dir
    return cached
  }
  const picked = await pickDataDir()
  if (!picked) {
    app.quit()
    return ''
  }
  await writeAppConfig({ version: 1, data_dir: picked })
  cached = picked
  return cached
}

/** IPC handler 取当前数据目录（必须先 initDataDir） */
export function getDataDir(): string {
  if (!cached) throw new Error('data dir not initialized; call initDataDir() first')
  return cached
}

/** 重置缓存（设置变更时用） */
export function resetDataDir(): void {
  cached = null
}
