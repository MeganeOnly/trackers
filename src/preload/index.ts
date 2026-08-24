import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { ElectronAPI } from '@shared/api'

const api: ElectronAPI = {
  books: {
    list: () => ipcRenderer.invoke(IPC.booksList),
    get: (id) => ipcRenderer.invoke(IPC.booksGet, id),
    create: (input) => ipcRenderer.invoke(IPC.booksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.booksUpdate, id, patch),
    delete: (id) => ipcRenderer.invoke(IPC.booksDelete, id)
  },
  relations: {
    get: () => ipcRenderer.invoke(IPC.relationsGet),
    set: (edges) => ipcRenderer.invoke(IPC.relationsSet, edges)
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (patch) => ipcRenderer.invoke(IPC.configSet, patch)
  },
  data: {
    pickDir: () => ipcRenderer.invoke(IPC.dataPickDir),
    revealInExplorer: () => ipcRenderer.invoke(IPC.dataRevealInExplorer)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error fallback for non-isolated context
  ;(window as unknown as { electron: ElectronAPI }).electron = api
}
