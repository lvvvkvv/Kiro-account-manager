import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
const root = process.cwd()
const output = path.join(root, 'dist/updater-ui')
fs.mkdirSync(path.join(output, 'user-data'), { recursive: true })
await build({
  entryPoints: ['test/updater/ui-entry.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  outfile: path.join(output, 'app.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  alias: { '@': path.join(root, 'src/renderer/src') },
  plugins: [
    {
      name: 'isolated-store',
      setup(builder) {
        builder.onResolve({ filter: /^@\/store\/accounts$/ }, () => ({
          path: 'store',
          namespace: 'mock'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: `const state={darkMode:false,language:'zh'};export const useAccountsStore = select => select ? select(state) : state;`,
          loader: 'js'
        }))
      }
    }
  ]
})
const css = fs.readdirSync('out/renderer/assets').find((name) => name.endsWith('.css'))
fs.copyFileSync(path.join('out/renderer/assets', css), path.join(output, 'app.css'))
fs.writeFileSync(
  path.join(output, 'index.html'),
  '<!doctype html><html lang="zh"><head><meta charset="UTF-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>'
)
execFileSync(
  path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  ['test/updater/ui-harness.cjs', output],
  { stdio: 'inherit', timeout: 45000 }
)
console.log(`UI artifacts: ${output}`)
