import type { ElectronAPI } from '@shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
