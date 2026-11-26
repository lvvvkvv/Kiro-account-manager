const { execFileSync } = require('node:child_process')
const path = require('node:path')
let helperPrepared = false

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const fs = require('node:fs')
  const helper = path.join(__dirname, '../out/native-updater/kiro-updater')
  // Compile the standalone universal helper once for both package architectures.
  if (!helperPrepared) {
    execFileSync(process.execPath, [path.join(__dirname, '../scripts/build-mac-updater.mjs')], {
      stdio: 'inherit'
    })
    helperPrepared = true
  }

  // Re-sign the modified Electron bundle before generating DMG/ZIP artifacts.
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  fs.copyFileSync(helper, path.join(appPath, 'Contents/Resources/kiro-updater'))
  fs.chmodSync(path.join(appPath, 'Contents/Resources/kiro-updater'), 0o755)
  execFileSync(
    'codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--entitlements',
      path.join(__dirname, 'entitlements.mac.plist'),
      appPath
    ],
    { stdio: 'inherit' }
  )
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit'
  })
}
