/**
 * Pure-helper checks for the Persona Manager client half.
 *
 * client.js closes its helpers over the factory body, so this test runs the
 * real source in a node:vm sandbox after inserting a one-line test hook that
 * exposes the pure helpers (`globalThis.__pmTest = {...}`) immediately before
 * the returned module object. Nothing in the shipped file changes.
 *
 * Covered here: client-side validation against the server limits, resilient
 * state normalization (never throws on malformed payloads), API error mapping,
 * and the fetch request/response contract (same-origin JSON).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

const MODULE_RETURN =
  /(^|\n)([ \t]*)return \{\n([ \t]*)inject: \['slots', 'locale'\],/m
const HELPER_NAMES = [
  'validateDraft',
  'normalizeState',
  'describeError',
  'safeColor',
  'draftFromPersona',
  'findPersona',
  'buildPayload',
  'requestJson',
]

/** Convert a vm-realm value to a comparison-safe plain object. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadHelpers(options) {
  const match = MODULE_RETURN.exec(source)
  assert.ok(match, 'module return anchor still present in client.js')
  const indent = match[2]
  const hookText =
    indent +
    'globalThis.__pmTest = { ' +
    HELPER_NAMES.map((name) => name + ': ' + name).join(', ') +
    ' };\n'
  const insertAt = match.index + match[1].length
  const transformed = source.slice(0, insertAt) + hookText + source.slice(insertAt)
  const captured = []
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { captured.push(spec) } } },
    console: { warn() {}, error() {}, log() {} },
  }
  if (options && typeof options.fetch === 'function') sandbox.fetch = options.fetch
  vm.runInNewContext(transformed, sandbox, { filename: 'client.js' })
  assert.equal(captured.length, 1)
  const module = captured[0].factory((name) => {
    assert.equal(name, 'react')
    return { createElement() {} }
  })
  assert.equal(typeof module.apply, 'function')
  assert.ok(sandbox.__pmTest, 'helper hook attached')
  return sandbox.__pmTest
}

function baseDraft(overrides) {
  return {
    name: '鲸鱼娘',
    emoji: '🐋',
    color: '#3b82f6',
    description: '中文傲娇鲸鱼娘',
    body: '你是鲸鱼娘。',
    ...overrides,
  }
}

function personaFixture(overrides) {
  return {
    id: 'p-one',
    name: '鲸鱼娘',
    description: '中文傲娇鲸鱼娘',
    body: '你是鲸鱼娘。',
    emoji: '🐋',
    color: '#3b82f6',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  }
}

test('validateDraft matches the server limits', () => {
  const { validateDraft } = loadHelpers()
  const cases = [
    [baseDraft(), {}],
    [baseDraft({ name: '' }), { name: 'errorName' }],
    [baseDraft({ name: '   ' }), { name: 'errorName' }],
    [baseDraft({ name: 'x'.repeat(80) }), {}],
    [baseDraft({ name: 'x'.repeat(81) }), { name: 'errorName' }],
    [baseDraft({ name: '  ' + 'x'.repeat(80) + '  ' }), {}],
    [baseDraft({ body: '' }), { body: 'errorBody' }],
    [baseDraft({ body: ' \n\t ' }), { body: 'errorBody' }],
    [baseDraft({ body: 'x'.repeat(20000) }), {}],
    [baseDraft({ body: 'x'.repeat(20001) }), { body: 'errorBody' }],
    [baseDraft({ description: 'x'.repeat(300) }), {}],
    [baseDraft({ description: 'x'.repeat(301) }), { description: 'errorDescription' }],
    [baseDraft({ emoji: 'x'.repeat(8) }), {}],
    [baseDraft({ emoji: 'x'.repeat(9) }), { emoji: 'errorEmoji' }],
    [baseDraft({ emoji: '' }), {}],
    [baseDraft({ color: '#ABCDEF' }), {}],
    [baseDraft({ color: 'red' }), { color: 'errorColor' }],
    [baseDraft({ color: '#abc' }), { color: 'errorColor' }],
    [baseDraft({ color: '' }), { color: 'errorColor' }],
  ]
  for (const [draft, expected] of cases) {
    assert.deepEqual(plain(validateDraft(draft)), expected, `draft ${JSON.stringify(draft)}`)
  }
})

test('buildPayload trims emoji/color and keeps body text', () => {
  const { buildPayload } = loadHelpers()
  const payload = buildPayload(baseDraft({ emoji: ' 🐋 ', color: ' #3B82F6 ', body: 'a\nb' }))
  assert.deepEqual(plain(payload), {
    name: '鲸鱼娘',
    description: '中文傲娇鲸鱼娘',
    emoji: '🐋',
    color: '#3B82F6',
    body: 'a\nb',
  })
})

test('normalizeState is resilient to malformed payloads', () => {
  const { normalizeState } = loadHelpers()
  assert.deepEqual(plain(normalizeState(null)), {
    version: 1,
    personas: [],
    global: { activePersonaId: null },
    session: null,
    effectivePersonaId: null,
  })
  assert.deepEqual(plain(normalizeState('nope').personas), [])

  const older = personaFixture({ id: 'p-old', createdAt: 5 })
  const newer = personaFixture({ id: 'p-new', createdAt: 20, name: '猫头鹰' })
  const state = normalizeState({
    version: 1,
    personas: [newer, older, { id: '' }, { then: 'not a persona' }, null],
    global: { activePersonaId: 'p-old' },
    session: { personaId: 'p-new' },
    effectivePersonaId: 'p-new',
  })
  assert.deepEqual(plain(state.personas.map((persona) => persona.id)), ['p-old', 'p-new'])
  assert.deepEqual(plain(state.global), { activePersonaId: 'p-old' })
  assert.deepEqual(plain(state.session), { personaId: 'p-new' })
  assert.equal(state.effectivePersonaId, 'p-new')

  // explicit no-persona session record survives
  const explicitNone = normalizeState({ personas: [], session: { personaId: null } })
  assert.deepEqual(plain(explicitNone.session), { personaId: null })
  assert.equal(explicitNone.effectivePersonaId, null)

  // bad optional fields fall back instead of throwing
  const tolerant = normalizeState({
    personas: [{ id: 'p-x', name: 5, emoji: '', color: 'red', createdAt: 'soon' }],
    global: { activePersonaId: 42 },
    session: 'garbage',
    effectivePersonaId: 7,
  })
  assert.equal(tolerant.personas.length, 1)
  assert.equal(tolerant.personas[0].name, '')
  assert.equal(tolerant.personas[0].emoji, '🎭')
  assert.equal(tolerant.personas[0].color, '#6b7280')
  assert.equal(tolerant.personas[0].createdAt, 0)
  assert.equal(tolerant.global.activePersonaId, null)
  assert.equal(tolerant.session, null)
  assert.equal(tolerant.effectivePersonaId, null)
})

test('safeColor / draftFromPersona / findPersona behave defensively', () => {
  const { safeColor, draftFromPersona, findPersona } = loadHelpers()
  assert.equal(safeColor('#AbCdEf'), '#AbCdEf')
  assert.equal(safeColor('blue'), '#6b7280')
  assert.equal(safeColor(null), '#6b7280')
  assert.deepEqual(plain(draftFromPersona(null)), {
    name: '',
    emoji: '🎭',
    color: '#6b7280',
    description: '',
    body: '',
  })
  const draft = draftFromPersona(personaFixture({ name: 1, emoji: '', color: 'bad' }))
  assert.equal(draft.name, '')
  assert.equal(draft.emoji, '🎭')
  assert.equal(draft.color, '#6b7280')
  const personas = [personaFixture({ id: 'p-a' }), personaFixture({ id: 'p-b' })]
  assert.equal(findPersona(personas, 'p-b').id, 'p-b')
  assert.equal(findPersona(personas, 'p-c'), null)
  assert.equal(findPersona(personas, null), null)
  assert.equal(findPersona(null, 'p-a'), null)
})

test('describeError maps API codes to localized keys', () => {
  const { describeError } = loadHelpers()
  const t = (key, params) => (params ? key + JSON.stringify(params) : key)
  assert.equal(describeError(t, { code: 'network' }), 'error.network')
  assert.equal(describeError(t, { code: 'persona-not-found' }), 'error.persona-not-found')
  assert.equal(describeError(t, { code: 'internal' }), 'error.internal')
  assert.equal(describeError(t, { code: 'http', status: 404 }), 'error.http{"status":404}')
  assert.equal(describeError(t, { code: 'http' }), 'error.http{"status":0}')
  assert.equal(describeError(t, { code: 'mystery' }), 'error.unknown{"code":"mystery"}')
  assert.equal(describeError(t, null), 'error.unknown{"code":"unknown"}')
  assert.equal(describeError(t, new Error('boom')), 'error.unknown{"code":"unknown"}')
})

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? '' : JSON.stringify(payload)),
  }
}

test('requestJson uses the same-origin JSON contract', async () => {
  const calls = []
  const helpers = loadHelpers({
    fetch: (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(jsonResponse(200, { version: 1, personas: [] }))
    },
  })
  const payload = await helpers.requestJson('GET', '/state?sessionId=abc')
  assert.deepEqual(plain(payload), { version: 1, personas: [] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/persona-manager/api/state?sessionId=abc')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.equal(calls[0].init.headers.Accept, 'application/json')
  assert.equal(calls[0].init.body, undefined)

  await helpers.requestJson('POST', '/switch', { scope: 'global', personaId: null })
  assert.equal(calls[1].url, '/persona-manager/api/switch')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[1].init.body, '{"scope":"global","personaId":null}')
})

test('requestJson turns error envelopes into coded errors', async () => {
  const helpers = loadHelpers({
    fetch: () =>
      Promise.resolve(
        jsonResponse(404, { error: { code: 'persona-not-found', message: 'gone' } }),
      ),
  })
  await assert.rejects(helpers.requestJson('PUT', '/personas/p-x', {}), (error) => {
    assert.equal(error.name, 'PersonaApiError')
    assert.equal(error.code, 'persona-not-found')
    assert.equal(error.status, 404)
    assert.equal(error.message, 'gone')
    return true
  })

  const httpOnly = loadHelpers({
    fetch: () => Promise.resolve({ ok: false, status: 500, text: async () => 'oops' }),
  })
  await assert.rejects(httpOnly.requestJson('GET', '/state'), (error) => {
    assert.equal(error.code, 'http')
    assert.equal(error.status, 500)
    return true
  })
})

test('requestJson maps network failures to code network', async () => {
  const helpers = loadHelpers({
    fetch: () => Promise.reject(new Error('offline')),
  })
  await assert.rejects(helpers.requestJson('GET', '/state'), (error) => {
    assert.equal(error.code, 'network')
    return true
  })
})

test('requestJson tolerates an empty success body', async () => {
  const helpers = loadHelpers({
    fetch: () => Promise.resolve({ ok: true, status: 200, text: async () => '' }),
  })
  assert.equal(await helpers.requestJson('DELETE', '/personas/p-x'), null)
})

test('requestJson tolerates a non-JSON success body', async () => {
  const helpers = loadHelpers({
    fetch: () => Promise.resolve({ ok: true, status: 200, text: async () => 'not json' }),
  })
  assert.equal(await helpers.requestJson('GET', '/state'), null)
})
