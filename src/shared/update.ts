export interface AppUpdateInfo {
  version: string
  notes: string
  publishedAt?: string
  installable: boolean
}

export interface AppUpdateState {
  revision: number
  currentVersion: string
  supported: boolean
  unsupportedReason?: string
  enabled: boolean
  checking: boolean
  downloading: boolean
  installing: boolean
  available: AppUpdateInfo | null
  ready: AppUpdateInfo | null
  progress: number | null
  error: string | null
  recovery: string | null
  routingInUse: boolean
  dismissedVersion: string | null
}

export interface SignedMacManifest {
  schema: 1
  version: string
  arch: 'arm64' | 'x64'
  bundleId: string
  appName: string
  file: string
  sha256: string
  size: number
}

export interface UpdateEnvelope {
  payload: string
  signature: string
}
