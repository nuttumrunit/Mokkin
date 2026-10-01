#!/usr/bin/env node
'use strict'
require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const WebSocket = require('ws')
const crypto = require('crypto')

const WS_URL = process.env.NUTTUM_SOLANA_WS || 'wss://api.mainnet-beta.solana.com'
const GATEWAY = process.env.NUTTUM_SIGNAL_GATEWAY || `http://127.0.0.1:${process.env.NUTTUM_SIGNAL_PORT || 8891}`
const SECRET = process.env.NUTTUM_WEBHOOK_SECRET || ''
const FOMO_SIGNER = process.env.NUTTUM_FOMO_SIGNER || 'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51'
const PUMP_PROGRAM = process.env.NUTTUM_PUMP_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const PUMPSWAP_PROGRAM = process.env.NUTTUM_PUMPSWAP_PROGRAM || 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
const SUBJECTS = [
  { tag: 'fomo', address: FOMO_SIGNER },
  { tag: 'pump', address: PUMP_PROGRAM },
  { tag: 'pumpswap', address: PUMPSWAP_PROGRAM }
]
const pending = new Map()
const batches = { fomo: [], pumpfun: [] }
const acceptedLog = { fomo: 0, pumpfun: 0, total: 0 }
let ws = null; let retry = 1000; let requestId = 1
const requestTags = new Map(); const subscriptionTags = new Map()

function hasTradeInstruction (logs) {
  return logs.some(line => /Program log: Instruction: (?:Buy|Sell)(?:Exact|V2|ExactQuoteIn|ExactSolIn|ExactBaseIn|ExactBaseOut)?/i.test(line))
}
function classify (tag, value) {
  if (!value || value.err || !value.signature || !Array.isArray(value.logs)) return
  const logs = value.logs
  if (tag === 'fomo') {
    if (!logs.some(line => /Program log: Instruction: Swap/i.test(line))) return
    queue(value.signature, 'fomo')
    return
  }
  const program = tag === 'pump' ? PUMP_PROGRAM : PUMPSWAP_PROGRAM
  if (!logs.some(line => line.startsWith('Program ' + program + ' invoke')) || !hasTradeInstruction(logs)) return
  queue(value.signature, 'pumpfun')
}
function queue (signature, source) {
  let item = pending.get(signature)
  if (!item) {
    item = { signature, sources: new Set(), timestamp: Date.now(), timer: null }
    item.timer = setTimeout(() => finalize(signature), 900)
    pending.set(signature, item)
  }
  item.sources.add(source)
}
function finalize (signature) {
  const item = pending.get(signature)
  if (!item) return
  pending.delete(signature)
  const source = item.sources.has('fomo') ? 'fomo' : 'pumpfun'
  batches[source].push({ signature: item.signature, timestamp: item.timestamp })
}
async function sendBatch (source) {
  if (!batches[source].length) return
  const events = batches[source].splice(0, 5000)
  const raw = JSON.stringify({ events })
  const headers = { 'content-type': 'application/json' }
  if (SECRET) headers['x-nuttum-signature'] = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  try {
    const response = await fetch(`${GATEWAY}/events/${source}`, { method: 'POST', headers, body: raw })
    if (!response.ok) throw new Error(`gateway HTTP ${response.status}`)
    const result = await response.json()
    if (result.accepted) { acceptedLog[source] += result.accepted; acceptedLog.total = result.totalVerified }
  } catch (error) {
    batches[source].unshift(...events)
    if (batches[source].length > 20000) batches[source] = batches[source].slice(-20000)
    console.error('gateway:', error.message)
  }
}
setInterval(() => { sendBatch('fomo'); sendBatch('pumpfun') }, 500)
setInterval(() => {
  if (!acceptedLog.fomo && !acceptedLog.pumpfun) return
  console.log(new Date().toISOString(), '10s accepted', { fomo: acceptedLog.fomo, pumpfun: acceptedLog.pumpfun, total: acceptedLog.total })
  acceptedLog.fomo = 0; acceptedLog.pumpfun = 0
}, 10000)

function connect () {
  requestTags.clear(); subscriptionTags.clear()
  console.log('connecting Solana feed:', WS_URL)
  ws = new WebSocket(WS_URL)
  ws.on('open', () => {
    retry = 1000
    SUBJECTS.forEach(subject => {
      const id = requestId++
      requestTags.set(id, subject.tag)
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'logsSubscribe', params: [{ mentions: [subject.address] }, { commitment: 'confirmed' }] }))
    })
  })
  ws.on('message', raw => {
    let msg
    try { msg = JSON.parse(raw) } catch (_) { return }
    if (msg.id && requestTags.has(msg.id)) {
      if (msg.error) return console.error('subscription', requestTags.get(msg.id), JSON.stringify(msg.error))
      subscriptionTags.set(msg.result, requestTags.get(msg.id))
      console.log('subscribed', requestTags.get(msg.id), msg.result)
      requestTags.delete(msg.id)
      return
    }
    if (msg.method === 'logsNotification') classify(subscriptionTags.get(msg.params.subscription), msg.params.result.value)
  })
  ws.on('ping', data => ws.pong(data))
  ws.on('error', error => console.error('Solana websocket:', error.message))
  ws.on('close', () => {
    console.error('Solana feed disconnected; reconnecting in', retry, 'ms')
    setTimeout(connect, retry)
    retry = Math.min(retry * 2, 30000)
  })
}
connect()