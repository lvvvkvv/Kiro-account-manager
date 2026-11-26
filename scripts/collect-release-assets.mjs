/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Plain JavaScript release utility. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [input = 'artifacts', output = 'release-assets'] = process.argv.slice(2)
fs.mkdirSync(output, { recursive: true })
function copy(source, name) {
  const destination = path.join(output, name)
  if (fs.existsSync(destination)) {
    const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    if (digest(source) !== digest(destination))
      throw new Error(`Conflicting release asset: ${name}`)
  } else fs.copyFileSync(source, destination)
}
function walk(directory, artifact) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(source, artifact || entry.name)
      continue
    }
    if (!entry.isFile() || entry.name === 'builder-debug.yml') continue
    if (
      !/\.(exe|zip|dmg|AppImage|deb|snap|tar\.gz|yml|blockmap)$/.test(entry.name) &&
      !/^kiro-update-mac-(arm64|x64)\.json$/.test(entry.name)
    )
      continue
    if (entry.name === 'latest.yml' && /^windows-(x64|ia32|arm64)$/.test(artifact)) {
      const arch = artifact.slice('windows-'.length)
      copy(source, `latest-${arch}.yml`)
      if (arch === 'x64') copy(source, 'latest.yml') // older clients
    } else {
      copy(source, entry.name)
      if (artifact === 'linux-armv7l' && entry.name === 'latest-linux-arm.yml')
        copy(source, 'latest-linux-armv7l.yml')
    }
  }
}
walk(input, '')
for (const arch of ['arm64', 'x64']) {
  if (!fs.existsSync(path.join(output, `kiro-update-mac-${arch}.json`)))
    throw new Error(`Missing signed macOS manifest: ${arch}`)
}
console.log('Collected release assets without overwriting architecture metadata')
