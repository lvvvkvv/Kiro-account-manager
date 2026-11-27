/* eslint @typescript-eslint/explicit-function-return-type: "off" -- JavaScript test helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function load(entry) {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
}
const { tokenRefreshAt, isTokenRefreshDue, tokenRefreshConcurrency } = await load(
  'src/shared/tokenRefresh.ts'
)
const { TokenRefreshCoordinator } = await load('src/main/tokenRefreshCoordinator.ts')
const minute = 60_000
const expiry = 1_800_000_000_000
const flush = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('same-expiry accounts spread across the entire 10–30 minute window', () => {
  const buckets = Array(20).fill(0)
  for (let i = 0; i < 10_000; i++) {
    const lead = expiry - tokenRefreshAt(`account-${i}`, expiry)
    assert.ok(lead >= 10 * minute && lead <= 30 * minute)
    buckets[Math.floor((lead - 10 * minute) / minute)]++
  }
  for (const count of buckets) assert.ok(count > 350 && count < 650, `uneven bucket: ${count}`)
})

test('deadline survives repeated checks/restarts and changes with the next token expiry', async () => {
  const deadline = tokenRefreshAt('account-1', expiry)
  const freshModule = await load('src/shared/tokenRefresh.ts')
  assert.equal(freshModule.tokenRefreshAt('account-1', expiry), deadline)
  assert.equal(isTokenRefreshDue('account-1', expiry, deadline - 1), false)
  assert.equal(isTokenRefreshDue('account-1', expiry, deadline), true)
  assert.equal(isTokenRefreshDue('account-1', expiry, expiry + minute), true)
  assert.notEqual(
    expiry - deadline,
    expiry + 60 * minute - tokenRefreshAt('account-1', expiry + 60 * minute)
  )
})

test('unknown/invalid expiry is skipped; overdue schedules catch up immediately', () => {
  for (const value of [undefined, 0, NaN, Infinity, -Infinity]) {
    assert.equal(isTokenRefreshDue('account', value, expiry), false)
  }
  assert.equal(isTokenRefreshDue('account', expiry, expiry - 9 * minute), true)
  assert.equal(isTokenRefreshDue('account', expiry, expiry - 31 * minute), false)
})

test('concurrency settings are finite integers within 1–500', () => {
  for (const value of [undefined, NaN, Infinity]) assert.equal(tokenRefreshConcurrency(value), 100)
  assert.equal(tokenRefreshConcurrency(0), 1)
  assert.equal(tokenRefreshConcurrency(-20), 1)
  assert.equal(tokenRefreshConcurrency(2.9), 2)
  assert.equal(tokenRefreshConcurrency(999), 500)
})

test('overlapping batches share one concurrency limit and queued duplicates share the result', async () => {
  const coordinator = new TokenRefreshCoordinator(() => 2)
  const gates = Array.from({ length: 5 }, deferred)
  let active = 0,
    peak = 0,
    calls = 0
  const refresh = (i) => async () => {
    calls++
    peak = Math.max(peak, ++active)
    await gates[i].promise
    active--
    return `new-token-${i}`
  }
  const firstBatch = [coordinator.run('a', refresh(0)), coordinator.run('b', refresh(1))]
  const secondBatch = [
    coordinator.run('c', refresh(2)),
    coordinator.run('d', refresh(3)),
    coordinator.run('e', refresh(4))
  ]
  const duplicate = coordinator.run('c', () => {
    throw Error('duplicate request')
  })
  assert.equal(duplicate, secondBatch[0])
  await flush()
  assert.equal(calls, 2)
  gates[0].resolve()
  await flush()
  assert.equal(calls, 3)
  for (const gate of gates) gate.resolve()
  assert.deepEqual(await Promise.all([...firstBatch, ...secondBatch, duplicate]), [
    'new-token-0',
    'new-token-1',
    'new-token-2',
    'new-token-3',
    'new-token-4',
    'new-token-2'
  ])
  assert.equal(peak, 2)
  assert.equal(calls, 5)
})

test('active duplicates are coalesced and failed refresh releases its slot for retry', async () => {
  const coordinator = new TokenRefreshCoordinator(() => 1)
  const gate = deferred()
  const first = coordinator.run('same-account-token', () => gate.promise)
  const duplicate = coordinator.run('same-account-token', () => assert.fail('duplicate'))
  assert.equal(first, duplicate)
  const rejected = assert.rejects(first, /offline/)
  const next = coordinator.run('another-account', async () => 'ok')
  gate.reject(Error('offline'))
  await rejected
  assert.equal(await next, 'ok')
  assert.equal(await coordinator.run('same-account-token', async () => 'retried'), 'retried')
})

test('synchronous exceptions release slots and lowered limits govern queued work', async () => {
  let limit = 2
  const coordinator = new TokenRefreshCoordinator(() => limit)
  await assert.rejects(
    coordinator.run('throws', () => {
      throw Error('sync')
    }),
    /sync/
  )
  const a = deferred(),
    b = deferred()
  const tasks = [coordinator.run('a', () => a.promise), coordinator.run('b', () => b.promise)]
  let started = false
  tasks.push(
    coordinator.run('c', async () => {
      started = true
      return 'c'
    })
  )
  await flush()
  limit = 1
  a.resolve('a')
  await flush()
  assert.equal(started, false)
  b.resolve('b')
  assert.deepEqual(await Promise.all(tasks), ['a', 'b', 'c'])
})
