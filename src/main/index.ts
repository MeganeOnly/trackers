import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { pickDataDir } from './data/pick-dir'

/**
 * 数据目录的生命周期：
 * 1. 每次启动读 <userData>/config.json 里的 data_dir
 * 2. 找不到 / 无效 → 弹原生目录选择器，让用户选
 * 3. 选定后写回 userData config.json
 *
 * 这样 data_dir 可以随意搬动、可以被多设备同步，
 * 而 userData 里的"指针"始终在固定位置。
 */
let cachedDataDir: string | null = null

interface AppConfig {
  version: number
  data_dir: string
}

const EMPTY_CONFIG: AppConfig = { version: 1, data_dir: '' }

async function readAppConfig(): Promise<AppConfig> {
  const p = join(app.getPath('userData'), 'config.json')
  try {
    const raw = await fs.readFile(p, 'utf8')
    const data = JSON.parse(raw)
    return {
      version: Number(data.version ?? 1),
      data_dir: String(data.data_dir ?? '')
    }
  } catch {
    return EMPTY_CONFIG
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

async function resolveDataDir(): Promise<string> {
  if (cachedDataDir) return cachedDataDir

  const cfg = await readAppConfig()
  if (cfg.data_dir && (await dirExists(cfg.data_dir))) {
    cachedDataDir = cfg.data_dir
    return cachedDataDir
  }

  // 首启 / 失效 → 让用户选
  const picked = await pickDataDir()
  if (!picked) {
    // 取消则直接退出
    app.quit()
    return ''
  }

  await writeAppConfig({ version: 1, data_dir: picked })
  cachedDataDir = picked
  return cachedDataDir
}

async function createWindow(): Promise<void> {
  const dataDir = await resolveDataDir()
  if (!dataDir) return

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: '书架追踪',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
