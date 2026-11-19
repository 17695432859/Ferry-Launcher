import type { FerryApi } from '@shared/ipc'

declare global {
  interface Window {
    ferry: FerryApi
  }
}

export {}
