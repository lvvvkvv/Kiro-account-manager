import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [directory, version] = process.argv.slice(2)
if (!directory || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version || ''))
  throw new Error('Usage: verify-mac-updates.mjs <release-directory> <version>')
const raw = Buffer.from(
  JSON.parse(fs.readFileSync(path.join(repo, 'resources/update-public-key.json'))).publicKey,
  'base64'
)
if (raw.length !== 32) throw new Error('Invalid trusted key')
const key = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
  type: 'spki',
  format: 'der'
})
for (const arch of ['x64', 'arm64']) {
  const envelope = JSON.parse(fs.readFileSync(path.join(directory, `kiro-update-mac-${arch}.json`)))
  const payload = Buffer.from(envelope.payload, 'base64')
  if (!crypto.verify(null, payload, key, Buffer.from(envelope.signature, 'base64')))
    throw new Error(`Invalid signature: ${arch}`)
  const manifest = JSON.parse(payload.toString('utf8'))
  const expected = `kiro-account-manager-${version}-${arch}-mac.zip`
  if (
    manifest.schema !== 1 ||
    manifest.version !== version ||
    manifest.arch !== arch ||
    manifest.file !== expected ||
    manifest.bundleId !== 'com.kiro.account-manager' ||
    manifest.appName !== 'Kiro Account Manager.app'
  )
    throw new Error(`Release metadata mismatch: ${arch}`)
  const archive = path.join(directory, expected)
  if (fs.statSync(archive).size !== manifest.size) throw new Error(`Archive size mismatch: ${arch}`)
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
  if (hash.digest('hex') !== manifest.sha256) throw new Error(`Archive digest mismatch: ${arch}`)
  console.log(`Verified signature, version and archive: ${expected}`)
}
