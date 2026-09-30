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
let state = { version: 1, totalVerified: 0, bySource: { fomo: 0, pumpfun: 0 }, seen: {}, recentTransactions: [], updatedAt: null }
try { state = Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8'))) } catch (_) {}
state.bySource = Object.assign({ fomo: 0, pumpfun: 0 }, state.bySource || {})
state.seen = state.seen || {}; state.recentTransactions = state.recentTransactions || []

function save () {
  state.updatedAt = new Date().toISOString()
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2))
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
function trimSeen () {
  const keys = Object.keys(state.seen)
  if (keys.length <= 100000) return
  keys.sort((a, b) => state.seen[a] - state.seen[b]).slice(0, keys.length - 80000).forEach(k => delete state.seen[k])
}
function ingest (source, payload) {
  const items = Array.isArray(payload) ? payload : Array.isArray(payload.events) ? payload.events : [payload]
  let accepted = 0; let duplicates = 0; const rejected = []
  items.slice(0, 5000).forEach((event, index) => {
    const tx = String(event && (event.signature || event.txHash || event.transaction || event.id) || '').trim()
    if (!tx || tx.length < 12) { rejected.push(index); return }
    const key = source + ':' + tx
    if (state.seen[key]) { duplicates++; return }
    const eventTime = Number(event.timestamp || event.time || event.blockTime || Date.now())
    const time = eventTime < 100000000000 ? eventTime * 1000 : eventTime
    state.seen[key] = Date.now(); state.totalVerified++; state.bySource[source] = (state.bySource[source] || 0) + 1
    state.recentTransactions.push({ source, signature: tx, t: Number.isFinite(time) ? time : Date.now() })
    if (state.recentTransactions.length > 500) state.recentTransactions = state.recentTransactions.slice(-500)
    accepted++
  })
  trimSeen(); if (accepted) save()
  return { accepted, duplicates, rejected, totalVerified: state.totalVerified, bySource: state.bySource }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-nuttum-signature' }); return res.end() }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/signals')) return json(res, 200, { ok: true, authRequired: Boolean(SECRET), version: state.version, totalVerified: state.totalVerified, bySource: state.bySource, recentTransactions: state.recentTransactions.slice(-200), updatedAt: state.updatedAt })
  const match = req.url.match(/^\/events\/(fomo|pumpfun)$/)
  if (req.method !== 'POST' || !match || !SOURCES.has(match[1])) return json(res, 404, { error: 'not_found' })
  let raw = ''
  req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) req.destroy() })
  req.on('end', () => {
    if (!validSignature(raw, req.headers['x-nuttum-signature'])) return json(res, 401, { error: 'invalid_signature' })
    try { return json(res, 200, ingest(match[1], JSON.parse(raw || '{}'))) } catch (error) { return json(res, 400, { error: 'invalid_json', detail: error.message }) }
  })
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Nuttum signal gateway listening on :${PORT}`)
  console.log(`POST verified events to /events/fomo or /events/pumpfun`)
  if (!SECRET) console.warn('WARNING: NUTTUM_WEBHOOK_SECRET is empty; do not expose this server publicly.')
})