/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Run selected production bundle methods with an isolated temporary profile. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { X509Certificate, createPrivateKey } from 'node:crypto'
import ts from 'typescript'

const file = path.resolve('out/main/index.js'),
  require = createRequire(file)
const source = fs.readFileSync(file, 'utf8'),
  ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-bundle-smoke-'))
try {
  const context = {
    Buffer,
    Map,
    Set,
    Date,
    console: {
      log() {
        return undefined
      },
      warn() {
        return undefined
      },
      error() {
        return undefined
      }
    },
    proxyLogger: {
      info() {
        return undefined
      },
      warn() {
        return undefined
      }
    },
    conversationCache: new Map([['a', 'fixture']]),
    codeWhispererModelCache: new Map([['a', 'fixture']]),
    pendingModelQueries: new Map(),
    modelCacheGeneration: 0,
    promptCacheTracker: { clear: () => 1 }
  }
  const modules = new Map(),
    methods = new Map(),
    declarations = []
  const functions = new Set([
    'ensureProxySelfSignedCert',
    'ensureCertificate',
    'normalizeAltNames',
    'extractAltNames',
    'isIPv4',
    'isIPv6',
    'generateSerialNumber',
    'computeFingerprint',
    'clearAllCaches',
    'clearKiroModelCache'
  ])
  const allowed = new Set([
    'crypto',
    'node:crypto',
    'fs',
    'fs/promises',
    'node:fs',
    'node:fs/promises',
    'path',
    'node:path',
    'node-forge'
  ])
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && functions.has(statement.name?.text))
      declarations.push(statement.getText(ast))
    if (ts.isVariableStatement(statement))
      for (const d of statement.declarationList.declarations) {
        if (d.name.getText(ast) === 'certificateWrites') declarations.push(statement.getText(ast))
        if (!d.initializer || !ts.isCallExpression(d.initializer)) continue
        const initializer = d.initializer,
          arg = initializer.arguments[0]
        if (initializer.expression.getText(ast) === 'require' && ts.isStringLiteral(arg)) {
          if (allowed.has(arg.text)) modules.set(d.name.getText(ast), require(arg.text))
          if (arg.text === 'electron')
            modules.set(d.name.getText(ast), { app: { getPath: () => root } })
        } else if (
          arg &&
          ts.isIdentifier(arg) &&
          modules.has(arg.text) &&
          initializer.expression.getText(ast).includes('interop')
        ) {
          modules.set(d.name.getText(ast), modules.get(arg.text))
        }
      }
  }
  function visit(n) {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === 'require' &&
      ts.isStringLiteral(n.arguments[0]) &&
      n.arguments[0].text.startsWith('.')
    )
      require.resolve(n.arguments[0].text)
    if (ts.isClassDeclaration(n) && n.name?.text === 'ProxyServer')
      for (const method of n.members) {
        if (
          ts.isMethodDeclaration(method) &&
          [
            'getTlsOptions',
            'getSelfSignedCertInfo',
            'regenerateSelfSignedCert',
            'handleAdminApi'
          ].includes(method.name.getText(ast))
        )
          methods.set(method.name.getText(ast), method.getText(ast))
      }
    ts.forEachChild(n, visit)
  }
  visit(ast)
  assert.equal(methods.size, 4)
  Object.assign(context, Object.fromEntries(modules))
  vm.createContext(context)
  const server = vm.runInContext(
    `${declarations.join('\n')}\n({${[...methods.values()].join(',\n')}})`,
    context
  )
  server.config = { host: '127.0.0.1', tls: { enabled: true } }
  server.appendAuditLog = () => {}
  const tls = await server.getTlsOptions()
  assert.equal(new X509Certificate(tls.cert).checkPrivateKey(createPrivateKey(tls.key)), true)
  const info = await server.getSelfSignedCertInfo()
  assert.ok(info.fingerprint && info.altNames.includes('127.0.0.1'))
  const renewed = await server.regenerateSelfSignedCert()
  assert.notEqual(renewed.fingerprint, info.fingerprint)
  let body, status
  server.validateApiKey = () => ({ valid: true })
  await server.handleAdminApi(
    { method: 'POST' },
    {
      writeHead(value) {
        status = value
      },
      end(value) {
        body = JSON.parse(value)
      }
    },
    '/admin/cache/clear'
  )
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.deepEqual(body.cleared, { conversation: 1, model: 1, promptCache: 1 })
  server.validateApiKey = () => ({ valid: false })
  server.sendError = (_res, value) => (status = value)
  await server.handleAdminApi({ method: 'POST' }, {}, '/admin/cache/clear')
  assert.equal(status, 401)
  console.log(
    'PASS production bundle: local dependencies, automatic TLS, certificate info/regeneration, authorized cache clear and authentication guard'
  )
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
