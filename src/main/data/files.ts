import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 确保目录存在 */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/** 原子写文件：先写 .tmp，再 rename，避免半截文件 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, filePath)
}

/** 读 JSON，文件不存在则返回 fallback */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

/** 写 JSON（原子） */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2) + '\n')
}
