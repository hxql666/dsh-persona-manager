/**
 * Unit tests for lib/host/prompt.js.
 *
 * Fake agent contexts mimic the two APIs the controller uses:
 * `agent.ctx.systemPrompt.section()` and `agent.ctx.effect()`.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FALLBACK_SECTION_NAME,
  FALLBACK_SECTION_ORDER,
  PERSONA_SECTION_NAME,
  PERSONA_SECTION_ORDER,
  createPersonaSections,
} from '../lib/host/prompt.js'
import { createMemoryDomain, createStore } from '../lib/host/store.js'

/** @returns a logger whose calls are inspectable. */
function makeLogger() {
  const records = { info: [], warn: [], error: [] }
  return {
    records,
    info: (message) => records.info.push(String(message)),
    warn: (message) => records.warn.push(String(message)),
    error: (message) => records.error.push(String(message)),
  }
}

/**
 * @param {object} [options] - Failure injection for the fake registry.
 * @returns {{ ctx: object, calls: object[] }} Fake agent context and its calls.
 */
function makeAgentCtx({ failPrimary = false, failAll = false } = {}) {
  const calls = []
  const ctx = {
    systemPrompt: {
      section(options) {
        if (failAll) throw new Error('section registry unavailable')
        if (failPrimary && options.name === PERSONA_SECTION_NAME) {
          throw new Error(`prompt section "${options.name}" is already registered in this scope`)
        }
        const record = { ...options }
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
  return { ctx, calls }
}

/** Fresh store over a memory domain. */
function makeStore() {
  return createStore({ domain: createMemoryDomain() })
}

test('attach registers the scoped deployment persona section', () => {
  const store = makeStore()
  const logger = makeLogger()
  const controller = createPersonaSections({ getStore: () => store, logger })
  const { ctx, calls } = makeAgentCtx()

  const dispose = controller.attach({ id: 'agent-1', ctx })
  assert.equal(typeof dispose, 'function')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'deployment:persona-prefix')
  assert.equal(calls[0].order, 0)
  assert.equal(calls[0].interpolate, false)
  assert.equal(typeof calls[0].text, 'function')
  assert.equal(calls[0].text(), '')
  assert.equal(controller.size(), 1)
  assert.equal(PERSONA_SECTION_NAME, 'deployment:persona-prefix')
  assert.equal(PERSONA_SECTION_ORDER, 0)
})

test('section text is dynamic: persona switches need no re-registration', async () => {
  const store = makeStore()
  const controller = createPersonaSections({ getStore: () => store, logger: makeLogger() })
  const { ctx, calls } = makeAgentCtx()
  controller.attach({ id: 'agent-1', ctx })

  const first = await store.create({ name: '一', body: 'BODY-1' })
  await store.switchGlobal(first.id)
  assert.equal(calls[0].text(), 'BODY-1')

  const second = await store.create({ name: '二', body: 'BODY-2' })
  await store.switchGlobal(second.id)
  assert.equal(calls[0].text(), 'BODY-2')
  assert.equal(calls.length, 1)

  // A session override for this agent id wins.
  await store.switchSession('agent-1', first.id)
  assert.equal(calls[0].text(), 'BODY-1')

  // Explicit "no persona" renders as an empty section.
  await store.switchSession('agent-1', null)
  assert.equal(calls[0].text(), '')
})

test('attach is idempotent per agent id', () => {
  const store = makeStore()
  const controller = createPersonaSections({ getStore: () => store, logger: makeLogger() })
  const { ctx, calls } = makeAgentCtx()
  const agent = { id: 'agent-1', ctx }
  const first = controller.attach(agent)
  const second = controller.attach(agent)
  assert.equal(first, second)
  assert.equal(calls.length, 1)
  assert.equal(controller.size(), 1)
})

test('collision falls back to persona-manager:persona (order 1) and logs once', () => {
  const store = makeStore()
  const logger = makeLogger()
  const controller = createPersonaSections({ getStore: () => store, logger })

  const first = makeAgentCtx({ failPrimary: true })
  controller.attach({ id: 'agent-1', ctx: first.ctx })
  assert.equal(first.calls.length, 1)
  assert.equal(first.calls[0].name, 'persona-manager:persona')
  assert.equal(first.calls[0].order, 1)
  assert.equal(first.calls[0].interpolate, false)
  assert.equal(logger.records.info.length, 1)
  assert.equal(FALLBACK_SECTION_NAME, 'persona-manager:persona')
  assert.equal(FALLBACK_SECTION_ORDER, 1)

  const second = makeAgentCtx({ failPrimary: true })
  controller.attach({ id: 'agent-2', ctx: second.ctx })
  assert.equal(second.calls.length, 1)
  assert.equal(second.calls[0].name, 'persona-manager:persona')
  assert.equal(logger.records.info.length, 1, 'fallback notice is logged only once')
})

test('both section names failing leaves the agent unattached and logs an error', () => {
  const store = makeStore()
  const logger = makeLogger()
  const controller = createPersonaSections({ getStore: () => store, logger })
  const { ctx, calls } = makeAgentCtx({ failAll: true })

  const dispose = controller.attach({ id: 'agent-1', ctx })
  assert.equal(dispose, undefined)
  assert.equal(calls.length, 0)
  assert.equal(logger.records.error.length, 1)
  assert.equal(controller.size(), 0)
})

test('detach disposes the section and is safe to repeat', () => {
  const store = makeStore()
  const controller = createPersonaSections({ getStore: () => store, logger: makeLogger() })
  const { ctx, calls } = makeAgentCtx()
  controller.attach({ id: 'agent-1', ctx })

  controller.detach('agent-1')
  assert.equal(calls[0].disposed, true)
  assert.equal(controller.size(), 0)
  controller.detach('agent-1')
  controller.detach('never-attached')
  assert.equal(controller.size(), 0)
})

test('disposeAll tears down every attached agent', () => {
  const store = makeStore()
  const controller = createPersonaSections({ getStore: () => store, logger: makeLogger() })
  const first = makeAgentCtx()
  const second = makeAgentCtx()
  controller.attach({ id: 'agent-1', ctx: first.ctx })
  controller.attach({ id: 'agent-2', ctx: second.ctx })
  assert.equal(controller.size(), 2)

  controller.disposeAll()
  assert.equal(controller.size(), 0)
  assert.equal(first.calls[0].disposed, true)
  assert.equal(second.calls[0].disposed, true)
})

test('attach skips agents without a scoped systemPrompt', () => {
  const store = makeStore()
  const logger = makeLogger()
  const controller = createPersonaSections({ getStore: () => store, logger })
  assert.equal(controller.attach({ id: 'agent-1', ctx: {} }), undefined)
  assert.equal(controller.attach({ id: 'agent-2' }), undefined)
  assert.equal(controller.attach({ ctx: {} }), undefined)
  assert.equal(controller.size(), 0)
  assert.ok(logger.records.warn.length >= 2)
})

test('text resolution failures degrade to an empty section', () => {
  const logger = makeLogger()
  const controller = createPersonaSections({
    getStore: () => {
      throw new Error('store exploded')
    },
    logger,
  })
  const { ctx, calls } = makeAgentCtx()
  controller.attach({ id: 'agent-1', ctx })
  assert.equal(calls[0].text(), '')
  assert.equal(logger.records.warn.length, 1)
})

test('the optional attach dispose hook receives the disposer', () => {
  const store = makeStore()
  const controller = createPersonaSections({ getStore: () => store, logger: makeLogger() })
  const { ctx, calls } = makeAgentCtx()
  let hookDisposer
  controller.attach({ id: 'agent-1', ctx }, (dispose) => {
    hookDisposer = dispose
  })
  assert.equal(typeof hookDisposer, 'function')
  hookDisposer()
  assert.equal(calls[0].disposed, true)
  assert.equal(controller.size(), 0)
})
