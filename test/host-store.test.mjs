/**
 * Unit tests for lib/host/store.js and lib/host/seed.js.
 *
 * A memory domain replaces the real storage-domain handle, so these tests touch
 * no filesystem, network, or Cordis context.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PERSONA_COLOR,
  DEFAULT_PERSONA_EMOJI,
  PERSONA_ID_RE,
  PersonaNotFoundError,
  PersonaValidationError,
  STORAGE_DOMAIN_SPEC,
  createMemoryDomain,
  createStore,
  normalizeGlobal,
  normalizePersonaInput,
  normalizePersonaPatch,
  normalizeStoredPersona,
  normalizeStoredSession,
} from '../lib/host/store.js'
import { SEED_PERSONA, ensureSeeded } from '../lib/host/seed.js'

/** Build a deterministic store over a fresh memory domain. */
function makeStore() {
  let tick = 1_760_000_000_000
  let suffixCounter = 0
  const domain = createMemoryDomain()
  const store = createStore({
    domain,
    clock: {
      now: () => {
        tick += 1_000
        return tick
      },
      suffix: () => {
        suffixCounter += 1
        return String(suffixCounter).padStart(4, '0').slice(-4)
      },
    },
  })
  return { store, domain }
}

test('storage domain spec matches DESIGN §4', () => {
  assert.equal(STORAGE_DOMAIN_SPEC.name, 'persona_manager')
  assert.equal(STORAGE_DOMAIN_SPEC.version, 1)
  assert.equal(STORAGE_DOMAIN_SPEC.layout, 'single')
  assert.equal(STORAGE_DOMAIN_SPEC.invalidRecords, 'backup-and-skip')
  assert.deepEqual(STORAGE_DOMAIN_SPEC.global.initial, { activePersonaId: null, seeded: false })
  assert.equal(typeof STORAGE_DOMAIN_SPEC.global.schema.parse, 'function')
  assert.deepEqual(Object.keys(STORAGE_DOMAIN_SPEC.tables), ['personas', 'sessions'])
  assert.equal(typeof STORAGE_DOMAIN_SPEC.tables.personas.valueSchema.parse, 'function')
  assert.equal(typeof STORAGE_DOMAIN_SPEC.tables.sessions.valueSchema.parse, 'function')

  // The domain runtime only calls .parse(); hand-written validators must work.
  assert.deepEqual(STORAGE_DOMAIN_SPEC.global.schema.parse(null), { activePersonaId: null, seeded: false })
  assert.deepEqual(STORAGE_DOMAIN_SPEC.global.schema.parse({ activePersonaId: 'p_ok', seeded: true }), {
    activePersonaId: 'p_ok',
    seeded: true,
  })
})

test('normalizePersonaInput trims, defaults, and drops unknown fields', () => {
  const persona = normalizePersonaInput({
    name: '  鲸鱼娘  ',
    body: '  第一行\n第二行  ',
    description: '  傲娇  ',
    emoji: '🐋',
    color: '#3B82F6',
    id: 'p_hacked',
    createdAt: 1,
  })
  assert.deepEqual(persona, {
    name: '鲸鱼娘',
    description: '傲娇',
    body: '第一行\n第二行',
    emoji: '🐋',
    color: '#3B82F6',
  })
  const defaults = normalizePersonaInput({ name: 'n', body: 'b' })
  assert.equal(defaults.description, '')
  assert.equal(defaults.emoji, DEFAULT_PERSONA_EMOJI)
  assert.equal(defaults.color, DEFAULT_PERSONA_COLOR)
  assert.equal(defaults.body, 'b')
})

test('normalizePersonaInput enforces DESIGN §3 limits', () => {
  const invalid = [
    null,
    [],
    'string',
    { body: 'b' },
    { name: '   ', body: 'b' },
    { name: 'n'.repeat(81), body: 'b' },
    { name: 'n', body: '   ' },
    { name: 'n', body: 'b'.repeat(20001) },
    { name: 'n', body: 'b', description: 'd'.repeat(301) },
    { name: 'n', body: 'b', description: 42 },
    { name: 'n', body: 'b', emoji: '123456789' },
    { name: 'n', body: 'b', emoji: 1 },
    { name: 'n', body: 'b', color: 'red' },
    { name: 'n', body: 'b', color: '#12345' },
    { name: 'n', body: 'b', color: 123 },
  ]
  for (const input of invalid) {
    assert.throws(
      () => normalizePersonaInput(input),
      (error) => error instanceof PersonaValidationError && error.code === 'invalid-persona',
      `expected invalid-persona for ${JSON.stringify(input)}`,
    )
  }
  // Boundaries are accepted.
  const limits = normalizePersonaInput({
    name: 'n'.repeat(80),
    body: 'b'.repeat(20000),
    description: 'd'.repeat(300),
    emoji: '\u{1F1E8}\u{1F1F3}\u{1F1EF}\u{1F1F5}',
  })
  assert.equal(limits.name.length, 80)
  assert.equal(limits.body.length, 20000)
  assert.equal(limits.description.length, 300)
})

test('normalizePersonaPatch validates only present fields', () => {
  assert.deepEqual(normalizePersonaPatch({}), {})
  assert.deepEqual(normalizePersonaPatch({ name: ' 新名 ', unknown: true }), { name: '新名' })
  assert.deepEqual(normalizePersonaPatch({ description: null, emoji: null, color: null }), {
    description: '',
    emoji: DEFAULT_PERSONA_EMOJI,
    color: DEFAULT_PERSONA_COLOR,
  })
  assert.deepEqual(normalizePersonaPatch({ body: '新正文' }), { body: '新正文' })
  assert.throws(() => normalizePersonaPatch({ name: '' }), PersonaValidationError)
  assert.throws(() => normalizePersonaPatch(null), PersonaValidationError)
})

test('create / get / list: server-owned ids and createdAt ordering', async () => {
  const { store } = makeStore()
  assert.equal(store.mode, 'memory')
  assert.deepEqual(store.list(), [])

  const first = await store.create({ name: '一', body: '正文一', id: 'p_client_chosen' })
  const second = await store.create({ name: '二', body: '正文二' })
  assert.notEqual(first.id, 'p_client_chosen')
  assert.match(first.id, PERSONA_ID_RE)
  assert.match(second.id, PERSONA_ID_RE)
  assert.notEqual(first.id, second.id)
  assert.equal(first.createdAt, first.updatedAt)
  assert.ok(second.createdAt > first.createdAt)
  assert.deepEqual(
    store.list().map((persona) => persona.id),
    [first.id, second.id],
  )
  assert.deepEqual(store.get(first.id), first)
  assert.equal(store.get('p_missing'), undefined)
  assert.equal(store.get(''), undefined)
  assert.equal(store.get(undefined), undefined)
})

test('update merges a subset and rejects unknown ids', async () => {
  const { store } = makeStore()
  const persona = await store.create({ name: '旧名', body: '旧正文', color: '#111111' })
  const updated = await store.update(persona.id, { name: '新名', color: '#222222', bogus: 1 })
  assert.equal(updated.id, persona.id)
  assert.equal(updated.name, '新名')
  assert.equal(updated.color, '#222222')
  assert.equal(updated.body, '旧正文')
  assert.equal(updated.createdAt, persona.createdAt)
  assert.ok(updated.updatedAt > persona.updatedAt)
  assert.deepEqual(store.get(persona.id), updated)

  await assert.rejects(
    () => store.update('p_missing', { name: 'x' }),
    (error) => error instanceof PersonaNotFoundError && error.code === 'not-found',
  )
  await assert.rejects(() => store.update(persona.id, { body: '' }), PersonaValidationError)
})

test('effectivePersonaId follows session override then global default', async () => {
  const { store } = makeStore()
  const first = await store.create({ name: '全局', body: 'GLOBAL' })
  const second = await store.create({ name: '会话', body: 'SESSION' })

  assert.equal(store.effectivePersonaId(), null)
  assert.equal(store.effectivePersonaId('sess-a'), null)
  assert.equal(store.effectivePersona('sess-a'), null)

  assert.equal(await store.switchGlobal(first.id), first.id)
  assert.equal(store.getGlobal().activePersonaId, first.id)
  assert.equal(store.effectivePersonaId(), first.id)
  assert.equal(store.effectivePersonaId('sess-a'), first.id)
  assert.equal(store.effectivePersona('sess-a').body, 'GLOBAL')

  assert.equal(await store.switchSession('sess-a', second.id), second.id)
  assert.equal(store.effectivePersonaId('sess-a'), second.id)
  assert.equal(store.effectivePersonaId('sess-b'), first.id)

  // A record with personaId null is the explicit "no persona" state of §3.
  assert.equal(await store.switchSession('sess-c', null), null)
  assert.equal(store.effectivePersonaId('sess-c'), null)
  assert.deepEqual(store.stateFor('sess-c').session, { personaId: null })

  // clearSession deletes the record so the session follows the global default.
  assert.equal(await store.clearSession('sess-a'), first.id)
  assert.equal(store.stateFor('sess-a').session, null)
  assert.equal(await store.clearSession('sess-a'), first.id)
})

test('dangling references fall back to the global default', async () => {
  const { store, domain } = makeStore()
  const globalPersona = await store.create({ name: '全局', body: 'GLOBAL' })
  await store.switchGlobal(globalPersona.id)
  // Simulate a stored session that references a persona that no longer exists.
  await domain.table('sessions').put('sess-dangling', { personaId: 'p_gone', updatedAt: 1 })
  assert.equal(store.effectivePersonaId('sess-dangling'), globalPersona.id)
  // A dangling global default resolves to no persona.
  await store.setGlobal({ activePersonaId: 'p_gone' })
  assert.equal(store.effectivePersonaId(), null)
})

test('switch validation: unknown per-session/global ids and bad session ids', async () => {
  const { store } = makeStore()
  const persona = await store.create({ name: 'n', body: 'b' })
  await assert.rejects(
    () => store.switchGlobal('p_missing'),
    (error) => error instanceof PersonaNotFoundError && error.code === 'persona-not-found',
  )
  await assert.rejects(
    () => store.switchSession('sess', 'p_missing'),
    (error) => error instanceof PersonaNotFoundError && error.code === 'persona-not-found',
  )
  await assert.rejects(
    () => store.switchSession('sess', '../escape'),
    (error) => error instanceof PersonaNotFoundError && error.code === 'persona-not-found',
  )
  await assert.rejects(() => store.switchSession('   ', persona.id), PersonaValidationError)
  await assert.rejects(() => store.clearSession(undefined), PersonaValidationError)
  assert.equal(await store.switchGlobal(null), null)
})

test('remove scrubs the global default and session overrides', async () => {
  const { store } = makeStore()
  const doomed = await store.create({ name: '将删', body: 'X' })
  const keeper = await store.create({ name: '保留', body: 'Y' })
  await store.switchGlobal(doomed.id)
  await store.switchSession('sess-1', doomed.id)
  await store.switchSession('sess-2', keeper.id)
  await store.switchSession('sess-3', doomed.id)

  const result = await store.remove(doomed.id)
  assert.deepEqual(result, { ok: true, clearedGlobal: true, clearedSessions: 2 })
  assert.equal(store.get(doomed.id), undefined)
  assert.equal(store.getGlobal().activePersonaId, null)
  assert.deepEqual(store.stateFor('sess-1').session, { personaId: null })
  assert.equal(store.effectivePersonaId('sess-1'), null)
  assert.deepEqual(store.stateFor('sess-2').session, { personaId: keeper.id })
  assert.equal(store.effectivePersonaId('sess-2'), keeper.id)

  const second = await store.remove(keeper.id)
  assert.deepEqual(second, { ok: true, clearedGlobal: false, clearedSessions: 1 })
  await assert.rejects(
    () => store.remove(doomed.id),
    (error) => error instanceof PersonaNotFoundError && error.code === 'not-found',
  )
})

test('stateFor matches the §7 state document', async () => {
  const { store } = makeStore()
  const first = await store.create({ name: '一', body: 'A' })
  const second = await store.create({ name: '二', body: 'B' })
  await store.switchGlobal(second.id)
  await store.switchSession('sess-1', first.id)

  const globalState = store.stateFor()
  assert.deepEqual(globalState, {
    version: 1,
    personas: [first, second],
    global: { activePersonaId: second.id },
    session: null,
    effectivePersonaId: second.id,
  })
  const sessionState = store.stateFor('sess-1')
  assert.deepEqual(sessionState.session, { personaId: first.id })
  assert.equal(sessionState.effectivePersonaId, first.id)
  assert.deepEqual(store.stateFor('').session, null)
})

test('stored-record normalizers are tolerant where the medium can be stale', () => {
  assert.deepEqual(normalizeGlobal(undefined), { activePersonaId: null, seeded: false })
  assert.deepEqual(normalizeGlobal(null), { activePersonaId: null, seeded: false })
  assert.deepEqual(normalizeGlobal({ activePersonaId: 42, seeded: 'yes' }), {
    activePersonaId: null,
    seeded: false,
  })
  assert.deepEqual(normalizeGlobal('garbage'), { activePersonaId: null, seeded: false })

  assert.deepEqual(normalizeStoredSession({ personaId: 'p_ok', updatedAt: 12 }), {
    personaId: 'p_ok',
    updatedAt: 12,
  })
  assert.deepEqual(normalizeStoredSession({ personaId: 'not valid!', updatedAt: -1 }), {
    personaId: null,
    updatedAt: 0,
  })
  assert.deepEqual(normalizeStoredSession(null), { personaId: null, updatedAt: 0 })

  const stored = normalizeStoredPersona({
    id: 'p_abc',
    name: ' 名 ',
    body: ' 正文 ',
    createdAt: 10,
    updatedAt: 20,
    extra: 'dropped',
  })
  assert.deepEqual(stored, {
    id: 'p_abc',
    name: '名',
    description: '',
    body: '正文',
    emoji: DEFAULT_PERSONA_EMOJI,
    color: DEFAULT_PERSONA_COLOR,
    createdAt: 10,
    updatedAt: 20,
  })
  assert.throws(() => normalizeStoredPersona(null), PersonaValidationError)
  assert.throws(() => normalizeStoredPersona({ id: 'bad id!', name: 'n', body: 'b', createdAt: 1 }), PersonaValidationError)
  assert.throws(() => normalizeStoredPersona({ id: 'p_ok', name: 'n', body: 'b', createdAt: -1 }), PersonaValidationError)
})

test('ensureSeeded seeds once and never resurrects deleted personas', async () => {
  // Empty + unseeded → create the built-in persona and make it global.
  const fresh = makeStore().store
  const seeded = await ensureSeeded(fresh)
  assert.ok(seeded)
  assert.equal(seeded.name, SEED_PERSONA.name)
  assert.equal(seeded.body, SEED_PERSONA.body)
  assert.equal(seeded.emoji, '🐋')
  assert.equal(seeded.color, '#3b82f6')
  assert.equal(fresh.getGlobal().seeded, true)
  assert.equal(fresh.getGlobal().activePersonaId, seeded.id)
  assert.equal(fresh.list().length, 1)

  // Second call is a no-op.
  assert.equal(await ensureSeeded(fresh), null)
  assert.equal(fresh.list().length, 1)

  // User deletes everything, then restarts: seeded stays true, no resurrection.
  await fresh.remove(seeded.id)
  assert.deepEqual(fresh.list(), [])
  assert.equal(await ensureSeeded(fresh), null)
  assert.deepEqual(fresh.list(), [])

  // Non-empty but unseeded data is never overridden; only the flag is set.
  const foreign = makeStore().store
  const custom = await foreign.create({ name: '自定义', body: 'CUSTOM' })
  assert.equal(await ensureSeeded(foreign), null)
  assert.equal(foreign.list().length, 1)
  assert.equal(foreign.get(custom.id).name, '自定义')
  assert.equal(foreign.getGlobal().seeded, true)
  assert.equal(foreign.getGlobal().activePersonaId, null)
})
