import { contextBridge } from 'electron'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      // Phase 3 将注入：books / relations / config IPC
    })
  } catch (error) {
    console.error(error)
  }
}
