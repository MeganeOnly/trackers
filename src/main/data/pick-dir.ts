import { dialog, BrowserWindow } from 'electron'

/** 弹原生目录选择器，返回用户选择的绝对路径；取消则返回 null */
export async function pickDataDir(parent?: BrowserWindow): Promise<string | null> {
  const result = parent
    ? await dialog.showOpenDialog(parent, {
        title: '选择数据目录',
        properties: ['openDirectory', 'createDirectory']
      })
    : await dialog.showOpenDialog({
        title: '选择数据目录',
        properties: ['openDirectory', 'createDirectory']
      })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
