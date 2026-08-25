import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/types'
import * as booksSvc from '../service/books'
import * as relSvc from '../service/relations'
import * as cfgSvc from '../service/config'
import { getDataDir, resetDataDir } from '../service/data-dir'
import { pickDataDir } from '../data/pick-dir'

export function registerIpc(): void {
  ipcMain.handle(IPC.booksList, () => booksSvc.listBooks())
  ipcMain.handle(IPC.booksGet, (_e, id: string) => booksSvc.getBook(id))
  ipcMain.handle(IPC.booksCreate, (_e, input) => booksSvc.createBook(input))
  ipcMain.handle(IPC.booksUpdate, (_e, id: string, patch) => booksSvc.updateBook(id, patch))
  ipcMain.handle(IPC.booksProgressBump, (_e, id: string, delta: number) => booksSvc.bumpProgress(id, delta))
  ipcMain.handle(IPC.booksDelete, (_e, id: string) => booksSvc.deleteBook(id))

  ipcMain.handle(IPC.relationsGet, () => relSvc.getRelations())
  ipcMain.handle(IPC.relationsSet, (_e, edges) => relSvc.setRelations(edges))

  ipcMain.handle(IPC.configGet, () => cfgSvc.getConfig())
  ipcMain.handle(IPC.configSet, (_e, patch) => cfgSvc.setConfig(patch))

  ipcMain.handle(IPC.dataPickDir, async () => {
    const picked = await pickDataDir()
    if (picked) {
      resetDataDir()
      const cfg = await cfgSvc.getConfig()
      await cfgSvc.setConfig({ ...cfg, data_dir: picked })
    }
    return picked
  })

  ipcMain.handle(IPC.dataRevealInExplorer, () => {
    shell.openPath(getDataDir())
  })
}
