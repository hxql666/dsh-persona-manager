/**
 * Behavioural smoke test for the Persona Manager client half.
 *
 * client.js is a browser module, but its factory and apply() are plain
 * functions. This test runs the real file inside a node:vm sandbox with a fake
 * module loader, a fake React (hook stubs) and a fake client ctx, then asserts:
 *   - the loader id and factory contract,
 *   - both slot registrations with exact id/order/label,
 *   - zh/en dictionaries registered and complete,
 *   - apply() performs no network or DOM access,
 *   - the two components survive their first render without throwing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

const EXPECTED_KEYS = [
  'navLabel',
  'settingsTitle',
  'settingsDesc',
  'personaCount',
  'addPersona',
  'refresh',
  'retry',
  'loading',
  'emptyList',
  'globalBadge',
  'setGlobal',
  'edit',
  'delete',
  'confirmDelete',
  'confirm',
  'cancel',
  'save',
  'saving',
  'createTitle',
  'editTitle',
  'fieldName',
  'fieldEmoji',
  'fieldColor',
  'fieldDescription',
  'fieldBody',
  'hintName',
  'hintEmoji',
  'hintDescription',
  'hintBody',
  'colorCustom',
  'presetColor',
  'errorName',
  'errorBody',
  'errorDescription',
  'errorEmoji',
  'errorColor',
  'editorInvalid',
  'created',
  'saved',
  'deleted',
  'deletedClearedGlobal',
  'globalSet',
  'noDescription',
  'close',
  'chipFallback',
  'chipTitle',
  'chipAria',
  'followGlobalCurrent',
  'noPersona',
  'sessionExplicitNone',
  'setCurrentAsGlobal',
  'alreadyGlobal',
  'noSession',
  'errorLoad',
  'error.http',
  'error.unknown',
]

const ERROR_CODES = [
  'invalid-json',
  'invalid-body',
  'invalid-persona',
  'not-found',
  'persona-not-found',
  'method-not-allowed',
  'payload-too-large',
  'bad-origin',
  'internal',
  'network',
]

function createReactStub(initialStateQueue) {
  const queue = initialStateQueue ? initialStateQueue.slice() : []
  const hooks = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    useState(initial) {
      if (queue.length > 0) return [queue.shift(), function noopSetter() {}]
      const value = typeof initial === 'function' ? initial() : initial
      return [value, function noopSetter() {}]
    },
    useEffect() {},
    useRef(value) {
      return { current: value === undefined ? null : value }
    },
    useCallback(fn) {
      return fn
    },
    useMemo(fn) {
      return fn()
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const snapshot = getSnapshot()
      const unsubscribe = subscribe(function noopListener() {})
      void unsubscribe
      return snapshot
    },
    Fragment: Symbol.for('react.fragment'),
  }
  return hooks
}

function loadClientModule() {
  const captured = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(spec) {
          captured.push(spec)
        },
      },
    },
    console: { warn() {}, error() {}, log() {} },
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.equal(captured.length, 1, 'module loader must be called exactly once')
  return captured[0]
}

function createHarness(module) {
  const dictionaries = new Map()
  const localeListeners = new Set()
  let activeLocale = 'zh'
  let revision = 1

  function templateFor(namespace, key) {
    const byLocale = dictionaries.get(namespace)
    if (!byLocale) return undefined
    const dict = byLocale.get(activeLocale) || byLocale.get('zh')
    return dict ? dict[key] : undefined
  }

  const locale = {
    register(namespace, localeId, dict) {
      let byLocale = dictionaries.get(namespace)
      if (!byLocale) {
        byLocale = new Map()
        dictionaries.set(namespace, byLocale)
      }
      assert.equal(
        byLocale.has(localeId),
        false,
        `duplicate locale registration ${namespace}:${localeId}`,
      )
      byLocale.set(localeId, dict)
      return function dispose() {
        byLocale.delete(localeId)
      }
    },
    bind(namespace) {
      return function translate(key, params) {
        let template = templateFor(namespace, key)
        if (template === undefined) template = key
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
        )
      }
    },
    getSnapshot() {
      return { active: activeLocale, revision }
    },
    subscribe(listener) {
      localeListeners.add(listener)
      return function unsubscribe() {
        localeListeners.delete(listener)
      }
    },
  }

  function setLocale(next) {
    activeLocale = next
    revision += 1
    for (const listener of Array.from(localeListeners)) listener()
  }

  const registrations = []
  const effects = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    locale,
    slots: {
      inject(slot, callback) {
        void slot
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : function noopDispose() {}
      },
      register(options, component) {
        registrations.push({ slot: options.name, options, component })
        return function unregister() {}
      },
    },
  }

  return {
    ctx,
    registrations,
    dictionaries,
    locale,
    setLocale,
    effects,
    getLocale() {
      return activeLocale
    },
  }
}

function collectText(node, out) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object' && node.type) {
    for (const child of node.children) collectText(child, out)
  }
  return out
}

function findNode(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findNode(child, predicate, out)
    return out
  }
  if (node.type && predicate(node)) out.push(node)
  for (const child of node.children || []) findNode(child, predicate, out)
  return out
}

/**
 * Expand function components in a rendered tree once, so nested components
 * (the persona editor) render through the same hook stubs. The fake hook state
 * never updates, so this is a single fixed render, not an interactive tree.
 */
function renderDeep(node) {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) return node.map(renderDeep)
  if (typeof node !== 'object' || !node.type) return node
  if (typeof node.type === 'function') {
    const rendered = node.type(node.props)
    return {
      type: node.type.name || 'Anonymous',
      props: node.props || {},
      children: [renderDeep(rendered)],
    }
  }
  return {
    type: node.type,
    props: node.props || {},
    children: (node.children || []).map(renderDeep),
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
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function readyState(overrides) {
  const personas = overrides && overrides.personas ? overrides.personas : []
  const globalPersonaId =
    overrides && Object.prototype.hasOwnProperty.call(overrides, 'globalPersonaId')
      ? overrides.globalPersonaId
      : personas.length > 0
        ? personas[0].id
        : null
  return {
    version: 1,
    personas,
    global: { activePersonaId: globalPersonaId },
    session:
      overrides && Object.prototype.hasOwnProperty.call(overrides, 'session')
        ? overrides.session
        : null,
    effectivePersonaId:
      overrides && Object.prototype.hasOwnProperty.call(overrides, 'effectivePersonaId')
        ? overrides.effectivePersonaId
        : globalPersonaId,
  }
}

function setup(reactStub) {
  const spec = loadClientModule()
  assert.equal(spec.id, '@hxql/dsh-persona-manager')
  assert.equal(typeof spec.factory, 'function')
  const React = reactStub || createReactStub()
  const requireCalls = []
  const module = spec.factory((name) => {
    requireCalls.push(name)
    assert.equal(name, 'react', 'only react may be required')
    return React
  })
  assert.deepEqual(requireCalls, ['react'])
  assert.deepEqual(Array.from(module.inject), ['slots', 'locale'])
  assert.equal(typeof module.apply, 'function')
  const harness = createHarness(module)
  module.apply(harness.ctx)
  return { spec, React, module, harness }
}

test('factory exposes inject/apply and apply performs no network or DOM access', () => {
  const { harness } = setup()
  assert.equal(harness.effects.length, 1, 'dictionaries are registered through one effect')
  assert.equal(harness.registrations.length, 2)
  assert.equal(harness.dictionaries.size, 1)
  const byLocale = harness.dictionaries.get('persona-manager')
  assert.ok(byLocale, 'persona-manager namespace registered')
  assert.ok(byLocale.has('zh'))
  assert.ok(byLocale.has('en'))
})

test('settings.section occupant registered with id/order/localized label', () => {
  const { harness } = setup()
  const registration = harness.registrations.find((entry) => entry.slot === 'settings.section')
  assert.ok(registration, 'settings.section registered')
  assert.equal(registration.options.name, 'settings.section')
  assert.equal(registration.options.id, 'persona-manager')
  assert.equal(registration.options.order, 30)
  assert.equal(typeof registration.options.label, 'function')
  assert.equal(registration.options.label(), '人设管理')
  harness.setLocale('en')
  assert.equal(registration.options.label(), 'Personas')
  assert.equal(typeof registration.component, 'function')
  assert.equal(registration.component.name, 'PersonaSettingsSection')
})

test('conversation.input.left occupant registered with id/order-10 component', () => {
  const { harness } = setup()
  const registration = harness.registrations.find(
    (entry) => entry.slot === 'conversation.input.left',
  )
  assert.ok(registration, 'conversation.input.left registered')
  assert.equal(registration.options.name, 'conversation.input.left')
  assert.equal(registration.options.id, 'persona-manager')
  assert.equal(registration.options.order, 10)
  assert.equal(typeof registration.component, 'function')
  assert.equal(registration.component.name, 'PersonaChip')
})

test('zh/en dictionaries are complete, balanced and cover every used key', () => {
  const { harness } = setup()
  const byLocale = harness.dictionaries.get('persona-manager')
  const zh = byLocale.get('zh')
  const en = byLocale.get('en')
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of EXPECTED_KEYS) {
    assert.equal(typeof zh[key], 'string', `zh dictionary missing ${key}`)
    assert.equal(typeof en[key], 'string', `en dictionary missing ${key}`)
    assert.ok(zh[key].length > 0, `zh.${key} is empty`)
    assert.ok(en[key].length > 0, `en.${key} is empty`)
  }
  for (const code of ERROR_CODES) {
    assert.equal(typeof zh['error.' + code], 'string', `zh error.${code} missing`)
    assert.equal(typeof en['error.' + code], 'string', `en error.${code} missing`)
  }
  // every literal t('key') in client.js resolves in both locales
  const usedKeys = [
    ...new Set([...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1])),
  ]
  assert.ok(usedKeys.length > 20)
  for (const key of usedKeys) {
    assert.equal(typeof zh[key], 'string', `used zh key missing: ${key}`)
    assert.equal(typeof en[key], 'string', `used en key missing: ${key}`)
  }
  // placeholders survive translation
  assert.match(zh.followGlobalCurrent, /\{name\}/)
  assert.match(en.followGlobalCurrent, /\{name\}/)
  assert.match(zh.confirmDelete, /\{name\}/)
  assert.match(zh.personaCount, /\{count\}/)
})

test('dictionary effect disposer unregisters both locales', () => {
  const { harness } = setup()
  const dispose = harness.effects[0]
  assert.equal(typeof dispose, 'function')
  dispose()
  const byLocale = harness.dictionaries.get('persona-manager')
  assert.equal(byLocale.has('zh'), false)
  assert.equal(byLocale.has('en'), false)
})

test('PersonaSettingsSection renders its loading state without throwing', () => {
  const { harness, React } = setup()
  const registration = harness.registrations.find((entry) => entry.slot === 'settings.section')
  let tree
  assert.doesNotThrow(() => {
    tree = registration.component({ close() {} })
  })
  const text = collectText(tree, []).join(' ')
  assert.match(text, /人设管理/)
  assert.match(text, /加载中/)
  const style = findNode(tree, (node) => node.type === 'style')
  assert.ok(style.length >= 1, 'component renders its own <style> element')
  // switch locale, render again: copy follows the locale without re-registration
  harness.setLocale('en')
  let englishTree
  assert.doesNotThrow(() => {
    englishTree = registration.component({ close() {} })
  })
  const englishText = collectText(englishTree, []).join(' ')
  assert.match(englishText, /Persona management/)
  assert.match(englishText, /Loading/)
  void React
})

test('PersonaChip renders a closed aria-haspopup=listbox button without throwing', () => {
  const { harness } = setup()
  const registration = harness.registrations.find(
    (entry) => entry.slot === 'conversation.input.left',
  )
  let tree
  assert.doesNotThrow(() => {
    tree = registration.component({ sessionId: 'session-abc' })
  })
  const text = collectText(tree, []).join(' ')
  assert.match(text, /人设/, 'fallback label while loading')
  assert.match(text, /🎭/, 'fallback emoji while loading')
  const [button] = findNode(
    tree,
    (node) => node.type === 'button' && node.props['aria-haspopup'] === 'listbox',
  )
  assert.ok(button, 'chip button has aria-haspopup=listbox')
  assert.equal(button.props['aria-expanded'], 'false')
  assert.equal(button.props.title, '切换本会话人设')
  const style = findNode(tree, (node) => node.type === 'style')
  assert.ok(style.length >= 1, 'chip renders its own <style> element')
  // no popover while closed
  const popover = findNode(tree, (node) => node.props && node.props['data-dsh-pm'] === 'popover')
  assert.equal(popover.length, 0)
})

test('PersonaChip without a session renders disabled with the no-session title', () => {
  const { harness } = setup()
  const registration = harness.registrations.find(
    (entry) => entry.slot === 'conversation.input.left',
  )
  const tree = registration.component({})
  const [button] = findNode(
    tree,
    (node) => node.type === 'button' && node.props['aria-haspopup'] === 'listbox',
  )
  assert.ok(button)
  assert.equal(button.props.disabled, true)
  assert.equal(button.props.title, '当前没有活动会话')
})

// ---------------------------------------------------------------------------
// Forced-state renders. The hook stubs hand fixed values to the first N
// useState calls, which lets the list, editor and open-popover branches render
// once without a browser or an interactive state machine.
// ---------------------------------------------------------------------------

const WHALE = personaFixture({ id: 'p-whale', name: '鲸鱼娘', color: '#3b82f6' })
const OWL = personaFixture({
  id: 'p-owl',
  name: '猫头鹰',
  description: '冷静的猫头鹰',
  body: '你是猫头鹰。',
  emoji: '🦉',
  color: '#10b981',
  createdAt: 2,
  updatedAt: 2,
})

function findButtonWithText(tree, text) {
  return findNode(
    tree,
    (node) => node.type === 'button' && collectText(node, []).join(' ').includes(text),
  )
}

function readyHookState(overrides) {
  return { status: 'ready', data: readyState(overrides), error: null }
}

test('settings list renders persona rows, global badge and row actions', () => {
  // useState order: data, reloadToken, editor, notice, pendingDeleteId, busy
  const react = createReactStub([
    readyHookState({ personas: [WHALE, OWL], globalPersonaId: WHALE.id }),
    0,
    null,
    null,
    null,
    false,
  ])
  const { harness } = setup(react)
  const registration = harness.registrations.find((entry) => entry.slot === 'settings.section')
  const tree = renderDeep(registration.component({ close() {} }))
  const text = collectText(tree, []).join(' ')
  assert.match(text, /鲸鱼娘/)
  assert.match(text, /猫头鹰/)
  assert.match(text, /冷静的猫头鹰/)
  assert.match(text, /全局默认/)
  assert.equal(findNode(tree, (node) => node.type === 'li').length, 2)
  assert.equal(findButtonWithText(tree, '设为全局默认').length, 1, 'only non-global rows offer it')
  assert.equal(findButtonWithText(tree, '编辑').length, 2)
  assert.equal(findButtonWithText(tree, '删除').length, 2)
  assert.equal(findNode(tree, (node) => node.type === 'form').length, 0)
  const avatar = findNode(tree, (node) => node.props && node.props.className === 'dsh-pm-avatar')
  assert.equal(avatar[0].props.style.background, '#3b82f6')
})

test('settings create editor renders a validated form with swatches and a code textarea', () => {
  const react = createReactStub([
    readyHookState({ personas: [WHALE, OWL], globalPersonaId: WHALE.id }),
    0,
    { persona: null },
    null,
    null,
    false,
  ])
  const { harness } = setup(react)
  const registration = harness.registrations.find((entry) => entry.slot === 'settings.section')
  const tree = renderDeep(registration.component({ close() {} }))
  const text = collectText(tree, []).join(' ')
  assert.match(text, /新增人设/)
  assert.match(text, /保存/)
  assert.match(text, /取消/)
  assert.equal(findNode(tree, (node) => node.type === 'form').length, 1)
  const inputs = findNode(tree, (node) => node.type === 'input')
  const byId = new Map(inputs.map((node) => [node.props.id, node.props]))
  assert.equal(byId.get('dsh-pm-name').value, '')
  assert.equal(byId.get('dsh-pm-emoji').value, '🎭')
  assert.equal(byId.get('dsh-pm-color').type, 'color')
  assert.equal(byId.get('dsh-pm-name').maxLength, 80)
  const body = findNode(tree, (node) => node.type === 'textarea' && node.props.id === 'dsh-pm-body')
  assert.equal(body.length, 1)
  assert.equal(body[0].props.rows, 10)
  assert.match(body[0].props.className, /dsh-pm-textarea-code/)
  assert.equal(findNode(tree, (node) => node.type === 'li').length, 0, 'list is replaced by the editor')
  const swatches = findNode(
    tree,
    (node) => node.type === 'button' && String(node.props['aria-label'] || '').includes('预设颜色'),
  )
  assert.equal(swatches.length, 8, 'eight preset color swatches')
})

test('settings edit editor prefills the selected persona', () => {
  const react = createReactStub([
    readyHookState({ personas: [WHALE, OWL], globalPersonaId: WHALE.id }),
    0,
    { persona: OWL },
    null,
    null,
    false,
  ])
  const { harness } = setup(react)
  const registration = harness.registrations.find((entry) => entry.slot === 'settings.section')
  const tree = renderDeep(registration.component({ close() {} }))
  const inputs = findNode(tree, (node) => node.type === 'input')
  const byId = new Map(inputs.map((node) => [node.props.id, node.props]))
  assert.equal(byId.get('dsh-pm-name').value, '猫头鹰')
  assert.equal(byId.get('dsh-pm-emoji').value, '🦉')
  assert.equal(byId.get('dsh-pm-color').value, '#10b981')
  const body = findNode(tree, (node) => node.type === 'textarea' && node.props.id === 'dsh-pm-body')
  assert.equal(body[0].props.value, '你是猫头鹰。')
  assert.match(collectText(tree, []).join(' '), /编辑人设/)
})

test('chip popover renders follow-global, session override and set-global action', () => {
  // useState order: data, reloadToken, open, position, busy, actionError, notice
  const react = createReactStub([
    readyHookState({
      personas: [WHALE, OWL],
      globalPersonaId: WHALE.id,
      session: { personaId: OWL.id },
      effectivePersonaId: OWL.id,
    }),
    0,
    true,
    { left: 12, top: 40, width: 320, maxHeight: 280 },
    false,
    null,
    null,
  ])
  const { harness } = setup(react)
  const registration = harness.registrations.find(
    (entry) => entry.slot === 'conversation.input.left',
  )
  const tree = renderDeep(registration.component({ sessionId: 'session-abc' }))
  const popover = findNode(tree, (node) => node.props && node.props['data-dsh-pm'] === 'popover')
  assert.equal(popover.length, 1, 'popover is rendered while open')
  assert.equal(popover[0].props.style.left, '12px')
  assert.equal(popover[0].props.style.top, '40px')
  const options = findNode(tree, (node) => node.props && node.props.role === 'option')
  assert.equal(options.length, 3, 'follow-global plus two personas')
  assert.equal(options[0].props['aria-selected'], 'false')
  assert.equal(options[1].props['aria-selected'], 'false')
  assert.equal(options[2].props['aria-selected'], 'true', 'session override is selected')
  const text = collectText(tree, []).join(' ')
  assert.match(text, /跟随全局（当前：鲸鱼娘）/)
  assert.match(text, /将当前人设设为全局默认/)
  const [setGlobal] = findButtonWithText(tree, '将当前人设设为全局默认')
  assert.equal(setGlobal.props.disabled, false)
})

test('chip popover handles explicit no-persona sessions and disables set-global', () => {
  const react = createReactStub([
    readyHookState({
      personas: [WHALE],
      globalPersonaId: WHALE.id,
      session: { personaId: null },
      effectivePersonaId: null,
    }),
    0,
    true,
    { left: 0, bottom: 80, width: 300, maxHeight: 240 },
    false,
    null,
    null,
  ])
  const { harness } = setup(react)
  const registration = harness.registrations.find(
    (entry) => entry.slot === 'conversation.input.left',
  )
  const tree = renderDeep(registration.component({ sessionId: 'session-abc' }))
  const options = findNode(tree, (node) => node.props && node.props.role === 'option')
  assert.equal(options.length, 2)
  assert.equal(options[0].props['aria-selected'], 'false')
  assert.equal(options[1].props['aria-selected'], 'false')
  const text = collectText(tree, []).join(' ')
  assert.match(text, /本会话已选择不使用人设/)
  assert.match(text, /🎭/)
  const [setGlobal] = findButtonWithText(tree, '将当前人设设为全局默认')
  assert.equal(setGlobal.props.disabled, true, 'no effective persona to promote')
  const popover = findNode(tree, (node) => node.props && node.props['data-dsh-pm'] === 'popover')
  assert.equal(popover[0].props.style.bottom, '80px')
})
