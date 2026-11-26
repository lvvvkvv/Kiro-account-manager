import { createPublicKey, verify } from 'node:crypto'
import type { SignedMacManifest, UpdateEnvelope } from '../../shared/update'

export const UPDATE_REPO = 'lvvvkvv/Kiro-account-manager'
export const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`
export const APP_BUNDLE_ID = 'com.kiro.account-manager'

// Stable releases only. Reject ambiguous versions, unsafe path segments and prereleases.
export function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Invalid stable version')
  const parts = version.split('.').map(Number)
  if (parts.some((value) => !Number.isSafeInteger(value))) throw new Error('Invalid version number')
  return parts
}

export function newerThan(next: string, current: string): boolean {
  const left = versionParts(next)
  const right = versionParts(current)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i]
  }
  return false
}

export function verifyMacManifest(
  envelope: UpdateEnvelope,
  publicKeyRaw: string,
  expectedVersion: string,
  arch: string
): SignedMacManifest {
  if (
    typeof envelope?.payload !== 'string' ||
    typeof envelope.signature !== 'string' ||
    envelope.payload.length > 16384
  ) {
    throw new Error('Invalid update signature envelope')
  }
  const payload = Buffer.from(envelope.payload, 'base64')
  const raw = Buffer.from(publicKeyRaw, 'base64')
  if (raw.length !== 32) throw new Error('Invalid update public key')
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki'
  })
  if (!verify(null, payload, key, Buffer.from(envelope.signature, 'base64')))
    throw new Error('更新包签名无效 / Invalid update signature')
  const manifest = JSON.parse(payload.toString('utf8')) as SignedMacManifest
  versionParts(manifest.version)
  if (
    manifest.schema !== 1 ||
    manifest.version !== expectedVersion ||
    manifest.arch !== arch ||
    !['arm64', 'x64'].includes(manifest.arch) ||
    manifest.bundleId !== APP_BUNDLE_ID ||
    manifest.appName !== 'Kiro Account Manager.app' ||
    manifest.file !== `kiro-account-manager-${manifest.version}-${arch}-mac.zip` ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0 ||
    manifest.size > 2 * 1024 ** 3
  ) {
    throw new Error('更新包信息不匹配 / Update metadata mismatch')
  }
  return manifest
}
