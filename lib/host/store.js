/**
 * Persona Manager · host store.
 *
 * Pure data logic: the hand-written storage-domain spec (DESIGN §4), record
 * normalization (DESIGN §3), and the CRUD / switch / effective-state API that
 * the prompt sections and the HTTP routes consume (DESIGN §5).
 *
 * No Cordis or host-package imports: the domain runtime only calls
 * `.parse()` on the schemas declared here, so plain validator functions are
 * enough. Reads are synchronous from the domain's in-memory tables; writes are
 * awaited so the medium is durable before the caller sees success.
 */

import { randomBytes } from 'node:crypto'

/** Domain name → `$DSH_HOME/storages/persona_manager.json`. */
export const PERSONA_DOMAIN_NAME = 'persona_manager'

/** Domain format version. */
export const PERSONA_DOMAIN_VERSION = 1

/** Persona id shape. Server-generated ids always match it. */
export const PERSONA_ID_RE = /^[a-zA-Z0-9_-]+$/

/** `#rrggbb` color shape. */
export const PERSONA_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Field limits shared by the server validator and documented to the client. */
export const PERSONA_LIMITS = Object.freeze({
  nameMax: 80,
  bodyMax: 20000,
  descriptionMax: 300,
  emojiMax: 8,
  sessionIdMax: 512,
})

/** Default emoji when none is given. */
export const DEFAULT_PERSONA_EMOJI = '🎭'

/** Default color when none is given. */
export const DEFAULT_PERSONA_COLOR = '#6b7280'

/** Initial global document when the medium holds none. */
export const INITIAL_GLOBAL = Object.freeze({ activePersonaId: null, seeded: false })

/** Table names of the persona_manager domain. */
export const PERSONA_TABLES = Object.freeze(['personas', 'sessions'])

/** Suffix alphabet for generated persona ids. */
const ID_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * A persona payload violated the §3 validation rules.
 * `code` is the stable discriminator the HTTP layer maps to 400.
 */
export class PersonaValidationError extends Error {
  /**
   * @param {string} message - Human readable detail.
   * @param {unknown} [details] - Optional machine readable detail.
   */
  constructor(message, details) {
    super(message)
    this.name = 'PersonaValidationError'
    this.code = 'invalid-persona'
    if (details !== undefined) this.details = details
  }
}

/**
 * A persona was not found (or no longer exists).
 * `code` is `not-found` for unknown ids and `persona-not-found` when a switch
 * referenced a persona that does not exist.
 */
export class PersonaNotFoundError extends Error {
  /**
   * @param {string} [message] - Human readable detail.
   * @param {string} [code] - `not-found` (default) or `persona-not-found`.
   */
  constructor(message = 'persona not found', code = 'not-found') {
    super(message)
    this.name = 'PersonaNotFoundError'
    this.code = code
  }
}

/** @returns whether `value` is a plain JSON object. */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns whether `value` is a syntactically valid persona id. */
export function isPersonaId(value) {
  return typeof value === 'string' && PERSONA_ID_RE.test(value)
}

/** @returns four random lowercase base-36 characters. */
function randomPersonaIdSuffix() {
  const bytes = randomBytes(4)
  let suffix = ''
  for (let index = 0; index < 4; index += 1) {
    suffix += ID_SUFFIX_ALPHABET[bytes[index] % ID_SUFFIX_ALPHABET.length]
  }
  return suffix
}

/** Require a string field, or throw the §3 validation error. */
function requireString(raw, field) {
  if (typeof raw !== 'string') {
    throw new PersonaValidationError(`persona ${field} is required and must be a string`)
  }
  return raw
}

/** §3: name — required string, trimmed, 1–80 characters. */
function normalizeName(raw) {
  const value = requireString(raw, 'name').trim()
  if (value.length === 0) throw new PersonaValidationError('persona name must not be empty')
  if (value.length > PERSONA_LIMITS.nameMax) {
    throw new PersonaValidationError(
      `persona name must be at most ${PERSONA_LIMITS.nameMax} characters (got ${value.length})`,
    )
  }
  return value
}

/** §3: body — required string, trimmed, 1–20000 characters, newlines preserved. */
function normalizeBody(raw) {
  const value = requireString(raw, 'body').trim()
  if (value.length === 0) throw new PersonaValidationError('persona body must not be empty')
  if (value.length > PERSONA_LIMITS.bodyMax) {
    throw new PersonaValidationError(
      `persona body must be at most ${PERSONA_LIMITS.bodyMax} characters (got ${value.length})`,
    )
  }
  return value
}

/** §3: description — optional string, ≤300 characters, default `''`. */
function normalizeDescription(raw) {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') throw new PersonaValidationError('persona description must be a string')
  const value = raw.trim()
  if (value.length > PERSONA_LIMITS.descriptionMax) {
    throw new PersonaValidationError(
      `persona description must be at most ${PERSONA_LIMITS.descriptionMax} characters (got ${value.length})`,
    )
  }
  return value
}

/** §3: emoji — optional string, ≤8 UTF-16 code units, default `🎭`. */
function normalizeEmoji(raw) {
  if (raw === undefined || raw === null) return DEFAULT_PERSONA_EMOJI
  if (typeof raw !== 'string') throw new PersonaValidationError('persona emoji must be a string')
  const value = raw.trim()
  if (value.length === 0) return DEFAULT_PERSONA_EMOJI
  if (value.length > PERSONA_LIMITS.emojiMax) {
    throw new PersonaValidationError(
      `persona emoji must be at most ${PERSONA_LIMITS.emojiMax} UTF-16 code units (got ${value.length})`,
    )
  }
  return value
}

/** §3: color — optional `#rrggbb`, default `#6b7280`. */
function normalizeColor(raw) {
  if (raw === undefined || raw === null) return DEFAULT_PERSONA_COLOR
  if (typeof raw !== 'string') throw new PersonaValidationError('persona color must be a string')
  const value = raw.trim()
  if (!PERSONA_COLOR_RE.test(value)) {
    throw new PersonaValidationError('persona color must match #rrggbb')
  }
  return value
}

/** Build a stored persona in the §3 field order. */
function buildPersonaRecord({ id, name, description, body, emoji, color, createdAt, updatedAt }) {
  return { id, name, description, body, emoji, color, createdAt, updatedAt }
}

/**
 * Normalize a full persona payload. Unknown fields are dropped; server-owned
 * fields (`id`, `createdAt`, `updatedAt`) are never read from the payload.
 *
 * @param {unknown} input - Untrusted JSON payload.
 * @returns {{ name: string, description: string, body: string, emoji: string, color: string }}
 * @throws {PersonaValidationError} When a §3 rule is violated.
 */
export function normalizePersonaInput(input) {
  if (!isPlainObject(input)) throw new PersonaValidationError('persona payload must be a JSON object')
  return {
    name: normalizeName(input.name),
    description: normalizeDescription(input.description),
    body: normalizeBody(input.body),
    emoji: normalizeEmoji(input.emoji),
    color: normalizeColor(input.color),
  }
}

/**
 * Normalize a partial persona patch (PUT). Only fields present in the patch
 * are validated and returned; unknown fields are dropped. `null` on an
 * optional field restores its default.
 *
 * @param {unknown} patch - Untrusted JSON payload.
 * @returns {object} The validated subset of updatable fields.
 * @throws {PersonaValidationError} When a provided field violates §3.
 */
export function normalizePersonaPatch(patch) {
  if (!isPlainObject(patch)) throw new PersonaValidationError('persona payload must be a JSON object')
  const result = {}
  if (Object.hasOwn(patch, 'name') && patch.name !== undefined) result.name = normalizeName(patch.name)
  if (Object.hasOwn(patch, 'description') && patch.description !== undefined) {
    result.description = normalizeDescription(patch.description)
  }
  if (Object.hasOwn(patch, 'body') && patch.body !== undefined) result.body = normalizeBody(patch.body)
  if (Object.hasOwn(patch, 'emoji') && patch.emoji !== undefined) result.emoji = normalizeEmoji(patch.emoji)
  if (Object.hasOwn(patch, 'color') && patch.color !== undefined) result.color = normalizeColor(patch.color)
  return result
}

/**
 * Validate one persona record loaded from the medium. A throw makes the domain
 * report `invalid-record` for this table/key.
 *
 * @param {unknown} raw - Stored JSON value.
 * @returns {object} Normalized persona record including `id`/timestamps.
 * @throws {PersonaValidationError} When the record is not a valid persona.
 */
export function normalizeStoredPersona(raw) {
  if (!isPlainObject(raw)) throw new PersonaValidationError('stored persona record is not an object')
  if (!isPersonaId(raw.id)) throw new PersonaValidationError('stored persona record has an invalid id')
  const fields = normalizePersonaInput(raw)
  if (!Number.isFinite(raw.createdAt) || raw.createdAt < 0) {
    throw new PersonaValidationError('stored persona record has an invalid createdAt')
  }
  const updatedAt = raw.updatedAt === undefined ? raw.createdAt : raw.updatedAt
  if (!Number.isFinite(updatedAt) || updatedAt < 0) {
    throw new PersonaValidationError('stored persona record has an invalid updatedAt')
  }
  return buildPersonaRecord({
    id: raw.id,
    name: fields.name,
    description: fields.description,
    body: fields.body,
    emoji: fields.emoji,
    color: fields.color,
    createdAt: raw.createdAt,
    updatedAt,
  })
}

/**
 * Tolerant normalization of the domain global document. Corruption degrades to
 * the initial document instead of failing the whole domain open, so the plugin
 * can always load.
 *
 * @param {unknown} raw - Stored global JSON value.
 * @returns {{ activePersonaId: string | null, seeded: boolean }}
 */
export function normalizeGlobal(raw) {
  const value = isPlainObject(raw) ? raw : {}
  return {
    activePersonaId: isPersonaId(value.activePersonaId) ? value.activePersonaId : null,
    seeded: value.seeded === true,
  }
}

/**
 * Tolerant normalization of one stored session override. Corruption degrades
 * to an explicit "no persona" record, which is safer than guessing a persona.
 *
 * @param {unknown} raw - Stored session JSON value.
 * @returns {{ personaId: string | null, updatedAt: number }}
 */
export function normalizeStoredSession(raw) {
  if (!isPlainObject(raw)) return { personaId: null, updatedAt: 0 }
  const personaId = isPersonaId(raw.personaId) ? raw.personaId : null
  const updatedAt = Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? raw.updatedAt : 0
  return { personaId, updatedAt }
}

/**
 * Hand-written storage-domain spec (DESIGN §4). `defineDomain` cannot be used
 * from a workspace plugin, so this plain object relies only on the fields the
 * domain runtime actually reads: `schema.parse` / `valueSchema.parse`.
 */
export const STORAGE_DOMAIN_SPEC = {
  name: PERSONA_DOMAIN_NAME,
  version: PERSONA_DOMAIN_VERSION,
  layout: 'single',
  invalidRecords: 'backup-and-skip',
  global: {
    schema: { parse: (raw) => normalizeGlobal(raw) },
    initial: { activePersonaId: null, seeded: false },
  },
  tables: {
    personas: { valueSchema: { parse: (raw) => normalizeStoredPersona(raw) } },
    sessions: { valueSchema: { parse: (raw) => normalizeStoredSession(raw) } },
  },
}

/**
 * In-memory stand-in for the storage-domain handle. Used when `storageDomain`
 * is missing or `open()` fails: the plugin still loads, injects personas, and
 * serves the API — it simply does not persist across restarts.
 *
 * The surface mirrors the real handle: `table(name)` returns a synchronous-read
 * table and `global` a get/set pair, so `createStore` cannot tell them apart.
 *
 * @param {object} [spec] - Domain spec whose table/global declarations to follow.
 * @returns {object} A domain-like handle with `mode: 'memory'`.
 */
export function createMemoryDomain(spec = STORAGE_DOMAIN_SPEC) {
  const declaredTables = new Set(Object.keys(spec?.tables ?? { personas: {}, sessions: {} }))
  const tables = new Map()
  let globalValue = normalizeGlobal(spec?.global?.initial ?? INITIAL_GLOBAL)
  let closed = false

  const assertReadable = () => {
    if (closed) throw new Error('persona-manager: in-memory domain is closed')
  }

  /**
   * @param {string} name - Declared table name.
   * @returns {object} Table handle mirroring the domain runtime.
   */
  function table(name) {
    if (!declaredTables.has(name)) {
      throw new Error(`persona-manager: in-memory domain declares no table '${String(name)}'`)
    }
    let records = tables.get(name)
    if (records === undefined) {
      records = new Map()
      tables.set(name, records)
    }
    return {
      get(key) {
        assertReadable()
        return records.get(key)
      },
      entries() {
        assertReadable()
        return [...records.entries()][Symbol.iterator]()
      },
      keys() {
        assertReadable()
        return [...records.keys()][Symbol.iterator]()
      },
      get size() {
        assertReadable()
        return records.size
      },
      async put(key, value) {
        assertReadable()
        records.set(key, value)
      },
      async delete(key) {
        assertReadable()
        return records.delete(key)
      },
      async update(key, update) {
        assertReadable()
        const next = update(records.get(key))
        records.set(key, next)
        return next
      },
    }
  }

  return {
    mode: 'memory',
    table,
    global: {
      get() {
        assertReadable()
        return globalValue
      },
      async set(value) {
        assertReadable()
        globalValue = value
      },
    },
    async close() {
      closed = true
    },
  }
}

/**
 * Create the store facade over an open domain handle.
 *
 * @param {object} options - Dependencies.
 * @param {object} options.domain - Open storage domain handle (or memory domain).
 * @param {object} [options.logger] - Optional Cordis logger (`info`/`warn`/`error`).
 * @param {object} [options.clock] - Optional clock for deterministic tests.
 * @param {() => number} [options.clock.now] - Millisecond timestamp source.
 * @param {() => string} [options.clock.suffix] - Four-character id suffix source.
 * @param {'storage' | 'memory'} [options.mode] - Store mode override.
 * @returns {object} Store API consumed by `index.js`, `prompt.js`, and `http.js`.
 */
export function createStore({ domain, logger, clock, mode } = {}) {
  if (!domain || typeof domain.table !== 'function') {
    throw new Error('persona-manager: createStore requires an open domain handle')
  }
  const personaTable = domain.table('personas')
  const sessionTable = domain.table('sessions')
  const globalHandle = domain.global
  if (!globalHandle || typeof globalHandle.get !== 'function' || typeof globalHandle.set !== 'function') {
    throw new Error('persona-manager: createStore requires a domain with a global slot')
  }

  const now = typeof clock?.now === 'function' ? clock.now : Date.now
  const suffix = typeof clock?.suffix === 'function' ? clock.suffix : randomPersonaIdSuffix
  const storeMode = mode ?? (domain.mode === 'memory' ? 'memory' : 'storage')

  if (logger?.debug) logger.debug(`persona-manager: store ready (mode=${storeMode})`)

  /** @returns {{ activePersonaId: string | null, seeded: boolean }} */
  function getGlobal() {
    return normalizeGlobal(globalHandle.get())
  }

  /** Merge a validated global patch and persist it. */
  async function setGlobal(patch) {
    const current = getGlobal()
    const provided = isPlainObject(patch) ? patch : {}
    const next = normalizeGlobal({ ...current, ...provided })
    await globalHandle.set(next)
    return next
  }

  /** Generate a `p_<base36 time><4 random chars>` id that is not in use. */
  function generatePersonaId() {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const id = `p_${now().toString(36)}${suffix()}`
      if (!isPersonaId(id)) continue
      if (personaTable.get(id) === undefined) return id
    }
    throw new Error('persona-manager: could not allocate a unique persona id')
  }

  /** @returns {object[]} Personas sorted by `createdAt` ascending (old → new). */
  function list() {
    return [...personaTable.entries()]
      .map(([, persona]) => persona)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /**
   * @param {string} id - Persona id.
   * @returns {object | undefined} The persona record, or undefined.
   */
  function get(id) {
    if (typeof id !== 'string' || id.length === 0) return undefined
    return personaTable.get(id)
  }

  /** @returns {object} The persona, or throws `not-found`. */
  function requirePersona(id) {
    const persona = get(id)
    if (persona === undefined) throw new PersonaNotFoundError(`persona not found: ${String(id)}`)
    return persona
  }

  /**
   * Create one persona. `id`/`createdAt`/`updatedAt` are server-owned.
   *
   * @param {unknown} input - Untrusted create payload.
   * @returns {Promise<object>} The created persona.
   */
  async function create(input) {
    const fields = normalizePersonaInput(input)
    const timestamp = now()
    const persona = buildPersonaRecord({
      id: generatePersonaId(),
      name: fields.name,
      description: fields.description,
      body: fields.body,
      emoji: fields.emoji,
      color: fields.color,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await personaTable.put(persona.id, persona)
    return persona
  }

  /**
   * Update a subset of persona fields.
   *
   * @param {string} id - Persona id.
   * @param {unknown} patch - Untrusted partial payload.
   * @returns {Promise<object>} The updated persona.
   */
  async function update(id, patch) {
    const existing = requirePersona(id)
    const fields = normalizePersonaPatch(patch)
    const next = { ...existing, ...fields, updatedAt: now() }
    await personaTable.put(id, next)
    return next
  }

  /**
   * Delete a persona and scrub references from the global default and every
   * session override (DESIGN §4: put `personaId: null`, keeping the explicit
   * override record).
   *
   * @param {string} id - Persona id.
   * @returns {Promise<{ ok: true, clearedGlobal: boolean, clearedSessions: number }>}
   */
  async function remove(id) {
    requirePersona(id)
    const global = getGlobal()
    let clearedGlobal = false
    if (global.activePersonaId === id) {
      await globalHandle.set({ ...global, activePersonaId: null })
      clearedGlobal = true
    }
    let clearedSessions = 0
    for (const [sessionId, rawRecord] of [...sessionTable.entries()]) {
      const record = normalizeStoredSession(rawRecord)
      if (record.personaId !== id) continue
      await sessionTable.put(sessionId, { personaId: null, updatedAt: now() })
      clearedSessions += 1
    }
    await personaTable.delete(id)
    return { ok: true, clearedGlobal, clearedSessions }
  }

  /** Validate a session id for the store API. */
  function requireSessionId(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new PersonaValidationError('sessionId is required and must be a non-empty string')
    }
    const value = sessionId.trim()
    if (value.length > PERSONA_LIMITS.sessionIdMax) {
      throw new PersonaValidationError(
        `sessionId must be at most ${PERSONA_LIMITS.sessionIdMax} characters (got ${value.length})`,
      )
    }
    return value
  }

  /**
   * §3 effective persona resolution for one session.
   *
   * @param {string} [sessionId] - Session id; omitted/empty resolves the global default.
   * @returns {string | null} The effective persona id, or null for "no persona".
   */
  function effectivePersonaId(sessionId) {
    const normalizedSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : undefined
    if (normalizedSessionId !== undefined) {
      const rawSession = sessionTable.get(normalizedSessionId)
      if (rawSession !== undefined) {
        const record = normalizeStoredSession(rawSession)
        if (record.personaId === null) return null
        if (personaTable.get(record.personaId) !== undefined) return record.personaId
        // The referenced persona was deleted: fall back to the global default.
      }
    }
    const global = getGlobal()
    if (global.activePersonaId !== null && personaTable.get(global.activePersonaId) !== undefined) {
      return global.activePersonaId
    }
    return null
  }

  /**
   * @param {string} [sessionId] - Session id.
   * @returns {object | null} The effective persona record, or null.
   */
  function effectivePersona(sessionId) {
    const id = effectivePersonaId(sessionId)
    if (id === null) return null
    return personaTable.get(id) ?? null
  }

  /**
   * Switch the global default. `null` clears it.
   *
   * @param {string | null} personaId - Target persona id or null.
   * @returns {Promise<string | null>} The effective persona id after the switch.
   */
  async function switchGlobal(personaId) {
    if (personaId === null) {
      await setGlobal({ activePersonaId: null })
      return effectivePersonaId()
    }
    if (!isPersonaId(personaId) || personaTable.get(personaId) === undefined) {
      throw new PersonaNotFoundError(`persona not found: ${String(personaId)}`, 'persona-not-found')
    }
    await setGlobal({ activePersonaId: personaId })
    return effectivePersonaId()
  }

  /**
   * Write one explicit session override. `personaId: null` records "this
   * session explicitly uses no persona" (DESIGN §3); to follow the global
   * default again use {@link clearSession}.
   *
   * @param {string} sessionId - Session id.
   * @param {string | null} personaId - Persona id or null.
   * @returns {Promise<string | null>} The effective persona id after the switch.
   */
  async function switchSession(sessionId, personaId) {
    const id = requireSessionId(sessionId)
    if (personaId !== null) {
      if (!isPersonaId(personaId) || personaTable.get(personaId) === undefined) {
        throw new PersonaNotFoundError(`persona not found: ${String(personaId)}`, 'persona-not-found')
      }
    }
    await sessionTable.put(id, { personaId, updatedAt: now() })
    return effectivePersonaId(id)
  }

  /**
   * Drop one session override so the session inherits the global default again.
   *
   * @param {string} sessionId - Session id.
   * @returns {Promise<string | null>} The effective persona id after the clear.
   */
  async function clearSession(sessionId) {
    const id = requireSessionId(sessionId)
    await sessionTable.delete(id)
    return effectivePersonaId(id)
  }

  /**
   * The full state document served by `GET /state` (DESIGN §7).
   *
   * @param {string} [sessionId] - Optional session id.
   * @returns {object} `{ version, personas, global, session, effectivePersonaId }`.
   */
  function stateFor(sessionId) {
    const normalizedSessionId =
      typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : undefined
    const rawSession = normalizedSessionId === undefined ? undefined : sessionTable.get(normalizedSessionId)
    return {
      version: 1,
      personas: list(),
      global: { activePersonaId: getGlobal().activePersonaId },
      session: rawSession === undefined ? null : { personaId: normalizeStoredSession(rawSession).personaId },
      effectivePersonaId: effectivePersonaId(normalizedSessionId),
    }
  }

  return {
    mode: storeMode,
    list,
    get,
    create,
    update,
    remove,
    getGlobal,
    setGlobal,
    switchGlobal,
    switchSession,
    clearSession,
    effectivePersonaId,
    effectivePersona,
    stateFor,
  }
}
