import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [privatePath, publicPath] = process.argv.slice(2)
if (!privatePath || !publicPath)
  throw new Error(
    'Usage: node scripts/create-update-key.mjs <private-key-outside-repo.pem> <public-key.json>'
  )
if (fs.existsSync(privatePath) || fs.existsSync(publicPath))
  throw new Error('Refusing to overwrite an existing update signing key')
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 })
fs.mkdirSync(path.dirname(publicPath), { recursive: true })
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
  mode: 0o600,
  flag: 'wx'
})
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
fs.writeFileSync(
  publicPath,
  JSON.stringify({ publicKey: raw.toString('base64') }, null, 2) + '\n',
  { flag: 'wx' }
)
console.log('Created dedicated update signing key; private key was not printed.')
