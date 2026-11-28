/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Isolated update transport fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: ['src/main/updater/mac.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'no-electron-runtime',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const app={}',
          loader: 'js'
        }))
      }
    }
  ]
})
const { request, readUpdateText, UpdateNetworkError } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
)

test('header and body transport errors are network errors; malformed JSON stays a parse error', async () => {
  await assert.rejects(
    request(async () => {
      throw Error('offline')
    }, 'https://fixture.invalid'),
    UpdateNetworkError
  )
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.error(new TypeError('connection reset'))
      }
    })
  )
  await assert.rejects(readUpdateText(response), UpdateNetworkError)
  const text = await readUpdateText(new Response('{broken-json'))
  assert.throws(() => JSON.parse(text), SyntaxError)
})
test('server failure cancels its body and caller cancellation preserves its reason', async () => {
  let cancelled = false
  await assert.rejects(
    request(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            }
          }),
          { status: 503 }
        ),
      'https://fixture.invalid'
    ),
    UpdateNetworkError
  )
  assert.equal(cancelled, true)
  const controller = new AbortController()
  const failure = Error('caller cancelled')
  const pending = request(
    async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    'https://fixture.invalid',
    30000,
    controller.signal
  )
  controller.abort(failure)
  await assert.rejects(pending, (error) => error === failure)
})
test('update adapter preserves archive deadline while ordinary requests keep 60 seconds', async () => {
  const file = ts.createSourceFile(
    'index.ts',
    fs.readFileSync('src/main/index.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const fn = file.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'fetchWithAppProxy'
  )
  let options
  const timers = []
  const context = {
    AbortSignal: {
      any: AbortSignal.any,
      timeout(ms) {
        timers.push(ms)
        return new AbortController().signal
      }
    },
    getNetworkAgent: () => null,
    fetch: async (_url, value) => {
      options = value
      return {}
    }
  }
  vm.createContext(context)
  vm.runInContext(
    ts.transpileModule(fn.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText,
    context
  )
  await context.fetchWithAppProxy('https://fixture.invalid', {})
  assert.deepEqual(timers, [60000])
  // Read the actual updater adapter so a wiring regression cannot bypass this check.
  const initialize = file.statements.find(
    (n) => ts.isExpressionStatement(n) && n.getText(file).includes('new AppUpdateService')
  )
  let adapter
  const visit = (n) => {
    if (ts.isNewExpression(n) && n.expression.getText(file) === 'AppUpdateService') {
      adapter = n.arguments[0].properties.find((p) => p.name?.getText(file) === 'fetch').initializer
    }
    ts.forEachChild(n, visit)
  }
  visit(initialize || file)
  const fetchUpdate = vm.runInContext(
    ts.transpileModule(`(${adapter.getText(file)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    context
  )
  timers.length = 0
  const signal = new AbortController().signal
  await fetchUpdate('https://fixture.invalid', { signal })
  assert.deepEqual(timers, [900000])
  assert.equal(options.signal.aborted, false)
})
