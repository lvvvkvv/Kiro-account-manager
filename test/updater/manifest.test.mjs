import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: ['src/main/updater/manifest.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const { verifyMacManifest, newerThan } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
)
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
const base = {
  schema: 1,
  version: '1.8.0',
  arch: 'arm64',
  bundleId: 'com.kiro.account-manager',
  appName: 'Kiro Account Manager.app',
  file: 'kiro-account-manager-1.8.0-arm64-mac.zip',
  sha256: 'a'.repeat(64),
  size: 123
}
function sign(value) {
  const bytes = Buffer.from(JSON.stringify(value))
  return {
    payload: bytes.toString('base64'),
    signature: crypto.sign(null, bytes, privateKey).toString('base64')
  }
}
test('accepts the correct signed release only', () => {
  assert.deepEqual(verifyMacManifest(sign(base), raw, '1.8.0', 'arm64'), base)
  const envelope = sign(base)
  envelope.payload = Buffer.from(JSON.stringify({ ...base, size: 456 })).toString('base64')
  assert.throws(() => verifyMacManifest(envelope, raw, '1.8.0', 'arm64'), /signature/)
  assert.throws(
    () =>
      verifyMacManifest(sign(base), crypto.randomBytes(32).toString('base64'), '1.8.0', 'arm64'),
    /signature/
  )
})
test('rejects wrong architecture, version, identity, unsafe path and size even if signed', () => {
  for (const change of [
    { version: '1.9.0' },
    { arch: 'x64' },
    { bundleId: 'other.app' },
    { appName: '../Other.app' },
    { file: '../payload.zip' },
    { size: -1 },
    { size: Number.MAX_SAFE_INTEGER },
    { sha256: 'wrong' }
  ]) {
    assert.throws(() => verifyMacManifest(sign({ ...base, ...change }), raw, '1.8.0', 'arm64'))
  }
})
test('compares stable versions without treating metadata as update availability', () => {
  assert.equal(newerThan('1.7.10', '1.7.9'), true)
  assert.equal(newerThan('1.7.10', '1.7.10'), false)
  assert.equal(newerThan('1.7.9', '1.7.10'), false)
  for (const bad of ['1.2.3-beta', '../1.2.3', '1.2', '01.2.3', '9007199254740992.0.0'])
    assert.throws(() => newerThan(bad, '1.0.0'))
})
test('release collection preserves each Windows architecture and fails on conflicts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-release-test-'))
  try {
    const input = path.join(root, 'artifacts')
    const output = path.join(root, 'release')
    for (const arch of ['x64', 'ia32', 'arm64']) {
      const dir = path.join(input, `windows-${arch}`)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'latest.yml'), `version: 1.8.0\npath: setup-${arch}.exe\n`)
    }
    const mac = path.join(input, 'macos')
    fs.mkdirSync(mac)
    for (const arch of ['x64', 'arm64'])
      fs.writeFileSync(path.join(mac, `kiro-update-mac-${arch}.json`), '{}')
    execFileSync(process.execPath, ['scripts/collect-release-assets.mjs', input, output])
    for (const arch of ['x64', 'ia32', 'arm64'])
      assert.match(
        fs.readFileSync(path.join(output, `latest-${arch}.yml`), 'utf8'),
        new RegExp(`setup-${arch}`)
      )
    assert.match(fs.readFileSync(path.join(output, 'latest.yml'), 'utf8'), /setup-x64/)
    fs.writeFileSync(path.join(mac, 'latest.yml'), 'wrong')
    assert.throws(() =>
      execFileSync(process.execPath, ['scripts/collect-release-assets.mjs', input, output], {
        stdio: 'pipe'
      })
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('release signer binds both architecture archives to the embedded public key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-signer-test-'))
  try {
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.mkdirSync(path.join(root, 'resources'))
    fs.mkdirSync(path.join(root, 'dist'))
    const script = path.join(root, 'scripts/sign-mac-updates.mjs')
    fs.copyFileSync('scripts/sign-mac-updates.mjs', script)
    fs.writeFileSync(
      path.join(root, 'resources/update-public-key.json'),
      JSON.stringify({ publicKey: raw })
    )
    for (const arch of ['x64', 'arm64'])
      fs.writeFileSync(
        path.join(root, 'dist', `kiro-account-manager-1.8.0-${arch}-mac.zip`),
        `archive-fixture-${arch}`
      )
    const env = {
      ...process.env,
      KIRO_UPDATE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }
    execFileSync(process.execPath, [script, path.join(root, 'dist'), '1.8.0'], {
      env,
      stdio: 'pipe'
    })
    const verifier = path.join(root, 'scripts/verify-mac-updates.mjs')
    fs.copyFileSync('scripts/verify-mac-updates.mjs', verifier)
    execFileSync(process.execPath, [verifier, path.join(root, 'dist'), '1.8.0'], { stdio: 'pipe' })
    for (const arch of ['x64', 'arm64']) {
      const envelope = JSON.parse(
        fs.readFileSync(path.join(root, 'dist', `kiro-update-mac-${arch}.json`))
      )
      const manifest = verifyMacManifest(envelope, raw, '1.8.0', arch)
      assert.equal(
        manifest.sha256,
        crypto.createHash('sha256').update(`archive-fixture-${arch}`).digest('hex')
      )
    }
    fs.appendFileSync(path.join(root, 'dist/kiro-account-manager-1.8.0-arm64-mac.zip'), 'tampered')
    assert.throws(() =>
      execFileSync(process.execPath, [verifier, path.join(root, 'dist'), '1.8.0'], {
        stdio: 'pipe'
      })
    )
    fs.writeFileSync(
      path.join(root, 'resources/update-public-key.json'),
      JSON.stringify({ publicKey: crypto.randomBytes(32).toString('base64') })
    )
    assert.throws(() =>
      execFileSync(process.execPath, [script, path.join(root, 'dist'), '1.8.0'], {
        env,
        stdio: 'pipe'
      })
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
