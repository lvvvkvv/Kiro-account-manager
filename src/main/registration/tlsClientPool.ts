import { ModuleClient } from 'tlsclientwrapper'
import { withDeadline } from './async'

interface AcquireOpts {
  customLibraryPath?: string
  customLibraryDownloadPath?: string
}

let shared: ModuleClient | null = null
let openPromise: Promise<ModuleClient> | null = null
let stopped = false

async function terminate(client: ModuleClient): Promise<void> {
  try {
    await withDeadline(() => client.terminate(), 5000)
  } catch {
    /* bounded process cleanup */
  }
}

/** Share the native worker pool, keeping SessionClient instances registration-local. */
export async function acquireModuleClient(opts: AcquireOpts): Promise<ModuleClient> {
  if (stopped) throw new Error('TLS 共享池已关闭')
  if (shared) return shared
  if (!openPromise) {
    openPromise = (async () => {
      const client = new ModuleClient(opts)
      try {
        await client.open()
        if (stopped) throw new Error('TLS 共享池已关闭')
        shared = client
        return client
      } catch (error) {
        await terminate(client)
        throw error
      }
    })()
    void openPromise
      .finally(() => {
        openPromise = null
      })
      .catch(() => {})
  }
  return openPromise
}

export async function shutdownTlsClientPool(): Promise<void> {
  stopped = true
  const client = shared
  shared = null
  if (client) await terminate(client)
  // A pending open owns its late cleanup; never resurrect shared after shutdown.
  if (openPromise) {
    try {
      await withDeadline(() => openPromise!, 5000)
    } catch {
      /* late cleanup remains attached */
    }
  }
}
