/**
 * Unit tests for the HTTP API route handler in lib/host/http.js.
 *
 * The handler is driven directly with fake Node request/response objects and a
 * memory-domain store — no network, no Cordis context.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { createApiHandler } from '../lib/host/http.js'
import { PERSONA_ID_RE, createMemoryDomain, createStore } from '../lib/host/store.js'

/** @returns a fake ServerResponse recording the written response. */
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

/** Fresh store over a memory domain (no seeding: each test starts empty). */
function makeStore() {
  const domain = createMemoryDomain()
  return { store: createStore({ domain }), domain }
}

/** Drive one fake API request through the handler. */
async function request(handler, { method = 'GET', path = '/persona-manager/api/state', headers, body } = {}) {
  const chunks = []
  if (body !== undefined) {
    chunks.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  }
  const req = Readable.from(chunks)
  req.method = method
  req.url = path
  req.headers = headers ?? {}
  const res = makeRes()
  await handler(req, res)
  return {
    res,
    status: res.statusCode,
    headers: res.headers,
    json: res.body.length > 0 ? JSON.parse(res.body) : undefined,
  }
}

test('GET /state returns the empty §7 state document', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const { status, headers, json } = await request(handler)
  assert.equal(status, 200)
  assert.equal(headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(headers['Cache-Control'], 'no-store')
  assert.deepEqual(json, {
    version: 1,
    personas: [],
    global: { activePersonaId: null },
    session: null,
    effectivePersonaId: null,
  })
})

test('POST /personas creates a normalized persona (201)', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const { status, json } = await request(handler, {
    method: 'POST',
    path: '/persona-manager/api/personas',
    body: { name: '  鲸鱼娘 ', body: '  PERSONA-BODY  ', emoji: '🐋', color: '#3B82F6', id: 'p_hacked' },
  })
  assert.equal(status, 201)
  assert.equal(json.persona.name, '鲸鱼娘')
  assert.equal(json.persona.body, 'PERSONA-BODY')
  assert.equal(json.persona.emoji, '🐋')
  assert.equal(json.persona.color, '#3B82F6')
  assert.match(json.persona.id, PERSONA_ID_RE)
  assert.notEqual(json.persona.id, 'p_hacked')
  assert.equal(json.persona.description, '')
  assert.ok(json.persona.createdAt > 0)

  const state = await request(handler)
  assert.equal(state.json.personas.length, 1)
  assert.deepEqual(state.json.personas[0], json.persona)
})

test('POST /personas error paths: invalid-body / invalid-json / invalid-persona', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const create = (body) =>
    request(handler, { method: 'POST', path: '/persona-manager/api/personas', body })

  const empty = await create(undefined)
  assert.equal(empty.status, 400)
  assert.equal(empty.json.error.code, 'invalid-body')

  const arrayBody = await create([1, 2])
  assert.equal(arrayBody.status, 400)
  assert.equal(arrayBody.json.error.code, 'invalid-body')

  const badJson = await create('{oops')
  assert.equal(badJson.status, 400)
  assert.equal(badJson.json.error.code, 'invalid-json')

  const badPersona = await create({ name: 'x' })
  assert.equal(badPersona.status, 400)
  assert.equal(badPersona.json.error.code, 'invalid-persona')

  const tooLong = await create({ name: 'n', body: 'b'.repeat(20001) })
  assert.equal(tooLong.status, 400)
  assert.equal(tooLong.json.error.code, 'invalid-persona')
})

test('PUT and DELETE /personas/<id>', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const created = await request(handler, {
    method: 'POST',
    path: '/persona-manager/api/personas',
    body: { name: '旧名', body: '旧正文' },
  })
  const id = created.json.persona.id

  const updated = await request(handler, {
    method: 'PUT',
    path: `/persona-manager/api/personas/${id}`,
    body: { name: '新名', unknown: true },
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.json.persona.name, '新名')
  assert.equal(updated.json.persona.body, '旧正文')
  assert.equal(updated.json.persona.id, id)

  const badPatch = await request(handler, {
    method: 'PUT',
    path: `/persona-manager/api/personas/${id}`,
    body: { color: 'nope' },
  })
  assert.equal(badPatch.status, 400)
  assert.equal(badPatch.json.error.code, 'invalid-persona')

  const missing = await request(handler, {
    method: 'PUT',
    path: '/persona-manager/api/personas/p_missing',
    body: { name: 'x' },
  })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not-found')

  const deleted = await request(handler, { method: 'DELETE', path: `/persona-manager/api/personas/${id}` })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.json, { ok: true, clearedGlobal: false, clearedSessions: 0 })

  const again = await request(handler, { method: 'DELETE', path: `/persona-manager/api/personas/${id}` })
  assert.equal(again.status, 404)
  assert.equal(again.json.error.code, 'not-found')

  const badId = await request(handler, {
    method: 'DELETE',
    path: '/persona-manager/api/personas/bad%20id',
  })
  assert.equal(badId.status, 404)
  assert.equal(badId.json.error.code, 'not-found')
})

test('POST /switch: global default and session override', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const first = (
    await request(handler, {
      method: 'POST',
      path: '/persona-manager/api/personas',
      body: { name: '全局', body: 'GLOBAL' },
    })
  ).json.persona.id
  const second = (
    await request(handler, {
      method: 'POST',
      path: '/persona-manager/api/personas',
      body: { name: '会话', body: 'SESSION' },
    })
  ).json.persona.id

  const globalSwitch = await request(handler, {
    method: 'POST',
    path: '/persona-manager/api/switch',
    body: { scope: 'global', personaId: first },
  })
  assert.equal(globalSwitch.status, 200)
  assert.deepEqual(globalSwitch.json, { ok: true, effectivePersonaId: first })

  const sessionSwitch = await request(handler, {
    method: 'POST',
    path: '/persona-manager/api/switch',
    body: { scope: 'session', sessionId: 'sess-A', personaId: second },
  })
  assert.equal(sessionSwitch.status, 200)
  assert.deepEqual(sessionSwitch.json, { ok: true, effectivePersonaId: second })

  const sessionState = await request(handler, {
    path: '/persona-manager/api/state?sessionId=sess-A',
  })
  assert.deepEqual(sessionState.json.session, { personaId: second })
  assert.equal(sessionState.json.effectivePersonaId, second)

  // §8 "跟随全局": personaId null clears the session override.
  const clearSwitch = await request(handler, {
    method: 'POST',
    path: '/persona-manager/api/switch',
    body: { scope: 'session', sessionId: 'sess-A', personaId: null },
  })
  assert.equal(clearSwitch.status, 200)
  assert.deepEqual(clearSwitch.json, { ok: true, effectivePersonaId: first })
  const clearedState = await request(handler, { path: '/persona-manager/api/state?sessionId=sess-A' })
  assert.equal(clearedState.json.session, null)
  assert.equal(clearedState.json.effectivePersonaId, first)

  // Clearing the global default produces "no persona" for every session.
  const clearGlobal = await request(handler, {
    method: 'POST',
    path: '/persona-manager/api/switch',
    body: { scope: 'global', personaId: null },
  })
  assert.deepEqual(clearGlobal.json, { ok: true, effectivePersonaId: null })
})

test('POST /switch error paths', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const persona = (
    await request(handler, {
      method: 'POST',
      path: '/persona-manager/api/personas',
      body: { name: 'n', body: 'b' },
    })
  ).json.persona.id
  const switchTo = (body) => request(handler, { method: 'POST', path: '/persona-manager/api/switch', body })

  assert.equal((await switchTo({ personaId: persona })).json.error.code, 'invalid-body')
  assert.equal((await switchTo({ scope: 'bogus', personaId: persona })).json.error.code, 'invalid-body')
  assert.equal((await switchTo({ scope: 'global' })).json.error.code, 'invalid-body')
  assert.equal((await switchTo({ scope: 'global', personaId: 42 })).json.error.code, 'invalid-body')
  assert.equal(
    (await switchTo({ scope: 'session', personaId: persona })).json.error.code,
    'invalid-body',
  )

  const missingPersona = await switchTo({ scope: 'global', personaId: 'p_missing' })
  assert.equal(missingPersona.status, 404)
  assert.equal(missingPersona.json.error.code, 'persona-not-found')

  const missingSessionPersona = await switchTo({
    scope: 'session',
    sessionId: 'sess',
    personaId: 'p_missing',
  })
  assert.equal(missingSessionPersona.status, 404)
  assert.equal(missingSessionPersona.json.error.code, 'persona-not-found')

  const badIdShape = await switchTo({ scope: 'session', sessionId: 'sess', personaId: 'bad id!' })
  assert.equal(badIdShape.status, 404)
  assert.equal(badIdShape.json.error.code, 'persona-not-found')
})

test('method allow-lists and unknown paths', async () => {
  const { store, domain } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const persona = (
    await request(handler, {
      method: 'POST',
      path: '/persona-manager/api/personas',
      body: { name: 'n', body: 'b' },
    })
  ).json.persona

  const patchState = await request(handler, { method: 'PATCH', path: '/persona-manager/api/state' })
  assert.equal(patchState.status, 405)
  assert.equal(patchState.json.error.code, 'method-not-allowed')
  assert.equal(patchState.headers.Allow, 'GET')

  const getPersonas = await request(handler, { path: '/persona-manager/api/personas' })
  assert.equal(getPersonas.status, 405)
  assert.equal(getPersonas.headers.Allow, 'POST')

  const deleteSwitch = await request(handler, { method: 'DELETE', path: '/persona-manager/api/switch' })
  assert.equal(deleteSwitch.status, 405)
  assert.equal(deleteSwitch.headers.Allow, 'POST')

  const deleteState = await request(handler, { method: 'DELETE', path: '/persona-manager/api/state' })
  assert.equal(deleteState.status, 405)

  const postById = await request(handler, {
    method: 'POST',
    path: `/persona-manager/api/personas/${persona.id}`,
  })
  assert.equal(postById.status, 405)
  assert.equal(postById.headers.Allow, 'PUT, DELETE')

  const unknown = await request(handler, { path: '/persona-manager/api/nope' })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'not-found')

  const deepUnknown = await request(handler, {
    path: `/persona-manager/api/personas/${persona.id}/extra`,
  })
  assert.equal(deepUnknown.status, 404)

  const root = await request(handler, { path: '/persona-manager/api' })
  assert.equal(root.status, 404)

  // The fake domain is unused here but keeps the harness honest about wiring.
  assert.equal(typeof domain.table('sessions').get, 'function')
})

test('Origin admission rejects cross-host browser requests (403 bad-origin)', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const body = { name: 'n', body: 'b' }
  const path = '/persona-manager/api/personas'

  const blocked = await request(handler, {
    method: 'POST',
    path,
    body,
    headers: { origin: 'http://evil.example', host: '127.0.0.1:58171' },
  })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.json.error.code, 'bad-origin')

  const allowed = await request(handler, {
    method: 'POST',
    path,
    body,
    headers: { origin: 'http://127.0.0.1:58171', host: '127.0.0.1:58171' },
  })
  assert.equal(allowed.status, 201)

  const noOrigin = await request(handler, { method: 'POST', path, body, headers: { host: '127.0.0.1:58171' } })
  assert.equal(noOrigin.status, 201)
})

test('GET /state treats an empty sessionId as absent', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store })
  const { status, json } = await request(handler, { path: '/persona-manager/api/state?sessionId=%20' })
  assert.equal(status, 200)
  assert.equal(json.session, null)
  assert.equal(json.effectivePersonaId, null)
})

test('unexpected store failures map to 500 internal without leaking details', async () => {
  const logger = { error: () => {}, warn: () => {}, info: () => {} }
  const handler = createApiHandler({
    getStore: () => ({
      stateFor() {
        throw new Error('secret internals')
      },
    }),
    logger,
  })
  const { status, json } = await request(handler)
  assert.equal(status, 500)
  assert.deepEqual(json, { error: { code: 'internal', message: 'internal server error' } })
})

test('trust guard runs before routing and body reads', async () => {
  const { store } = makeStore()
  let storeReads = 0
  const handler = createApiHandler({
    getStore: () => {
      storeReads += 1
      return store
    },
    trust: () => ({ status: 401, code: 'unauthenticated', message: 'login required' }),
  })

  // Even an unknown path and a malformed body must be answered by the guard.
  const unknown = await request(handler, { path: '/persona-manager/api/nope', method: 'POST', body: '{oops' })
  assert.equal(unknown.status, 401)
  assert.deepEqual(unknown.json, { error: { code: 'unauthenticated', message: 'login required' } })
  assert.equal(storeReads, 0)

  const forged = await request(handler, { headers: { host: 'evil.example', origin: 'http://evil.example' } })
  assert.equal(forged.status, 401)
  assert.equal(storeReads, 0)
})

test('trust guard rejection can be a 403 untrusted failure', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({
    getStore: () => store,
    trust: () => ({ status: 403, code: 'untrusted', message: 'host not allowed' }),
  })
  const { status, json } = await request(handler)
  assert.equal(status, 403)
  assert.equal(json.error.code, 'untrusted')
})

test('a passing trust guard keeps the normal API behaviour', async () => {
  const { store } = makeStore()
  const handler = createApiHandler({ getStore: () => store, trust: () => undefined })
  const { status } = await request(handler)
  assert.equal(status, 200)
})
