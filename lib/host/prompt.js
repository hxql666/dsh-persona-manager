/**
 * Persona Manager · per-agent persona prompt section.
 *
 * Every live agent gets one scoped system-prompt section named
 * `deployment:persona-prefix` (order 0) which shadows the deployment persona
 * for that session. The section text is a function, so switching personas
 * needs no re-registration: the next prompt assembly reads the store again
 * (DESIGN §5/§6).
 *
 * `interpolate: false` is mandatory — persona bodies are free text and may
 * contain `{{…}}`, which the prompt registry would otherwise try to resolve.
 *
 * If the same scoped name is already registered (a preset mounted the
 * official persona row on this agent), registration throws; the section
 * then falls back to `persona-manager:persona` (order 1), and the deployment
 * persona in that preset keeps its own prefix slot. No existing registration is
 * modified or disposed.
 */

/** Deployment persona prefix slot owner: the primary section name. */
export const PERSONA_SECTION_NAME = 'deployment:persona-prefix'

/** Fallback section name used when the primary slot is taken in that scope. */
export const FALLBACK_SECTION_NAME = 'persona-manager:persona'

/** Section order for the primary name (same placement as the slot's owner). */
export const PERSONA_SECTION_ORDER = 0

/** Section order for the fallback name (immediately after the slot). */
export const FALLBACK_SECTION_ORDER = 1

/**
 * Build the prompt-section controller.
 *
 * @param {object} options - Dependencies.
 * @param {() => object | undefined} options.getStore - Lazily resolves the current store.
 * @param {object} [options.logger] - Optional Cordis logger.
 * @returns {{
 *   attach: (agent: object, disposeHook?: Function) => Function | undefined,
 *   detach: (agentId: string) => void,
 *   disposeAll: () => void,
 *   size: () => number,
 * }} Controller used by `index.js` for the agent lifecycle hooks.
 */
export function createPersonaSections({ getStore, logger }) {
  /** @type {Map<string, Function>} agentId → disposer that also cleans the map. */
  const disposers = new Map()
  let fallbackLogged = false

  /**
   * Dynamic section text: read the effective persona at prompt-assembly time.
   *
   * @param {string} agentId - Agent/session id.
   * @returns {() => string} Section text provider.
   */
  function textFor(agentId) {
    return function personaSectionText() {
      try {
        const store = getStore()
        if (!store) return ''
        const persona = store.effectivePersona(agentId)
        return typeof persona?.body === 'string' ? persona.body : ''
      } catch (error) {
        logger?.warn?.(`persona-manager: failed to resolve persona for agent ${agentId}: ${String(error)}`)
        return ''
      }
    }
  }

  /** Register one section on the agent-scoped context. */
  function registerSection(agentCtx, agentId, name, order) {
    return agentCtx.systemPrompt.section({
      name,
      order,
      interpolate: false,
      text: textFor(agentId),
    })
  }

  /**
   * Attach the persona section to one live agent exactly once.
   *
   * @param {object} agent - Live agent (`agent.id` is the session id).
   * @param {(dispose: () => void) => void} [disposeHook] - Optional callback
   *   receiving the registered disposer, for callers that want their own handle.
   * @returns {Function | undefined} The disposer, or undefined when unattachable.
   */
  function attach(agent, disposeHook) {
    const agentId = agent?.id
    if (typeof agentId !== 'string' || agentId.length === 0) return undefined
    const existing = disposers.get(agentId)
    if (existing !== undefined) return existing

    const agentCtx = agent?.ctx
    if (!agentCtx) {
      logger?.warn?.(`persona-manager: agent ${agentId} has no scoped context; persona not attached`)
      return undefined
    }
    let sectionApi
    try {
      // A service read on a Cordis context can throw instead of returning
      // undefined; treat either as "this agent scope cannot host the section".
      sectionApi = agentCtx.systemPrompt
    } catch (error) {
      logger?.warn?.(
        `persona-manager: agent ${agentId} has no accessible scoped systemPrompt (${String(error)}); persona not attached`,
      )
      return undefined
    }
    if (typeof sectionApi?.section !== 'function' || typeof agentCtx.effect !== 'function') {
      logger?.warn?.(`persona-manager: agent ${agentId} has no scoped systemPrompt; persona not attached`)
      return undefined
    }

    let sectionDisposer
    try {
      sectionDisposer = registerSection(agentCtx, agentId, PERSONA_SECTION_NAME, PERSONA_SECTION_ORDER)
    } catch {
      try {
        sectionDisposer = registerSection(agentCtx, agentId, FALLBACK_SECTION_NAME, FALLBACK_SECTION_ORDER)
        if (!fallbackLogged) {
          fallbackLogged = true
          logger?.info?.(
            `persona-manager: '${PERSONA_SECTION_NAME}' is already registered in an agent scope; ` +
              `using fallback section '${FALLBACK_SECTION_NAME}' (order ${FALLBACK_SECTION_ORDER})`,
          )
        }
      } catch (fallbackError) {
        logger?.error?.(
          `persona-manager: failed to attach persona section for agent ${agentId}: ${String(fallbackError)}`,
        )
        return undefined
      }
    }

    let disposed = false
    /** Idempotent teardown: drop the section and this agent's map entry. */
    const disposeSection = () => {
      if (disposed) return
      disposed = true
      disposers.delete(agentId)
      try {
        sectionDisposer?.()
      } catch (error) {
        logger?.warn?.(`persona-manager: failed to dispose persona section for agent ${agentId}: ${String(error)}`)
      }
    }

    // Own the teardown in the agent scope as well, so an agent that disappears
    // without a dispatchable `agent/disposed` still cleans up. The disposer we
    // hand out is this effect's, and it is idempotent through `disposed`.
    let dispose
    try {
      dispose = agentCtx.effect(() => () => disposeSection())
    } catch (error) {
      logger?.warn?.(
        `persona-manager: could not own persona section teardown in agent ${agentId} scope: ${String(error)}`,
      )
      dispose = disposeSection
    }

    disposers.set(agentId, dispose)
    if (typeof disposeHook === 'function') {
      try {
        disposeHook(dispose)
      } catch (error) {
        logger?.warn?.(`persona-manager: attach dispose hook for agent ${agentId} failed: ${String(error)}`)
      }
    }
    return dispose
  }

  /**
   * Detach the persona section from one agent (safe to call repeatedly).
   *
   * @param {string} agentId - Agent/session id.
   */
  function detach(agentId) {
    const dispose = disposers.get(agentId)
    if (dispose === undefined) return
    disposers.delete(agentId)
    try {
      dispose()
    } catch (error) {
      logger?.warn?.(`persona-manager: failed to detach persona section for agent ${agentId}: ${String(error)}`)
    }
  }

  /** Detach every agent; used when the plugin itself unloads. */
  function disposeAll() {
    for (const agentId of [...disposers.keys()]) detach(agentId)
  }

  return {
    attach,
    detach,
    disposeAll,
    size: () => disposers.size,
  }
}
