import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.resolve(process.argv[2] || path.join(repo, 'dist'))
const version =
  process.argv[3] || JSON.parse(fs.readFileSync(path.join(repo, 'package.json'))).version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  throw new Error('Stable version required')
const pem =
  process.env.KIRO_UPDATE_PRIVATE_KEY ||
  (process.env.KIRO_UPDATE_PRIVATE_KEY_FILE &&
    fs.readFileSync(process.env.KIRO_UPDATE_PRIVATE_KEY_FILE))
if (!pem)
  throw new Error(
    'KIRO_UPDATE_PRIVATE_KEY or KIRO_UPDATE_PRIVATE_KEY_FILE is required; refusing unsigned release'
  )
const privateKey = crypto.createPrivateKey(pem)
const publicKey = crypto
  .createPublicKey(privateKey)
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('base64')
const trusted = JSON.parse(
  fs.readFileSync(path.join(repo, 'resources/update-public-key.json'))
).publicKey
if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey !== trusted)
  throw new Error('Signing key does not match the public key shipped in the app')
for (const arch of ['x64', 'arm64']) {
  const file = `kiro-account-manager-${version}-${arch}-mac.zip`
  const archive = path.join(directory, file)
  const size = fs.statSync(archive).size
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
  const manifest = {
    schema: 1,
    version,
    arch,
    bundleId: 'com.kiro.account-manager',
    appName: 'Kiro Account Manager.app',
    file,
    size,
    sha256: hash.digest('hex')
  }
  const payload = Buffer.from(JSON.stringify(manifest))
  const envelope = {
    payload: payload.toString('base64'),
    signature: crypto.sign(null, payload, privateKey).toString('base64')
  }
  fs.writeFileSync(
    path.join(directory, `kiro-update-mac-${arch}.json`),
    JSON.stringify(envelope) + '\n'
  )
  console.log(`Signed ${file}`)
}
