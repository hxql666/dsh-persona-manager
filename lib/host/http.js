/**
 * Persona Manager · HTTP API (DESIGN §7).
 *
 * One `prefix` route at `/persona-manager/api`, owned by the plugin and
 * registered only when the optional `webServer` service is present. The
 * handler owns the Node request/response pair directly.
 *
 * Routes:
 *   GET    /state?sessionId=<optional>
 *   POST   /personas
 *   PUT    /personas/<id>
 *   DELETE /personas/<id>
 *   POST   /switch
 *
 * Security: same-host Origin admission, 1 MiB body limit, method allow-lists,
 * id character allow-list, and a fixed JSON error envelope.
 */

import {
  API_PREFIX,
  HttpError,
  MAX_BODY_BYTES,
  isSameOrigin,
  parseApiPath,
  queryOf,
  readJsonBody,
  sendError,
  sendJson,
} from './http-util.js'
import { isPersonaId, isPlainObject } from './store.js'

export { API_PREFIX, MAX_BODY_BYTES }

/** Reply 405 with an `Allow` header. */
function methodNotAllowed(res, allow) {
  sendError(res, 405, 'method-not-allowed', `method not allowed; allowed methods: ${allow}`, { Allow: allow })
}

/**
 * Map any thrown value onto the §7 error envelope. Unexpected failures are
 * logged and answered with a generic 500 so internals never leak.
 *
 * @param {import('node:http').ServerResponse} res - Node response.
 * @param {unknown} error - Thrown value.
 * @param {object} [logger] - Optional Cordis logger.
 */
function handleRouteError(res, error, logger) {
  if (res?.headersSent) {
    try {
      res.destroy?.()
    } catch {
      /* response already unusable */
    }
    return
  }
  if (error instanceof HttpError) {
    sendError(res, error.status, error.code, error.message)
    return
  }
  const code = /** @type {{ code?: string }} */ (error)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'invalid-persona') {
    sendError(res, 400, 'invalid-persona', message)
    return
  }
  if (code === 'not-found' || code === 'persona-not-found') {
    sendError(res, 404, code, message)
    return
  }
  logger?.error?.(`persona-manager: API request failed: ${error instanceof Error ? error.stack ?? message : message}`)
  sendError(res, 500, 'internal', 'internal server error')
}

/**
 * Create the stateful API request handler. Exported for tests, which drive it
 * with fake Node request/response objects (no network).
 *
 * @param {object} options - Dependencies.
 * @param {() => object} options.getStore - Resolves the current store.
 * @param {object} [options.logger] - Optional Cordis logger.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createApiHandler({ getStore, logger } = {}) {
  if (typeof getStore !== 'function') throw new Error('persona-manager: createApiHandler requires getStore()')

  /** @returns {object} The store, or throws a 500-worthy error. */
  function requireStore() {
    const store = getStore()
    if (!store) throw new Error('persona-manager: store is not ready')
    return store
  }

  /**
   * GET /state?sessionId=<optional>
   * @returns {Promise<void>}
   */
  async function handleState(req, res, method) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET')
    const rawSessionId = queryOf(req.url).get('sessionId')
    const sessionId = rawSessionId !== null && rawSessionId.trim().length > 0 ? rawSessionId.trim() : undefined
    sendJson(res, 200, requireStore().stateFor(sessionId))
  }

  /**
   * POST /personas
   * @returns {Promise<void>}
   */
  async function handleCreatePersona(req, res, method) {
    if (method !== 'POST') return methodNotAllowed(res, 'POST')
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!isPlainObject(body)) throw new HttpError(400, 'invalid-body', 'request body must be a JSON object')
    const persona = await requireStore().create(body)
    sendJson(res, 201, { persona })
  }

  /**
   * PUT/DELETE /personas/<id>
   * @returns {Promise<void>}
   */
  async function handlePersonaById(req, res, method, id) {
    if (!isPersonaId(id)) return sendError(res, 404, 'not-found', 'unknown API path')
    if (method === 'PUT') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      if (!isPlainObject(body)) throw new HttpError(400, 'invalid-body', 'request body must be a JSON object')
      const persona = await requireStore().update(id, body)
      sendJson(res, 200, { persona })
      return
    }
    if (method === 'DELETE') {
      const result = await requireStore().remove(id)
      sendJson(res, 200, result)
      return
    }
    methodNotAllowed(res, 'PUT, DELETE')
  }

  /**
   * POST /switch
   *
   * `scope: 'global'` switches the global default. `scope: 'session'` writes a
   * session override, except `personaId: null`, which CLEARS the override so the
   * session follows the global default again (DESIGN §8 "跟随全局 / 清会话覆盖").
   * The explicit-null record of §3 remains a store-level primitive only.
   *
   * @returns {Promise<void>}
   */
  async function handleSwitch(req, res, method) {
    if (method !== 'POST') return methodNotAllowed(res, 'POST')
    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!isPlainObject(body)) throw new HttpError(400, 'invalid-body', 'request body must be a JSON object')
    const scope = body.scope
    if (scope !== 'global' && scope !== 'session') {
      throw new HttpError(400, 'invalid-body', 'scope must be "global" or "session"')
    }
    const personaId = body.personaId
    if (personaId !== null && typeof personaId !== 'string') {
      throw new HttpError(400, 'invalid-body', 'personaId must be a persona id string or null')
    }
    const store = requireStore()
    if (scope === 'global') {
      const effectivePersonaId = await store.switchGlobal(personaId)
      sendJson(res, 200, { ok: true, effectivePersonaId })
      return
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (sessionId.length === 0) {
      throw new HttpError(400, 'invalid-body', 'sessionId is required when scope is "session"')
    }
    const effectivePersonaId =
      personaId === null ? await store.clearSession(sessionId) : await store.switchSession(sessionId, personaId)
    sendJson(res, 200, { ok: true, effectivePersonaId })
  }

  /**
   * Route one API request.
   * @param {import('node:http').IncomingMessage} req - Node request.
   * @param {import('node:http').ServerResponse} res - Node response.
   * @returns {Promise<void>}
   */
  return async function handlePersonaApiRequest(req, res) {
    try {
      const method = typeof req?.method === 'string' ? req.method.toUpperCase() : 'GET'
      if (!isSameOrigin(req)) {
        sendError(res, 403, 'bad-origin', 'request Origin does not match Host')
        return
      }
      const parsed = parseApiPath(req?.url ?? '/')
      if (parsed === null) {
        sendError(res, 404, 'not-found', 'unknown API path')
        return
      }
      const segments = parsed.segments
      if (segments.length === 1 && segments[0] === 'state') {
        await handleState(req, res, method)
        return
      }
      if (segments.length === 1 && segments[0] === 'personas') {
        await handleCreatePersona(req, res, method)
        return
      }
      if (segments.length === 2 && segments[0] === 'personas') {
        await handlePersonaById(req, res, method, segments[1])
        return
      }
      if (segments.length === 1 && segments[0] === 'switch') {
        await handleSwitch(req, res, method)
        return
      }
      sendError(res, 404, 'not-found', 'unknown API path')
    } catch (error) {
      handleRouteError(res, error, logger)
    }
  }
}

/**
 * Register the API route on the optional `webServer` service. When the service
 * is absent the plugin still loads and works headless (persistence + persona
 * injection only); if it appears later, the route is registered then.
 *
 * @param {object} ctx - Plugin context.
 * @param {object | (() => object)} store - Store instance or a lazy getter.
 */
export function registerHttp(ctx, store) {
  const logger = ctx?.logger
  const getStore = typeof store === 'function' ? store : () => store
  const handler = createApiHandler({ getStore, logger })

  /** Register on one webServer instance; returns its disposer. */
  const registerOn = (webServer) => {
    if (!webServer || typeof webServer.register !== 'function') {
      logger?.warn?.('persona-manager: webServer has no register(); HTTP API disabled')
      return undefined
    }
    const dispose = webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
    logger?.info?.(`persona-manager: HTTP API registered at ${API_PREFIX}`)
    return dispose
  }

  const webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined
  if (webServer !== undefined && webServer !== null) {
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => registerOn(webServer), 'persona-manager: http')
      } else {
        registerOn(webServer)
      }
    } catch (error) {
      logger?.error?.(`persona-manager: failed to register HTTP API: ${String(error)}`)
    }
    return
  }

  logger?.info?.('persona-manager: webServer service unavailable; HTTP API disabled (headless/CLI mode)')
  if (typeof ctx?.inject !== 'function') return
  try {
    ctx.inject(['webServer'], (webCtx) => {
      const lateWebServer = typeof webCtx.get === 'function' ? webCtx.get('webServer') : undefined
      if (lateWebServer === undefined || lateWebServer === null) return
      webCtx.effect(() => registerOn(lateWebServer), 'persona-manager: http (late webServer)')
    })
  } catch (error) {
    logger?.warn?.(`persona-manager: deferred HTTP API registration failed: ${String(error)}`)
  }
}
