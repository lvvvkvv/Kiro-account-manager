import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('Native updater must be built on macOS')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(repo, 'out/native-updater')
fs.mkdirSync(output, { recursive: true })
const key = JSON.parse(
  fs.readFileSync(path.join(repo, 'resources/update-public-key.json'))
).publicKey
if (Buffer.from(key, 'base64').length !== 32) throw new Error('Invalid update public key')
const generated = path.join(output, 'TrustedKey.swift')
fs.writeFileSync(generated, `let trustedUpdatePublicKey = "${key}"\n`)
for (const arch of ['arm64', 'x86_64']) {
  execFileSync(
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-O',
      '-runtime-compatibility-version',
      'none',
      '-disable-autolinking-runtime-compatibility',
      '-disable-autolinking-runtime-compatibility-concurrency',
      '-target',
      `${arch}-apple-macos11.0`,
      '-o',
      path.join(output, `updater-${arch}`),
      path.join(repo, 'build/macos-updater/main.swift'),
      generated
    ],
    { stdio: 'inherit' }
  )
}
execFileSync(
  '/usr/bin/lipo',
  [
    '-create',
    path.join(output, 'updater-arm64'),
    path.join(output, 'updater-x86_64'),
    '-output',
    path.join(output, 'kiro-updater')
  ],
  { stdio: 'inherit' }
)
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path.join(output, 'kiro-updater')], {
  stdio: 'inherit'
})
