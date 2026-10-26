/**
 * @hxql/dsh-persona-manager — Host half.
 *
 * Wires the four pieces together (DESIGN §5):
 * 1. a storage-domain-backed store (in-memory fallback when `storageDomain` is
 *    missing or fails to open),
 * 2. first-run seeding of the built-in persona,
 * 3. one scoped `deployment:persona-prefix` prompt section per live agent,
 * 4. the `/persona-manager/api` HTTP routes when `webServer` is available.
 *
 * Hard dependencies: `systemPrompt` (prompt sections) and `storageDomain`
 * (persistent store). Declaring `storageDomain` makes Cordis activate this
 * plugin only after the storage service is mounted; without it a cold start
 * could race the service, silently degrade to the in-memory store, and hide
 * every persisted persona behind a freshly seeded default. `agents` and
 * `webServer` remain optional.
 */

import { createMemoryDomain, createStore, STORAGE_DOMAIN_SPEC } from './lib/host/store.js'
import { ensureSeeded } from './lib/host/seed.js'
import { createPersonaSections } from './lib/host/prompt.js'
import { registerHttp } from './lib/host/http.js'

/** Cordis plugin name (the package name). */
export const name = '@hxql/dsh-persona-manager'

/** Hard dependencies: the prompt registry and the persistent domain service. */
export const inject = ['systemPrompt', 'storageDomain']

/**
 * Open the storage domain, degrading to an in-memory domain on any failure.
 *
 * @param {object} ctx - Plugin context.
 * @param {object} logger - Cordis logger.
 * @returns {Promise<{ domain: object, mode: 'storage' | 'memory' }>}
 */
async function openDomain(ctx, logger) {
  const storageDomain = typeof ctx.get === 'function' ? ctx.get('storageDomain') : undefined
  if (storageDomain && typeof storageDomain.open === 'function') {
    try {
      const domain = await storageDomain.open(STORAGE_DOMAIN_SPEC)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => domain.close(), 'persona-manager: storage domain')
      }
      return { domain, mode: 'storage' }
    } catch (error) {
      logger?.error?.(
        'persona-manager: storage domain open failed; falling back to the in-memory store ' +
          `(persona data will NOT persist): ${String(error)}`,
      )
    }
  } else {
    logger?.error?.(
      'persona-manager: storageDomain service unavailable; using the in-memory store ' +
        '(persona data will NOT persist)',
    )
  }
  return { domain: createMemoryDomain(STORAGE_DOMAIN_SPEC), mode: 'memory' }
}

/**
 * Attach the persona section to every already-live agent and to every agent
 * created or disposed from now on. Works before the store is seeded: the
 * section text is resolved lazily on each prompt assembly.
 *
 * @param {object} ctx - Plugin context.
 * @param {object} sections - Controller from `createPersonaSections`.
 * @param {object} logger - Cordis logger.
 */
function attachAgentLifecycle(ctx, sections, logger) {
  const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
  if (agents && typeof agents.list === 'function') {
    let attached = 0
    for (const agent of agents.list()) {
      try {
        if (sections.attach(agent) !== undefined) attached += 1
      } catch (error) {
        logger?.warn?.(`persona-manager: failed to attach persona to existing agent: ${String(error)}`)
      }
    }
    if (attached > 0) logger?.info?.(`persona-manager: attached persona section to ${attached} existing agent(s)`)
  }

  if (typeof ctx.on !== 'function') return
  ctx.on('agent/created', ({ agent } = {}) => {
    if (!agent) return
    try {
      sections.attach(agent)
    } catch (error) {
      logger?.warn?.(`persona-manager: failed to attach persona on agent/created: ${String(error)}`)
    }
  })
  ctx.on('agent/disposed', ({ agent } = {}) => {
    if (!agent || typeof agent.id !== 'string') return
    try {
      sections.detach(agent.id)
    } catch (error) {
      logger?.warn?.(`persona-manager: failed to detach persona on agent/disposed: ${String(error)}`)
    }
  })
}

/**
 * Mount the persona manager.
 *
 * @param {object} ctx - Cordis plugin context (injects `systemPrompt`).
 * @param {object} [_config] - Row config; the plugin has no configurable options.
 * @returns {Promise<void>}
 */
export async function apply(ctx, _config) {
  const logger = ctx.logger

  const { domain, mode } = await openDomain(ctx, logger)
  const store = createStore({ domain, logger, mode })

  // Register lifecycle hooks before the first await so no agent can slip
  // between the existing-agent snapshot and the event listeners.
  const sections = createPersonaSections({ getStore: () => store, logger })
  attachAgentLifecycle(ctx, sections, logger)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => sections.disposeAll(), 'persona-manager: prompt sections')
  }

  try {
    const seeded = await ensureSeeded(store)
    if (seeded) logger?.info?.(`persona-manager: seeded default persona '${seeded.name}' (${seeded.id})`)
  } catch (error) {
    logger?.error?.(`persona-manager: first-run seeding failed: ${String(error)}`)
  }

  registerHttp(ctx, store)

  logger?.info?.(`persona-manager: ready (mode=${mode}, personas=${store.list().length})`)
}
