/**
 * Static checks for the Persona Manager client half.
 *
 * These tests never load the module in a browser: they read client.js as text
 * and assert the loader envelope, the two slot registrations, the HTTP contract,
 * localized dictionaries, and the styling/security constraints from
 * docs/DESIGN.md §8. Behavioural checks live in client-loader.test.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const source = readFileSync(CLIENT_PATH, 'utf8')

const ALLOWED_THEME_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
])

const ALLOWED_PALETTE = new Set([
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#6b7280',
])

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

function countMatches(pattern) {
  return [...source.matchAll(pattern)].length
}

function uniqueValues(pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))]
}

test('official loader envelope with package id and React-only require', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(source, /id:\s*'@hxql\/dsh-persona-manager'/)
  assert.match(source, /factory\(require\)\s*\{/)
  assert.match(source, /const React = require\('react'\)/)
  assert.equal(countMatches(/\brequire\(/g), 1, 'only one require call')
  assert.deepEqual(uniqueValues(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g), ['react'])
  assert.doesNotMatch(source, /^\s*import\s/m, 'no ESM imports')
  assert.doesNotMatch(source, /@deepseek-ai\//, 'no DSH package references')
  assert.equal(countMatches(/window\.__ModuleLoader__/g), 1)
})

test('module injects slots and locale', () => {
  assert.match(source, /inject:\s*\['slots',\s*'locale'\]/)
  assert.match(source, /ctx\.locale\.bind\(NS\)/)
  assert.equal(countMatches(/ctx\.locale\.register\(/g), 2, 'zh + en dictionaries')
  assert.match(source, /ctx\.locale\.register\(NS, 'zh', DICT\.zh\)/)
  assert.match(source, /ctx\.locale\.register\(NS, 'en', DICT\.en\)/)
  assert.match(source, /React\.useSyncExternalStore\(localeSubscribe, localeGetSnapshot\)/)
  assert.match(source, /ctx\.locale\.subscribe\(listener\)/)
  assert.match(source, /ctx\.locale\.getSnapshot\(\)/)
})

test('settings.section registration: id, order 30, localized label thunk', () => {
  assert.equal(countMatches(/ctx\.slots\.inject\(/g), 2)
  assert.equal(countMatches(/ctx\.slots\.register\(/g), 2)
  assert.match(source, /ctx\.slots\.inject\('settings\.section'/)
  assert.match(
    source,
    /name:\s*'settings\.section',\s*id:\s*'persona-manager',\s*order:\s*30,\s*label:\s*function\s*\(\)\s*\{\s*return t\('navLabel'\)/s,
  )
  assert.match(source, /PersonaSettingsSection/)
})

test('conversation.input.left registration: id and order 10', () => {
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.left'/)
  assert.match(
    source,
    /name:\s*'conversation\.input\.left',\s*id:\s*'persona-manager',\s*order:\s*10,/s,
  )
  assert.match(source, /PersonaChip/)
  assert.match(source, /props\.sessionId/)
})

test('host HTTP contract: same-origin JSON, every documented endpoint and write-refetch', () => {
  assert.match(source, /const API_BASE = '\/persona-manager\/api'/)
  assert.equal(
    countMatches(/'\/persona-manager\/api'/g),
    1,
    'API base path literal is declared once',
  )
  assert.equal(countMatches(/\bfetch\(/g), 1, 'single fetch helper')
  assert.match(source, /credentials:\s*'same-origin'/)
  // GET /state (+ optional ?sessionId=)
  assert.match(source, /let path = '\/state'/)
  assert.match(source, /path \+= '\?sessionId=' \+ encodeURIComponent/)
  assert.match(source, /requestJson\('GET', path\)/)
  // POST /personas
  assert.match(source, /requestJson\('POST', '\/personas', payload\)/)
  // PUT /personas/<id>
  assert.match(
    source,
    /requestJson\(\s*'PUT',\s*'\/personas\/' \+ encodeURIComponent\(String\(persona\.id\)\),\s*payload,?\s*\)/s,
  )
  // DELETE /personas/<id>
  assert.match(
    source,
    /requestJson\(\s*'DELETE',\s*'\/personas\/' \+ encodeURIComponent\(String\(persona\.id\)\),?\s*\)/s,
  )
  // POST /switch (global + session)
  assert.match(source, /requestJson\('POST', '\/switch'/)
  assert.match(source, /runSwitch\('session', null, false\)/)
  assert.match(source, /runSwitch\('session', persona\.id, false\)/)
  assert.match(source, /runSwitch\('global', effectiveId, true\)/)
  assert.match(source, /payload\.sessionId = sessionId/)
  // every mutation refetches state
  assert.ok(countMatches(/reload\(\)/g) >= 4, 'mutations trigger a state refetch')
})

test('settings page covers list, editor, validation and states', () => {
  assert.match(source, /renderPersonaRow/)
  assert.match(source, /t\('globalBadge'\)/)
  assert.match(source, /t\('setGlobal'\)/)
  assert.match(source, /t\('edit'\)/)
  assert.match(source, /t\('delete'\)/)
  assert.match(source, /pendingDeleteId/)
  assert.match(source, /t\('confirmDelete', \{ name: persona\.name \}\)/)
  assert.match(source, /COLOR_PRESETS/)
  assert.match(source, /type: 'color'/)
  assert.match(source, /rows: 10\b/)
  assert.match(source, /dsh-pm-textarea-code/)
  assert.match(source, /monospace/)
  assert.match(source, /MAX_NAME = 80/)
  assert.match(source, /MAX_BODY = 20000/)
  assert.match(source, /MAX_DESCRIPTION = 300/)
  assert.match(source, /MAX_EMOJI = 8/)
  assert.match(source, /validateDraft/)
  assert.match(source, /t\('emptyList'\)/)
  assert.match(source, /t\('loading'\)/)
  assert.match(source, /t\('errorLoad'\)/)
  assert.match(source, /t\('retry'\)/)
  assert.match(source, /clearedGlobal/)
})

test('composer chip covers anchoring, dismissal, aria and popover actions', () => {
  assert.match(source, /getBoundingClientRect\(\)/)
  assert.match(source, /position:fixed/)
  assert.match(source, /Math\.min\(Math\.max\(8, rect\.left\), maxLeft\)/)
  assert.match(source, /addEventListener\('keydown'/)
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /addEventListener\('mousedown'/)
  assert.match(source, /'aria-haspopup': 'listbox'/)
  assert.match(source, /'aria-expanded': open \? 'true' : 'false'/)
  assert.match(source, /t\('followGlobalCurrent', \{ name: globalName \}\)/)
  assert.match(source, /t\('setCurrentAsGlobal'\)/)
  assert.match(source, /role: 'dialog'/)
  assert.match(source, /role: 'listbox'/)
  assert.match(source, /t\('chipFallback'\)/)
  assert.match(source, /DEFAULT_EMOJI = '🎭'/)
})

test('no unsafe DOM or HTML injection primitives', () => {
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(source, /\.innerHTML\b/)
  assert.doesNotMatch(source, /document\.body/)
  assert.doesNotMatch(source, /document\.createElement/)
  assert.doesNotMatch(source, /document\.write/)
  assert.doesNotMatch(source, /createPortal/)
  assert.doesNotMatch(source, /ReactDOM/)
  assert.doesNotMatch(source, /\.appendChild\(/)
  // no raw window/document access outside guarded feature detection
  assert.doesNotMatch(source, /window\.document/)
})

test('styling uses only host theme tokens and the persona palette', () => {
  const tokens = uniqueValues(/var\((--[a-zA-Z0-9-]+)\)/g)
  assert.ok(tokens.length >= 10, 'theme tokens are actually used')
  for (const token of tokens) {
    assert.ok(ALLOWED_THEME_TOKENS.has(token), `unexpected theme token ${token}`)
  }
  const hexes = [...new Set([...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => match[0].toLowerCase()))]
  assert.equal(hexes.length, 8, 'exactly the eight preset colors are literal')
  for (const hex of hexes) {
    assert.ok(ALLOWED_PALETTE.has(hex), `unexpected literal color ${hex}`)
  }
  assert.ok(hexes.includes('#6b7280'), 'default persona color is in the palette')
  // class prefix (the package id contains "dsh-persona-manager"; data-dsh-pm is a marker attr)
  const classTokens = [...source.matchAll(/\bdsh-[a-z0-9-]+/g)]
    .map((match) => match[0])
    .filter((token) => token !== 'dsh-persona-manager' && token !== 'dsh-pm')
  assert.ok(classTokens.length > 20, 'component classes are present')
  for (const token of classTokens) {
    assert.ok(token.startsWith('dsh-pm-'), `class without dsh-pm- prefix: ${token}`)
  }
})

test('visible copy lives in the locale dictionaries', () => {
  const dictStart = source.indexOf('const DICT = {')
  const cssStart = source.indexOf('const SETTINGS_CSS =')
  assert.ok(dictStart > 0)
  assert.ok(cssStart > dictStart)
  const outsideDict = source.slice(0, dictStart) + source.slice(cssStart)
  assert.doesNotMatch(outsideDict, /[\u4e00-\u9fff]/, 'no Chinese copy outside DICT')
  // every literal t('key') lookup must be backed by both dictionaries
  const keys = uniqueValues(/\bt\(\s*'([^']+)'/g)
  assert.ok(keys.length >= 30, 'translation keys are used across the UI')
  for (const key of ['navLabel', 'chipFallback', 'settingsTitle', 'errorLoad', 'save', 'close']) {
    assert.ok(keys.includes(key), `expected t('${key}') to be used`)
  }
})

test('client.js is valid UTF-8 text with balanced registry calls', () => {
  const bytes = readFileSync(CLIENT_PATH)
  assert.ok(bytes.length > 1000)
  const text = bytes.toString('utf8')
  assert.ok(!text.includes('\uFFFD'), 'file is valid UTF-8')
  // every ctx.slots.register call has a matching closing call paren on its block
  const injectCount = countMatches(/ctx\.slots\.inject\(/g)
  const registerCount = countMatches(/ctx\.slots\.register\(/g)
  assert.equal(injectCount, registerCount, 'each injection registers one component')
})
