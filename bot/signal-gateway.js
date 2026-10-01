#!/usr/bin/env node
'use strict'
require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = Number(process.env.NUTTUM_SIGNAL_PORT || 8891)
const FILE = path.resolve(process.env.NUTTUM_SIGNAL_FILE || path.join(__dirname, 'signals.json'))
const SECRET = process.env.NUTTUM_WEBHOOK_SECRET || ''
const SOURCES = new Set(['fomo', 'pumpfun'])
let state = { version: 2, totalVerified: 0, bySource: { fomo: 0, pumpfun: 0 }, seen: {}, recentTransactions: [], minuteBuckets: {}, updatedAt: null }
try { state = Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8'))) } catch (_) {}
state.version = 2
state.bySource = Object.assign({ fomo: 0, pumpfun: 0 }, state.bySource || {})
state.seen = state.seen || {}
state.recentTransactions = state.recentTransactions || []
state.minuteBuckets = state.minuteBuckets || {}

function publicBuckets () {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000
  return Object.values(state.minuteBuckets).filter(x => x.t >= cutoff).sort((a, b) => a.t - b.t)
}
let saveTimer = null
function save () {
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2))
  saveTimer = null
}
function scheduleSave () {
  state.updatedAt = new Date().toISOString()
  if (!saveTimer) saveTimer = setTimeout(save, 1000)
}
function publicState () {
  return { ok: true, authRequired: Boolean(SECRET), version: state.version, totalVerified: state.totalVerified, bySource: state.bySource, recentTransactions: state.recentTransactions.slice(-500), minuteBuckets: publicBuckets(), updatedAt: state.updatedAt }
}
function json (res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}
function validSignature (raw, supplied) {
  if (!SECRET) return true
  const expected = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  const actual = String(supplied || '').replace(/^sha256=/, '')
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}
function trimState () {
  const seenKeys = Object.keys(state.seen)
  if (seenKeys.length > 40000) seenKeys.sort((a, b) => state.seen[a] - state.seen[b]).slice(0, seenKeys.length - 30000).forEach(k => delete state.seen[k])
  const cutoff = Date.now() - 3 * 60 * 60 * 1000
  Object.keys(state.minuteBuckets).forEach(k => { if (Number(k) < cutoff) delete state.minuteBuckets[k] })
  if (state.recentTransactions.length > 1000) state.recentTransactions = state.recentTransactions.slice(-1000)
}
function ingest (source, payload) {
  const items = Array.isArray(payload) ? payload : Array.isArray(payload.events) ? payload.events : [payload]
  let accepted = 0; let duplicates = 0; const rejected = []
  items.slice(0, 5000).forEach((event, index) => {
    const tx = String(event && (event.signature || event.txHash || event.transaction || event.id) || '').trim()
    if (!tx || tx.length < 12) { rejected.push(index); return }
    if (state.seen[tx] || state.seen[source + ':' + tx]) { duplicates++; return }
    const eventTime = Number(event.timestamp || event.time || event.blockTime || Date.now())
    const time = eventTime < 100000000000 ? eventTime * 1000 : eventTime
    const t = Number.isFinite(time) ? time : Date.now()
    const minute = Math.floor(t / 60000) * 60000
    const bucket = state.minuteBuckets[minute] || { t: minute, fomo: 0, pumpfun: 0 }
    bucket[source] = (bucket[source] || 0) + 1
    state.minuteBuckets[minute] = bucket
    state.seen[tx] = Date.now()
    state.totalVerified++
    state.bySource[source] = (state.bySource[source] || 0) + 1
    state.recentTransactions.push({ source, signature: tx, t })
    accepted++
  })
  trimState()
  if (accepted) scheduleSave()
  return { accepted, duplicates, rejected, totalVerified: state.totalVerified, bySource: state.bySource }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-nuttum-signature' }); return res.end() }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/signals')) return json(res, 200, publicState())
  const match = req.url.match(/^\/events\/(fomo|pumpfun)$/)
  if (req.method !== 'POST' || !match || !SOURCES.has(match[1])) return json(res, 404, { error: 'not_found' })
  let raw = ''
  req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) req.destroy() })
  req.on('end', () => {
    if (!validSignature(raw, req.headers['x-nuttum-signature'])) return json(res, 401, { error: 'invalid_signature' })
    try { return json(res, 200, ingest(match[1], JSON.parse(raw || '{}'))) } catch (error) { return json(res, 400, { error: 'invalid_json', detail: error.message }) }
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Nuttum signal gateway listening on 127.0.0.1:${PORT}`)
  console.log('POST verified events to /events/fomo or /events/pumpfun')
  if (!SECRET) console.warn('WARNING: NUTTUM_WEBHOOK_SECRET is empty; do not expose this server publicly.')
})