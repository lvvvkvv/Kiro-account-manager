const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  // Re-sign the modified Electron bundle before generating DMG/ZIP artifacts.
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
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
