/**
 * Host wiring test: mount the real index.js `apply()` on a fake Cordis context
 * whose optional services are hand-rolled fakes (storageDomain, agents,
 * webServer). This proves the plugin loads, seeds, injects the persona section,
 * and serves the API end-to-end without a running DSH host.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { apply } from '../index.js'
import { createMemoryDomain } from '../lib/host/store.js'
import { SEED_PERSONA } from '../lib/host/seed.js'

/** Fake logger with inspectable calls. */
function makeLogger() {
  const records = { info: [], warn: [], error: [] }
  const capture =
    (level) =>
    (...args) => {
      records[level].push(args.map((value) => String(value)).join(' '))
    }
  return { records, info: capture('info'), warn: capture('warn'), error: capture('error') }
}

/** A fake webServer that records route registrations. */
function makeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
}

/** A fake storageDomain whose `open()` returns a memory domain (no mode → storage). */
function makeStorageDomain({ failOpen = false } = {}) {
  const record = { openedSpec: undefined, domain: undefined, closed: false }
  return {
    record,
    async open(spec) {
      if (failOpen) throw new Error('backend-not-found: no backend routed for domain')
      record.openedSpec = spec
      const memory = createMemoryDomain()
      record.domain = {
        table: (name) => memory.table(name),
        global: memory.global,
        async close() {
          record.closed = true
          await memory.close()
        },
      }
      return record.domain
    },
  }
}

/**
 * Fake agent context exposing the two APIs prompt.js uses.
 * @returns {{ agent: object, calls: object[] }}
 */
function makeAgent(id) {
  const calls = []
  const ctx = {
    systemPrompt: {
      section(options) {
        const record = { ...options, disposed: false }
        calls.push(record)
        return () => {
          record.disposed = true
        }
      },
    },
    effect(callback) {
      const dispose = callback()
      return () => {
        dispose?.()
      }
    },
  }
  return { agent: { id, ctx }, calls }
}

/** Build a fake Cordis plugin context around the optional fakes. */
function makeHarness({ storageDomain, agents, webServer, connection } = {}) {
  const logger = makeLogger()
  const effects = []
  const listeners = new Map()
  const injectCalls = []
  const services = new Map()
  if (storageDomain !== undefined) services.set('storageDomain', storageDomain)
  if (agents !== undefined) services.set('agents', agents)
  if (webServer !== undefined) services.set('webServer', webServer)
  if (connection !== undefined) services.set('connection', connection)

  const ctx = {
    logger,
    get(name) {
      return services.get(name)
    },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return () => dispose?.()
    },
    on(event, callback) {
      const list = listeners.get(event) ?? []
      list.push(callback)
      listeners.set(event, list)
      return () => {}
    },
    inject(dependencies, _callback) {
      injectCalls.push(dependencies)
    },
  }

  return {
    ctx,
    logger,
    injectCalls,
    listeners,
    emit(event, payload) {
      for (const callback of listeners.get(event) ?? []) callback(payload)
    },
    async unload() {
      // Cordis contains a throwing disposer (logs it) and keeps unloading; the
      // fake mirrors that so the test asserts the same contract.
      for (const dispose of effects.reverse()) {
        try {
          await dispose?.()
        } catch (error) {
          logger.error(String(error))
        }
      }
    },
  }
}

/** Fake ServerResponse recording the written response. */
function makeRes() {
  return {
    statusCode: undefined,
    headers: {},
    headersSent: false,
    writableEnded: false,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = { ...headers }
      this.headersSent = true
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(chunk) {
      if (typeof chunk === 'string') this.body += chunk
      else if (chunk) this.body += Buffer.from(chunk).toString('utf8')
      this.writableEnded = true
    },
    destroy() {},
  }
}

/** Drive one request through a registered prefix route handler. */
async function callRoute(route, { method = 'GET', path = '/persona-manager/api/state', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(chunks)
  req.method = method
  req.url = path
  req.headers = {}
  const res = makeRes()
  await route.handler(req, res)
  return {
    status: res.statusCode,
    headers: res.headers,
    json: res.body.length > 0 ? JSON.parse(res.body) : undefined,
  }
}

test('apply() wires storage + seed + prompt injection + HTTP API end-to-end', async () => {
  const preexisting = makeAgent('agent-existing')
  const agents = { list: () => [preexisting.agent] }
  const webServer = makeWebServer()
  const storage = makeStorageDomain()
  const connection = { requestRejection: () => undefined }
  const harness = makeHarness({ storageDomain: storage, agents, webServer, connection })

  await apply(harness.ctx, {})
  assert.equal(storage.record.openedSpec.name, 'persona_manager')
  assert.equal(storage.record.openedSpec.layout, 'single')
  assert.ok(harness.logger.records.info.some((line) => line.includes('mode=storage')))

  assert.equal(webServer.routes.length, 1)
  const route = webServer.routes[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/persona-manager/api')

  // First run seeded the built-in persona and made it the global default.
  const state = await callRoute(route)
  assert.equal(state.status, 200)
  assert.equal(state.json.personas.length, 1)
  assert.equal(state.json.personas[0].name, '鲸鱼娘')
  const seedId = state.json.personas[0].id
  assert.equal(state.json.global.activePersonaId, seedId)

  // The agent that existed before the plugin mounted got its persona section.
  assert.equal(preexisting.calls.length, 1)
  assert.equal(preexisting.calls[0].name, 'deployment:persona-prefix')
  assert.equal(preexisting.calls[0].interpolate, false)
  assert.equal(preexisting.calls[0].text(), SEED_PERSONA.body)

  // Switching the global default via the API changes the next assembly's text.
  const created = await callRoute(route, {
    method: 'POST',
    path: '/persona-manager/api/personas',
    body: { name: '工作模式', body: 'WORK-BODY' },
  })
  assert.equal(created.status, 201)
  const personaId = created.json.persona.id
  const switched = await callRoute(route, {
    method: 'POST',
    path: '/persona-manager/api/switch',
    body: { scope: 'global', personaId },
  })
  assert.deepEqual(switched.json, { ok: true, effectivePersonaId: personaId })
  assert.equal(preexisting.calls[0].text(), 'WORK-BODY')

  // A new agent gets a section at agent/created and inherits the global default.
  const late = makeAgent('agent-late')
  harness.emit('agent/created', { agent: late.agent })
  assert.equal(late.calls.length, 1)
  assert.equal(late.calls[0].text(), 'WORK-BODY')

  // A per-session override only affects that agent's section.
  const override = await callRoute(route, {
    method: 'POST',
    path: '/persona-manager/api/switch',
    body: { scope: 'session', sessionId: 'agent-late', personaId: seedId },
  })
  assert.deepEqual(override.json, { ok: true, effectivePersonaId: seedId })
  assert.equal(late.calls[0].text(), SEED_PERSONA.body)
  assert.equal(preexisting.calls[0].text(), 'WORK-BODY')

  // agent/disposed tears the section down.
  harness.emit('agent/disposed', { agent: late.agent })
  assert.equal(late.calls[0].disposed, true)

  // Plugin unload disposes the remaining section, the route, and the domain.
  await harness.unload()
  assert.equal(preexisting.calls[0].disposed, true)
  assert.equal(webServer.routes.length, 0)
  assert.equal(storage.record.closed, true)
  const afterUnload = await callRoute(route)
  assert.equal(afterUnload.status, 500)
})

test('apply() still loads and injects personas when storageDomain is unavailable', async () => {
  const harness = makeHarness({})
  await apply(harness.ctx, {})

  assert.ok(
    harness.logger.records.error.some((line) => line.includes('storageDomain service unavailable')),
    'the memory fallback is reported through ctx.logger.error',
  )
  assert.equal(harness.listeners.get('agent/created')?.length, 1)
  assert.deepEqual(harness.injectCalls, [['webServer']], 'late webServer registration is attempted')

  const agent = makeAgent('agent-headless')
  harness.emit('agent/created', { agent: agent.agent })
  assert.equal(agent.calls.length, 1)
  // The in-memory fallback is still seeded, so persona injection works headless.
  assert.equal(agent.calls[0].text(), SEED_PERSONA.body)

  harness.emit('agent/disposed', { agent: agent.agent })
  await harness.unload()
  assert.equal(agent.calls[0].disposed, true)
})

test('apply() degrades to memory when storageDomain.open() fails', async () => {
  const storage = makeStorageDomain({ failOpen: true })
  const webServer = makeWebServer()
  const connection = { requestRejection: () => undefined }
  const harness = makeHarness({ storageDomain: storage, webServer, connection })

  await apply(harness.ctx, {})
  assert.ok(
    harness.logger.records.error.some((line) => line.includes('falling back to the in-memory store')),
    'the storage failure is reported through ctx.logger.error',
  )
  assert.equal(webServer.routes.length, 1)

  const state = await callRoute(webServer.routes[0])
  assert.equal(state.status, 200)
  assert.equal(state.json.personas.length, 1)
  assert.equal(state.json.personas[0].name, '鲸鱼娘')

  await harness.unload()
})

test('apply() survives a domain whose close() rejects during unload', async () => {
  const storage = makeStorageDomain()
  const originalOpen = storage.open
  storage.open = async (spec) => {
    const domain = await originalOpen.call(storage, spec)
    return {
      ...domain,
      async close() {
        await domain.close()
        throw new Error('close exploded')
      },
    }
  }
  const harness = makeHarness({ storageDomain: storage })
  await apply(harness.ctx, {})
  await assert.doesNotReject(() => harness.unload())
})

test('the API route applies the Connection request trust fence before routing', async () => {
  const webServer = makeWebServer()
  const storage = makeStorageDomain()
  let rejection = 403
  const connection = { requestRejection: () => rejection }
  const harness = makeHarness({ storageDomain: storage, webServer, connection })
  await apply(harness.ctx, {})

  const route = webServer.routes[0]
  const untrusted = await callRoute(route)
  assert.equal(untrusted.status, 403)
  assert.equal(untrusted.json.error.code, 'untrusted')

  rejection = 401
  const unauthenticated = await callRoute(route)
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.json.error.code, 'unauthenticated')

  rejection = undefined
  const trusted = await callRoute(route)
  assert.equal(trusted.status, 200)
  await harness.unload()
})
