/**
 * Persona Manager · HTTP helpers.
 *
 * Small, dependency-free primitives shared by the API route handler and its
 * unit tests: JSON responses, bounded JSON body reading, prefix path parsing,
 * same-origin (CSRF) admission, and the error envelope of DESIGN §7.
 */

/** Body limit of every mutating API request: 1 MiB. */
export const MAX_BODY_BYTES = 1024 * 1024

/** API mount prefix; the bundle owns this prefix route. */
export const API_PREFIX = '/persona-manager/api'

/** JSON response headers required by the contract. */
export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
})

/**
 * An HTTP-layer failure carrying the status and stable error code the envelope
 * must use. Anything else becomes a 500 `internal`.
 */
export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} code - Stable machine-readable error code.
   * @param {string} message - Human readable detail.
   */
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/**
 * Parse a request URL/path against the API prefix.
 *
 * @param {string} url - `req.url` (path + query) or a plain pathname.
 * @param {string} [prefix] - API prefix to strip.
 * @returns {{ segments: string[], pathname: string } | null} Decoded segments
 *   after the prefix (`[]` for the mount point), or null when the URL is not
 *   under the prefix / cannot be parsed.
 */
export function parseApiPath(url, prefix = API_PREFIX) {
  if (typeof url !== 'string' || url.length === 0) return null
  let pathname
  try {
    pathname = new URL(url, 'http://localhost').pathname
  } catch {
    return null
  }
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null
  let rest = pathname.slice(prefix.length)
  while (rest.endsWith('/') && rest.length > 1) rest = rest.slice(0, -1)
  const segments = []
  if (rest !== '' && rest !== '/') {
    for (const raw of rest.slice(1).split('/')) {
      if (raw.length === 0) return null
      try {
        segments.push(decodeURIComponent(raw))
      } catch {
        return null
      }
    }
  }
  return { segments, pathname }
}

/**
 * Read the query string of a request URL.
 *
 * @param {string} url - `req.url`.
 * @returns {URLSearchParams} Empty params when the URL cannot be parsed.
 */
export function queryOf(url) {
  try {
    return new URL(typeof url === 'string' && url.length > 0 ? url : '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * CSRF admission (DESIGN §7): a present `Origin` must have the same host as the
 * request's `Host` header. Origin-less local requests pass.
 *
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req - Node request.
 * @returns {boolean} Whether the request may proceed.
 */
export function isSameOrigin(req) {
  const headers = req?.headers
  if (!headers) return true
  const origin = headers.origin
  if (origin === undefined) return true
  const host = headers.host
  if (typeof origin !== 'string' || typeof host !== 'string' || host.length === 0) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Build the §7 error envelope.
 *
 * @param {string} code - Stable error code.
 * @param {string} message - Human readable detail.
 * @returns {{ error: { code: string, message: string } }}
 */
export function errorEnvelope(code, message) {
  return { error: { code, message } }
}

/**
 * Send one JSON response. Honors an already-committed response by doing
 * nothing (the caller owns that failure path).
 *
 * @param {import('node:http').ServerResponse} res - Node response.
 * @param {number} status - HTTP status code.
 * @param {unknown} value - JSON-serializable value.
 * @param {Record<string, string>} [extraHeaders] - Additional response headers.
 */
export function sendJson(res, status, value, extraHeaders) {
  if (!res || res.headersSent || res.writableEnded) return
  let payload
  try {
    payload = JSON.stringify(value)
  } catch {
    payload = JSON.stringify(errorEnvelope('internal', 'response serialization failed'))
    status = 500
  }
  if (payload === undefined) payload = 'null'
  res.writeHead(status, {
    ...JSON_HEADERS,
    'Content-Length': Buffer.byteLength(payload),
    ...(extraHeaders ?? {}),
  })
  res.end(payload)
}

/**
 * Send one JSON error response using the §7 envelope.
 *
 * @param {import('node:http').ServerResponse} res - Node response.
 * @param {number} status - HTTP status code.
 * @param {string} code - Stable error code.
 * @param {string} message - Human readable detail.
 * @param {Record<string, string>} [extraHeaders] - Additional response headers.
 */
export function sendError(res, status, code, message, extraHeaders) {
  sendJson(res, status, errorEnvelope(code, message), extraHeaders)
}

/**
 * Read and parse a bounded JSON request body. An empty body resolves to
 * `undefined` so the route can answer `invalid-body`.
 *
 * @param {import('node:http').IncomingMessage} req - Node request stream.
 * @param {number} [limit] - Maximum accepted byte count.
 * @returns {Promise<unknown>} Parsed JSON value (or undefined for an empty body).
 * @throws {HttpError} 413 `payload-too-large` or 400 `invalid-json`.
 */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let settled = false
    const chunks = []
    let size = 0

    const cleanup = () => {
      req.off?.('data', onData)
      req.off?.('end', onEnd)
      req.off?.('error', onError)
      req.off?.('close', onClose)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      // Keep the socket usable for the error response: drain the rest of the body.
      try {
        req.on?.('error', () => {})
      } catch {
        /* a destroyed request cannot take new listeners */
      }
      try {
        req.resume?.()
      } catch {
        /* a destroyed request cannot be drained */
      }
      reject(error)
    }
    const onData = (chunk) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > limit) {
        fail(new HttpError(413, 'payload-too-large', `request body exceeds ${limit} bytes`))
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim().length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new HttpError(400, 'invalid-json', 'request body is not valid JSON'))
      }
    }
    const onError = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new HttpError(400, 'invalid-json', `request body could not be read: ${String(error)}`))
    }
    const onClose = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new HttpError(400, 'invalid-body', 'request body was not completed'))
    }

    const declared = req.headers?.['content-length']
    if (declared !== undefined) {
      const declaredBytes = Number(declared)
      if (Number.isFinite(declaredBytes) && declaredBytes > limit) {
        fail(new HttpError(413, 'payload-too-large', `request body exceeds ${limit} bytes`))
        return
      }
    }

    req.on?.('data', onData)
    req.on?.('end', onEnd)
    req.on?.('error', onError)
    req.on?.('close', onClose)
  })
}
