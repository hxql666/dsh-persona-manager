/**
 * Unit tests for lib/host/http-util.js.
 *
 * No network: requests are `Readable` streams, responses are tiny fakes that
 * capture status/headers/body.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import {
  API_PREFIX,
  HttpError,
  JSON_HEADERS,
  MAX_BODY_BYTES,
  errorEnvelope,
  isSameOrigin,
  parseApiPath,
  queryOf,
  readJsonBody,
  sendError,
  sendJson,
} from '../lib/host/http-util.js'

/** @returns a fake ServerResponse that records what the handler wrote. */
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

/** @returns a fake IncomingMessage backed by `chunks`. */
function makeReq(chunks, headers = {}) {
  const req = Readable.from(chunks)
  req.headers = headers
  return req
}

test('constants match the contract', () => {
  assert.equal(API_PREFIX, '/persona-manager/api')
  assert.equal(MAX_BODY_BYTES, 1024 * 1024)
  assert.equal(JSON_HEADERS['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(JSON_HEADERS['Cache-Control'], 'no-store')
})

test('parseApiPath strips the prefix and decodes segments', () => {
  assert.deepEqual(parseApiPath('/persona-manager/api'), {
    segments: [],
    pathname: '/persona-manager/api',
  })
  assert.deepEqual(parseApiPath('/persona-manager/api/'), { segments: [], pathname: '/persona-manager/api/' })
  assert.deepEqual(parseApiPath('/persona-manager/api/state?sessionId=abc'), {
    segments: ['state'],
    pathname: '/persona-manager/api/state',
  })
  assert.deepEqual(parseApiPath('/persona-manager/api/personas/p_abc-123'), {
    segments: ['personas', 'p_abc-123'],
    pathname: '/persona-manager/api/personas/p_abc-123',
  })
  assert.deepEqual(parseApiPath('/persona-manager/api/personas/'), {
    segments: ['personas'],
    pathname: '/persona-manager/api/personas/',
  })
  assert.deepEqual(parseApiPath('/persona-manager/api/state/'), {
    segments: ['state'],
    pathname: '/persona-manager/api/state/',
  })
  assert.deepEqual(parseApiPath('/persona-manager/api/a%20b'), {
    segments: ['a b'],
    pathname: '/persona-manager/api/a%20b',
  })
  assert.equal(parseApiPath('/other/state'), null)
  assert.equal(parseApiPath('/persona-manager/apix'), null)
  assert.equal(parseApiPath(''), null)
  assert.equal(parseApiPath(undefined), null)
  assert.equal(parseApiPath('/persona-manager/api/%E0%A4%A'), null)
})

test('queryOf reads the sessionId parameter', () => {
  assert.equal(queryOf('/persona-manager/api/state?sessionId=s%201').get('sessionId'), 's 1')
  assert.equal(queryOf('/persona-manager/api/state').get('sessionId'), null)
  assert.equal(queryOf(undefined).get('sessionId'), null)
})

test('isSameOrigin implements the §7 CSRF rule', () => {
  assert.equal(isSameOrigin({ headers: {} }), true)
  assert.equal(isSameOrigin({}), true)
  assert.equal(isSameOrigin(undefined), true)
  assert.equal(
    isSameOrigin({ headers: { origin: 'http://127.0.0.1:58171', host: '127.0.0.1:58171' } }),
    true,
  )
  assert.equal(
    isSameOrigin({ headers: { origin: 'http://evil.example', host: '127.0.0.1:58171' } }),
    false,
  )
  assert.equal(isSameOrigin({ headers: { origin: 'null', host: '127.0.0.1:58171' } }), false)
  assert.equal(isSameOrigin({ headers: { origin: 'http://127.0.0.1:58171' } }), false)
})

test('errorEnvelope is the §7 error shape', () => {
  assert.deepEqual(errorEnvelope('invalid-json', 'bad json'), {
    error: { code: 'invalid-json', message: 'bad json' },
  })
})

test('sendJson writes status, contract headers, and a JSON body', () => {
  const res = makeRes()
  sendJson(res, 201, { persona: { id: 'p_1' } })
  assert.equal(res.statusCode, 201)
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.headers['Content-Length'], Buffer.byteLength(res.body))
  assert.deepEqual(JSON.parse(res.body), { persona: { id: 'p_1' } })
  assert.equal(res.writableEnded, true)
})

test('sendJson appends extra headers and never double-sends', () => {
  const res = makeRes()
  sendJson(res, 201, { ok: true }, { 'X-Test': '1' })
  assert.equal(res.headers['X-Test'], '1')
  const before = res.body
  sendJson(res, 500, errorEnvelope('internal', 'again'))
  assert.equal(res.statusCode, 201)
  assert.equal(res.body, before)
})

test('sendError uses the error envelope', () => {
  const res = makeRes()
  sendError(res, 404, 'not-found', 'nope')
  assert.equal(res.statusCode, 404)
  assert.deepEqual(JSON.parse(res.body), { error: { code: 'not-found', message: 'nope' } })
})

test('readJsonBody parses valid JSON and treats an empty body as undefined', async () => {
  assert.deepEqual(await readJsonBody(makeReq([Buffer.from('{"a":1}')])), { a: 1 })
  assert.deepEqual(await readJsonBody(makeReq([Buffer.from('null')])), null)
  assert.deepEqual(await readJsonBody(makeReq([Buffer.from('[1,2]')])), [1, 2])
  assert.equal(await readJsonBody(makeReq([])), undefined)
  assert.equal(await readJsonBody(makeReq([Buffer.from('   ')])), undefined)
  assert.deepEqual(await readJsonBody(makeReq([Buffer.from('{"a":1}')], { 'content-length': '7' })), { a: 1 })
})

test('readJsonBody rejects malformed JSON with 400 invalid-json', async () => {
  await assert.rejects(
    () => readJsonBody(makeReq([Buffer.from('{oops')])),
    (error) => error instanceof HttpError && error.status === 400 && error.code === 'invalid-json',
  )
})

test('readJsonBody enforces the byte limit (streamed and declared)', async () => {
  const chunks = [Buffer.alloc(6, 0x61), Buffer.alloc(6, 0x62)]
  await assert.rejects(
    () => readJsonBody(makeReq(chunks), 8),
    (error) => error instanceof HttpError && error.status === 413 && error.code === 'payload-too-large',
  )
  await assert.rejects(
    () => readJsonBody(makeReq([Buffer.from('{}')], { 'content-length': '999999999' })),
    (error) => error instanceof HttpError && error.status === 413 && error.code === 'payload-too-large',
  )
})

test('HttpError carries the status/code pair', () => {
  const error = new HttpError(400, 'invalid-body', 'nope')
  assert.equal(error.name, 'HttpError')
  assert.equal(error.status, 400)
  assert.equal(error.code, 'invalid-body')
  assert.equal(error.message, 'nope')
})
