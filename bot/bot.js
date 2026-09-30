// Nuttum — an autonomous AI building a coherent New York City on a clean green island
// surrounded by a wide ocean. A real LLM designs each building (as a spec); the code builds
// it SOLID with /fill, lays streets, shapes parks. It keeps a persistent, server-side data
// history (so all site visitors see the SAME real chart, and a refresh never restarts it),
// and it triggers a local map render after each building so the web map stays current.
require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const OpenAI = require('openai')
const fs = require('fs')
const path = require('path')
let mineflayerViewer = null
try { mineflayerViewer = require('prismarine-viewer').mineflayer } catch (e) { console.log('viewer unavailable:', e.message) }

const HOST = process.env.NUTTUM_MC_HOST || '127.0.0.1'
const PORT = Number(process.env.NUTTUM_MC_PORT || 25565)
const NAME = process.env.NUTTUM_BOT_NAME || 'Nuttum'
const VIEWER_PORT = Number(process.env.NUTTUM_VIEWER_PORT || 3007)
const DATA_PORT = Number(process.env.NUTTUM_DATA_PORT || 8890)
const BLOCK_DELAY_MS = Math.max(0, Number(process.env.NUTTUM_BLOCK_DELAY_MS || 20))
const GY = 72                 // flat city ground level
const PLOT = 13, CELL = 18    // building plot + street pitch
const MAXRING = 30           // never idles: keeps expanding outward (61x61 plots) reclaiming land as it goes
const ISLAND = 100            // green land half-extent
const OCEAN = 150             // cleared + water half-extent (everything within is clean; no mountains, no floaters)
const SKY = 150               // clear terrain up to this Y (removes mountains + floating blocks)

const AI_CONFIG = path.resolve(process.env.NUTTUM_AI_CONFIG || path.join(__dirname, 'ai.config.json'))
let cfg = null, ai = null
if (fs.existsSync(AI_CONFIG)) {
  cfg = JSON.parse(fs.readFileSync(AI_CONFIG, 'utf8'))
  ai = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
  console.log('AI brain:', cfg.model, '@', cfg.baseURL)
} else console.warn('AI planner not configured; viewer and market queue can run, but new building specs will wait for ai.config.json.')

const PROGRESS = path.join(__dirname, 'nyc-progress.json')
const STATE = path.join(__dirname, 'state.json')
let done = {}; try { done = JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) } catch (e) { done = {} }
const saveProgress = () => { try { fs.writeFileSync(PROGRESS, JSON.stringify(done)) } catch (e) {} }

const bot = mineflayer.createBot({ host: HOST, port: PORT, username: NAME, auth: 'offline' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const cmd = (c) => bot.chat(c)
const rawfill = (x1, y1, z1, x2, y2, z2, b) => cmd(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:${b}`)
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v || 0)))

// ---- persistent, server-side live data (charts + info stream) ----
const SITE_LIVE = path.resolve(process.env.NUTTUM_LIVE_FILE || path.join(__dirname, '..', 'home', 'nuttum-live.json'))
const SIGNAL_FILE = path.resolve(process.env.NUTTUM_SIGNAL_FILE || path.join(__dirname, 'signals.json'))
const SIGNAL_USAGE = path.join(__dirname, 'signal-consumption.json')
const MILESTONE_FILE = path.join(__dirname, 'milestones.json')
const SIGNAL_MODE = (process.env.NUTTUM_SIGNAL_MODE || 'market').toLowerCase()
const MILESTONES = String(process.env.NUTTUM_MILESTONE_BLOCKS || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b)
let signalConsumed = 0; try { signalConsumed = JSON.parse(fs.readFileSync(SIGNAL_USAGE, 'utf8')).consumed || 0 } catch (_) {}
let milestoneLog = []; try { milestoneLog = JSON.parse(fs.readFileSync(MILESTONE_FILE, 'utf8')) } catch (_) {}
function signalState () { try { return JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8')) } catch (_) { return { totalVerified: 0, bySource: { fomo: 0, pumpfun: 0 }, recentTransactions: [] } } }
function publicSignals () { const s = signalState(); return { totalVerified: s.totalVerified || 0, bySource: s.bySource || { fomo: 0, pumpfun: 0 }, recentTransactions: (s.recentTransactions || []).slice(-200), updatedAt: s.updatedAt || null } }
function saveSignalUse () { fs.writeFileSync(SIGNAL_USAGE, JSON.stringify({ consumed: signalConsumed, updatedAt: new Date().toISOString() }, null, 2)) }
function checkMilestone () {
  if (!MILESTONES.includes(signalConsumed) || milestoneLog.some(m => m.blocks === signalConsumed)) return
  milestoneLog.push({ blocks: signalConsumed, status: 'pending', action: 'buyback-and-burn', createdAt: new Date().toISOString() })
  fs.writeFileSync(MILESTONE_FILE, JSON.stringify(milestoneLog, null, 2))
  pushEvent('MILESTONE', signalConsumed + ' blocks reached; buyback and burn pending execution')
}
async function takeSignalCredit () {
  if (SIGNAL_MODE === 'legacy' || SIGNAL_MODE === 'unlimited') return
  while (true) {
    const signals = signalState()
    if ((signals.totalVerified || 0) > signalConsumed) { signalConsumed++; saveSignalUse(); checkMilestone(); return }
    await sleep(1000)
  }
}
let totalBlocks = 0, placeLog = [], events = [], history = [], startedAt = Date.now()
try { const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); totalBlocks = st.totalBlocks || 0; history = st.history || []; if (st.startedAt) startedAt = st.startedAt } catch (e) {}
const easternClock = () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })
function pushEvent(tag, msg) { events.push({ t: easternClock(), tag, msg: String(msg).slice(0, 120) }); if (events.length > 60) events.shift() }
function bpm() { const now = Date.now(); placeLog = placeLog.filter(e => e.t > now - 60000); const cut = now - 20000; return Math.round(placeLog.filter(e => e.t > cut).reduce((s, e) => s + e.n, 0) * 3) }
function buildingsCount() { return Object.keys(done).filter(k => k[0] !== '_' && done[k] !== '~water~').length }
function writeLive() {
  try {
    fs.writeFileSync(SITE_LIVE, JSON.stringify({
      ts: Date.now(), startedAt, totalBlocks, blocksPerMin: bpm(), buildings: buildingsCount(),
      signalMode: SIGNAL_MODE, signalConsumed, signals: publicSignals(),
      history: history.slice(-180), events: events.slice(-40)
    }))
  } catch (e) {}
}
function sampleHistory() {                         // one real datapoint every 5s, kept server-side (persistent)
  const ss = publicSignals()
  history.push({ t: Date.now(), rate: bpm(), total: totalBlocks, buildings: buildingsCount(), verified: ss.totalVerified, fomo: ss.bySource.fomo || 0, pumpfun: ss.bySource.pumpfun || 0, consumed: signalConsumed, queue: Math.max(0, ss.totalVerified - signalConsumed) })
  if (history.length > 200) history = history.slice(-200)
  try { fs.writeFileSync(STATE, JSON.stringify({ startedAt, totalBlocks, history })) } catch (e) {}
}
setInterval(writeLive, 2000)
setInterval(sampleHistory, 5000)

// public endpoint (CORS): serves the live JSON + the latest live-view frame (cam.jpg),
// so the hosted site can show a light, always-loading cam + data from anywhere
const CAM_JPG = path.resolve(process.env.NUTTUM_CAM_FILE || path.join(__dirname, '..', 'home', 'cam.jpg'))
const MAP_WEB = path.resolve(process.env.NUTTUM_MAP_WEB || path.join(__dirname, '..', 'runtime', 'server', 'plugins', 'squaremap', 'web'))
const MAP_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' }
try {
  require('http').createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-store')
    const requestPath = decodeURIComponent(String(req.url || '/').split('?')[0])
    if (requestPath === '/map') { res.statusCode = 302; res.setHeader('Location', '/map/'); return res.end() }
    if (requestPath.startsWith('/map/')) {
      const relative = requestPath.slice(5) || 'index.html'
      const target = path.resolve(MAP_WEB, relative)
      if (target !== MAP_WEB && !target.startsWith(MAP_WEB + path.sep)) { res.statusCode = 403; return res.end('forbidden') }
      try {
        const stat = fs.statSync(target); const file = stat.isDirectory() ? path.join(target, 'index.html') : target
        res.setHeader('Content-Type', MAP_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
        return res.end(fs.readFileSync(file))
      } catch (e) { res.statusCode = 404; return res.end('not found') }
    }
    if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, bot: bot.entity ? 'connected' : 'starting', signalMode: SIGNAL_MODE, signalConsumed })) }
    if (req.url.indexOf('cam') >= 0) {
      res.setHeader('Content-Type', 'image/jpeg')
      try { res.end(fs.readFileSync(CAM_JPG)) } catch (e) { res.statusCode = 503; res.end('') }
    } else {
      res.setHeader('Content-Type', 'application/json')
      try { res.end(fs.readFileSync(SITE_LIVE)) } catch (e) { res.statusCode = 503; res.end('{}') }
    }
  }).listen(DATA_PORT, () => console.log('data+cam server on', DATA_PORT, '(CORS)'))
} catch (e) { console.log('data server:', e.message) }

async function cfill(x1, y1, z1, x2, y2, z2, b) {
  const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2), za = Math.min(z1, z2), zb = Math.max(z1, z2)
  for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) {
    if (b === 'air') { rawfill(x, y, z, x, y, z, b); continue }
    await takeSignalCredit(); totalBlocks++; placeLog.push({ t: Date.now(), n: 1 })
    if (placeLog.length > 5000) placeLog.shift(); rawfill(x, y, z, x, y, z, b); if (BLOCK_DELAY_MS) await sleep(BLOCK_DELAY_MS)
  }
}
async function cset(x, y, z, b) {
  if (b === 'air') { cmd(`/setblock ${x} ${y} ${z} minecraft:${b}`); return }
  await takeSignalCredit(); totalBlocks++; placeLog.push({ t: Date.now(), n: 1 })
  if (placeLog.length > 5000) placeLog.shift(); cmd(`/setblock ${x} ${y} ${z} minecraft:${b}`); if (BLOCK_DELAY_MS) await sleep(BLOCK_DELAY_MS)
}

let recentChat = []
const BANNED = new Set(['bedrock', 'command_block', 'chain_command_block', 'repeating_command_block', 'barrier', 'structure_block', 'structure_void', 'tnt', 'air', 'cave_air', 'void_air', 'jigsaw', 'light'])
const REMAP = { sand: 'sandstone', red_sand: 'red_sandstone', gravel: 'stone', anvil: 'iron_block', lava: 'magma_block' }
function cleanBlock(b) { if (!b) return null; let n = String(b).toLowerCase().replace(/^minecraft:/, '').replace(/[^a-z0-9_]/g, ''); if (!n) return null; if (REMAP[n]) n = REMAP[n]; if (BANNED.has(n)) return 'stone'; return n }
const cleanSay = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/^\/+/, '').trim().slice(0, 120)

let cur = { x: 0, y: 0, z: 0 }
async function moveTo(tx, ty, tz) {
  try { bot.creative.startFlying() } catch (e) {}
  const sx = cur.x, sz = cur.z, steps = Math.max(1, Math.round(Math.hypot(tx - sx, tz - sz) / 1.6))
  const yaw = (Math.atan2(-(tx - sx), (tz - sz)) * 180 / Math.PI).toFixed(1)
  for (let i = 1; i <= steps; i++) { cmd(`/tp ${NAME} ${(sx + (tx - sx) * i / steps).toFixed(2)} ${ty} ${(sz + (tz - sz) * i / steps).toFixed(2)} ${yaw} 15`); await sleep(100) }
  cur = { x: tx, y: ty, z: tz }
}

// tiled fill helper (respects the 32768-block /fill limit)
async function fillRegion(x1, y1, z1, x2, y2, z2, blk, tile) {
  const T = tile || 20
  for (let xa = x1; xa <= x2; xa += T) { const xb = Math.min(xa + T - 1, x2)
    for (let za = z1; za <= z2; za += T) { const zb = Math.min(za + T - 1, z2); rawfill(xa, y1, za, xb, y2, zb, blk); await sleep(70) } }
}

// ---- build a clean canvas: green island + wide ocean, all terrain above ground cleared (no mountains, no floating blocks) ----
async function prepareCanvas() {
  pushEvent('SYS', 'clearing terrain — a clean green island in the sea'); bot.chat('shaping a clean island: clearing land to the sky, laying a green plain and the sea...')
  await fillRegion(-OCEAN, GY + 1, -OCEAN, OCEAN, SKY, OCEAN, 'air', 20)        // wipe all mountains + floating blocks
  for (let y = GY - 1; y >= GY - 6; y--) {                                       // solid base
    rawfill(-OCEAN, y, -OCEAN, 0, y, OCEAN, 'stone'); rawfill(0, y, -OCEAN, OCEAN, y, OCEAN, 'stone'); await sleep(70)
  }
  rawfill(-ISLAND, GY, -ISLAND, 0, GY, ISLAND, 'grass_block'); rawfill(0, GY, -ISLAND, ISLAND, GY, ISLAND, 'grass_block'); await sleep(120)  // green land
  rawfill(-OCEAN, GY, ISLAND + 1, OCEAN, GY, OCEAN, 'water'); rawfill(-OCEAN, GY, -OCEAN, OCEAN, GY, -ISLAND - 1, 'water')                    // ocean N/S
  rawfill(ISLAND + 1, GY, -ISLAND, OCEAN, GY, ISLAND, 'water'); rawfill(-OCEAN, GY, -ISLAND, -ISLAND - 1, GY, ISLAND, 'water'); await sleep(120)  // ocean E/W
  // seawall promenade around the island
  rawfill(-ISLAND, GY, -ISLAND, ISLAND, GY, -ISLAND, 'stone_bricks'); rawfill(-ISLAND, GY, ISLAND, ISLAND, GY, ISLAND, 'stone_bricks')
  rawfill(-ISLAND, GY, -ISLAND, -ISLAND, GY, ISLAND, 'stone_bricks'); rawfill(ISLAND, GY, -ISLAND, ISLAND, GY, ISLAND, 'stone_bricks'); await sleep(120)
  pushEvent('SYS', 'land ready — a clean green island'); bot.chat('the island is clean and green. building New York now.')
}

const LANDMARKS = {
  '0,-4': { name: 'One World Trade Center', hmax: 60, brief: 'One World Trade Center: a very tall tapering glass spire, light_blue/cyan/white stained glass with iron trim, a long antenna spire on top.' },
  '2,2': { name: 'Empire State Building', hmax: 58, brief: 'Empire State Building: Art-Deco limestone (smooth_stone/quartz) with several stepped setbacks and a slender spire + light beacon.' },
  '1,-2': { name: 'Chrysler Building', hmax: 54, brief: 'Chrysler Building: Art-Deco tower, light_blue_terracotta/iron stepped crown and a spire.' },
  '-3,1': { name: 'Flatiron Building', hmax: 28, brief: 'Flatiron Building: narrow limestone (quartz/smooth_stone) tower, flat roof.' },
}
// building briefs by character
const BR = {
  sky: 'a Manhattan glass-and-steel skyscraper: concrete/quartz body, glass window bands (gray/black/light_blue_stained_glass), a couple of setbacks near the top, watertank or spire roof.',
  office: 'a downtown office tower: concrete/quartz/copper body, glass window bands, maybe one setback, flat or watertank roof.',
  landmark: 'a striking landmark tower for the skyline: glass/quartz/copper, glass window bands, a setback or two and a distinctive spire or crown roof.',
  mid: 'a mid-rise apartment/office: brick or stone body, regular windows, flat roof, maybe a rooftop watertank.',
  brown: 'a row of brownstones: warm brick/terracotta body, small windows, flat cornice roof.',
  shop: 'a small corner shop/bodega: brick body, a big storefront window band on the ground floor, small windows above, flat roof (keep it short).',
  villa: 'a detached suburban villa/house: warm brick or wood-plank body, white/quartz trim, small windows, a PITCHED roof; keep it SMALL (w and d 6-8).',
  school: 'a public school building: red-brick body, many regular windows in neat rows, a wide low form, a quartz/columned entrance, flat roof. Make it WIDE (w and d 10-12).',
}
// contiguous themed neighborhoods (each ~3x3 plots share a character), density falls off outward
function ihash(a, b) { return (((a * 73856093) ^ (b * 19349663)) >>> 0) }
function districtFor(gi, gj) {
  const r = Math.max(Math.abs(gi), Math.abs(gj))
  if (r <= 2) return 'core'
  if (r <= 4) return 'downtown'
  if (r <= 6) return 'midtown'
  const su = Math.floor((gi + 300) / 3), sv = Math.floor((gj + 300) / 3)
  const themes = ['residential', 'residential', 'residential', 'villas', 'campus', 'sports', 'hills', 'park', 'villas', 'hills', 'residential', 'campus']
  return themes[ihash(su, sv) % themes.length]
}
function isDistrictCenter(gi, gj) { return ((gi + 300) % 3) === 1 && ((gj + 300) % 3) === 1 }
function zoneFor(gi, gj) {
  const key = `${gi},${gj}`
  if (LANDMARKS[key]) return { type: 'build', ...LANDMARKS[key] }
  if (gi >= -1 && gi <= 1 && gj >= 1 && gj <= 4) return { type: 'park', name: 'Central Park' }
  const d = districtFor(gi, gj), h = ihash(gi, gj)
  switch (d) {
    case 'core': return { type: 'build', name: 'skyscraper', hmax: 48, brief: BR.sky }
    case 'downtown': return (h % 5 === 0) ? { type: 'build', name: 'landmark tower', hmax: 44, brief: BR.landmark } : { type: 'build', name: 'office tower', hmax: 34, brief: BR.office }
    case 'midtown':
      if (h % 9 === 0) return { type: 'feature', name: 'plaza & monument' }
      if (h % 9 === 1) return { type: 'park', name: 'city square' }
      return { type: 'build', name: 'mid-rise', hmax: 24, brief: BR.mid }
    case 'residential':
      if (h % 10 === 0) return { type: 'park', name: 'neighborhood park' }
      if (h % 10 === 1) return { type: 'build', name: 'corner shop', hmax: 10, brief: BR.shop }
      if (h % 10 === 2) return { type: 'build', name: 'apartments', hmax: 18, brief: BR.mid }
      return { type: 'build', name: 'brownstone row', hmax: 13, brief: BR.brown }
    case 'villas':
      if (h % 7 === 0) return { type: 'park', name: 'garden green' }
      return { type: 'villa', name: 'villa', hmax: 9, brief: BR.villa }
    case 'campus':
      if (isDistrictCenter(gi, gj)) return { type: 'field', name: 'campus field' }
      if (h % 6 === 0) return { type: 'park', name: 'quad lawn' }
      return { type: 'build', name: 'school building', hmax: 16, brief: BR.school }
    case 'sports':
      if (isDistrictCenter(gi, gj)) return { type: 'stadium', name: 'sports arena' }
      return { type: 'lot', name: 'parking & plaza' }
    case 'hills':
      if (h % 6 === 0) return { type: 'park', name: 'hill park' }
      return { type: 'hillhouse', name: 'hillside house', hmax: 8, brief: BR.villa }
    case 'park': return { type: 'park', name: 'city park' }
  }
  return { type: 'build', name: 'row houses', hmax: 12, brief: BR.brown }
}

// reclaim a single plot of land from the sea/wilderness: clear to the sky, lay a solid base + grass
async function reclaimLand(cx, cz) {
  // terrain prep (clearing + base) is NOT counted as "blocks placed" — only real construction counts,
  // so the metrics reflect actual building instead of huge one-shot land-clearing spikes
  rawfill(cx - 10, GY + 1, cz - 10, cx + 9, SKY, cz + 9, 'air')        // wipe water/terrain up to the sky
  rawfill(cx - 10, GY - 6, cz - 10, cx + 9, GY - 1, cz + 9, 'stone')   // solid base
  rawfill(cx - 10, GY, cz - 10, cx + 9, GY, cz + 9, 'grass_block')     // new land
  await sleep(140)
}

const SYSTEM = `You are Nuttum, an autonomous AI architect building a detailed New York City block by block. For the given plot you design ONE building and return a SPEC (not individual blocks) — a renderer builds it SOLID from your spec, so pick proportions and materials that look great and match the district.
Return ONLY a raw JSON object, no markdown/fences/commentary:
{"say":"<one short in-character sentence>","name":"<short name>","w":<6-12>,"d":<6-12>,"height":<6..HMAX>,"body":"<block id>","trim":"<block id>","windows":"<block id>","setbacks":[[<height>,<inset 1-2>]],"roof":"flat|watertank|spire|crown|dome|pitched","roof_material":"<block id>"}
Rules: block ids without minecraft: prefix; use real NYC materials (concrete/quartz/smooth_stone/bricks/deepslate/terracotta/copper body; stained_glass windows; iron/quartz/copper trim). height must be <= HMAX. setbacks optional (taller buildings look better with 1-2). No air/bedrock/tnt/water/lava/command blocks. JSON only.`

async function askSpec(gi, gj, zone) {
  if (!ai || !cfg) throw new Error('AI planner is not configured')
  const chat = recentChat.length ? recentChat.join(' | ') : '(none)'; recentChat = []
  const nbrs = []; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${gi + dx},${gj + dz}`; if (done[k] && done[k] !== '~water~') nbrs.push(done[k]) }
  const user = `${SYSTEM.replace('HMAX', zone.hmax)}

PLOT grid(${gi},${gj}). DISTRICT: ${zone.brief || zone.name}. Height limit HMAX = ${zone.hmax}.
Neighbors already built: ${nbrs.length ? nbrs.join(', ') : '(open)'}. Visitor chat: ${chat}.
Design it now. JSON only.`
  const resp = await ai.chat.completions.create({ model: cfg.model, max_tokens: 1200, messages: [{ role: 'user', content: user }] })
  let txt = (resp.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
  return JSON.parse(txt)
}

async function pave(cx, cz) {
  await cfill(cx - 9, GY, cz - 9, cx + 8, GY, cz + 8, 'gray_concrete'); await sleep(120)
  await cfill(cx - 6, GY, cz - 6, cx + 6, GY, cz + 6, 'light_gray_concrete'); await sleep(120)
}

async function renderTower(ox, oz, zone, spec, baseY) {
  var B = baseY || GY
  var w = clamp(spec.w, 6, 12), d = clamp(spec.d, 6, 12), H = clamp(spec.height, 6, zone.hmax || 12)
  var body = cleanBlock(spec.body) || 'light_gray_concrete', trim = cleanBlock(spec.trim) || 'smooth_stone'
  var win = cleanBlock(spec.windows) || 'gray_stained_glass', roofMat = cleanBlock(spec.roof_material) || trim
  var x1 = ox + ((13 - w) >> 1), x2 = x1 + w - 1, z1 = oz + ((13 - d) >> 1), z2 = z1 + d - 1
  var cuts = (Array.isArray(spec.setbacks) ? spec.setbacks : []).map(s => [clamp(s[0], 3, H - 1), clamp(s[1], 1, 2)]).filter(s => s[0] < H).sort((p, q) => p[0] - q[0])
  var segs = [], yA = 0, a = x1, b = x2, c = z1, e = z2
  for (var i = 0; i < cuts.length; i++) { segs.push({ yA: yA, yB: cuts[i][0] - 1, x1: a, x2: b, z1: c, z2: e }); yA = cuts[i][0]; a += cuts[i][1]; b -= cuts[i][1]; c += cuts[i][1]; e -= cuts[i][1]; if (b - a < 3 || e - c < 3) { a = x1 + 1; b = x2 - 1; c = z1 + 1; e = z2 - 1; break } }
  segs.push({ yA: yA, yB: H, x1: a, x2: b, z1: c, z2: e })
  for (var s of segs) {
    await cfill(s.x1, B + s.yA, s.z1, s.x1, B + s.yB, s.z2, body); await cfill(s.x2, B + s.yA, s.z1, s.x2, B + s.yB, s.z2, body)
    await cfill(s.x1, B + s.yA, s.z1, s.x2, B + s.yB, s.z1, body); await cfill(s.x1, B + s.yA, s.z2, s.x2, B + s.yB, s.z2, body); await sleep(140)
    for (var yy = s.yA + 2; yy <= s.yB - 1; yy += 2) {
      await cfill(s.x1, B + yy, s.z1, s.x1, B + yy, s.z2, win); await cfill(s.x2, B + yy, s.z1, s.x2, B + yy, s.z2, win)
      await cfill(s.x1, B + yy, s.z1, s.x2, B + yy, s.z1, win); await cfill(s.x1, B + yy, s.z2, s.x2, B + yy, s.z2, win)
    }
    await sleep(140)
    var C = [[s.x1, s.z1], [s.x1, s.z2], [s.x2, s.z1], [s.x2, s.z2]]
    for (var k = 0; k < 4; k++) await cfill(C[k][0], B + s.yA, C[k][1], C[k][0], B + s.yB, C[k][1], trim); await sleep(120)
  }
  await cfill(x1, B, z1, x1, B + 2, z2, trim); await cfill(x2, B, z1, x2, B + 2, z2, trim)
  await cfill(x1, B, z1, x2, B + 2, z1, trim); await cfill(x1, B, z2, x2, B + 2, z2, trim)
  var mid = (x1 + x2) >> 1; await cfill(mid - 1, B, z1, mid + 1, B + 1, z1, 'air'); await sleep(120)
  var t = segs[segs.length - 1], mx = (t.x1 + t.x2) >> 1, mz = (t.z1 + t.z2) >> 1
  await cfill(t.x1, B + H + 1, t.z1, t.x2, B + H + 1, t.z2, roofMat); await sleep(120)
  var rf = String(spec.roof || 'flat')
  if (/spire|antenna/.test(rf)) { await cfill(mx, B + H + 2, mz, mx, B + H + 11, mz, trim); await cset(mx, B + H + 12, mz, 'sea_lantern') }
  else if (/tank/.test(rf)) { await cfill(mx - 1, B + H + 2, mz - 1, mx + 1, B + H + 4, mz + 1, 'spruce_planks'); await cset(mx, B + H + 5, mz, 'glowstone') }
  else if (/crown|dome/.test(rf)) { await cfill(t.x1 + 1, B + H + 2, t.z1 + 1, t.x2 - 1, B + H + 3, t.z2 - 1, roofMat); await cset(mx, B + H + 4, mz, 'sea_lantern') }
  else if (/pitch|gable|hip|slope/.test(rf)) { for (var ri = 0; ri <= Math.min(w, d) >> 1; ri++) { if (t.x1 + ri > t.x2 - ri) break; await cfill(t.x1 + ri, B + H + 1 + ri, t.z1 + ri, t.x2 - ri, B + H + 1 + ri, t.z2 - ri, roofMat) } }
  else { await cset(t.x1, B + H + 2, t.z1, 'sea_lantern'); await cset(t.x2, B + H + 2, t.z2, 'sea_lantern') }
}

async function renderPark(cx, cz) {
  await cfill(cx - 6, GY, cz - 6, cx + 6, GY, cz + 6, 'grass_block')
  await cfill(cx - 1, GY, cz - 6, cx + 1, GY, cz + 6, 'dirt_path'); await cfill(cx - 6, GY, cz - 1, cx + 6, GY, cz + 1, 'dirt_path'); await sleep(120)
  await cfill(cx + 3, GY, cz + 3, cx + 5, GY, cz + 5, 'water')
  var trees = [[-4, -4], [4, -4], [-4, 4], [-3, 3]]
  for (var tI = 0; tI < trees.length; tI++) {
    var tx = cx + trees[tI][0], tz = cz + trees[tI][1]
    await cfill(tx, GY + 1, tz, tx, GY + 4, tz, 'oak_log')
    await cfill(tx - 2, GY + 4, tz - 2, tx + 2, GY + 5, tz + 2, 'oak_leaves'); await cfill(tx - 1, GY + 6, tz - 1, tx + 1, GY + 6, tz + 1, 'oak_leaves'); await sleep(100)
  }
  await cset(cx, GY + 3, cz, 'sea_lantern')
}

// streetlights at the block corners + a couple of street trees — life on every block
async function decorate(cx, cz) {
  var posts = [[-8, -8], [8, -8], [-8, 8], [8, 8]]
  for (var i = 0; i < posts.length; i++) {
    var lx = cx + posts[i][0], lz = cz + posts[i][1]
    await cfill(lx, GY + 1, lz, lx, GY + 3, lz, 'cobblestone_wall'); await cset(lx, GY + 4, lz, 'sea_lantern')
  }
  var trees = [[-8, 0], [8, 0], [0, -8], [0, 8]]
  for (var t = 0; t < trees.length; t++) {
    var tx = cx + trees[t][0], tz = cz + trees[t][1]
    await cfill(tx, GY + 1, tz, tx, GY + 3, tz, 'oak_log')
    await cfill(tx - 1, GY + 3, tz - 1, tx + 1, GY + 4, tz + 1, 'oak_leaves'); await cset(tx, GY + 5, tz, 'oak_leaves')
  }
  await sleep(120)
}

// a civic feature: paved plaza + central monument + corner fountains + trees
async function renderFeature(cx, cz) {
  await cfill(cx - 6, GY, cz - 6, cx + 6, GY, cz + 6, 'stone_bricks')
  await cfill(cx - 6, GY, cz - 6, cx + 6, GY, cz + 6, 'stone_bricks')
  await cfill(cx - 2, GY, cz - 2, cx + 2, GY, cz + 2, 'polished_andesite'); await sleep(100)
  // central monument
  await cfill(cx - 1, GY, cz - 1, cx + 1, GY, cz + 1, 'chiseled_stone_bricks')
  await cfill(cx, GY + 1, cz, cx, GY + 9, cz, 'quartz_pillar')
  await cset(cx, GY + 10, cz, 'gold_block'); await cset(cx, GY + 11, cz, 'sea_lantern'); await sleep(120)
  // corner fountains
  var f = [[-4, -4], [4, -4], [-4, 4], [4, 4]]
  for (var i = 0; i < f.length; i++) {
    var fx = cx + f[i][0], fz = cz + f[i][1]
    await cfill(fx - 1, GY, fz - 1, fx + 1, GY, fz + 1, 'stone_bricks'); await cset(fx, GY, fz, 'water')
    await cfill(fx - 1, GY + 1, fz - 1, fx - 1, GY + 1, fz + 1, 'stone_brick_wall'); await cset(fx, GY + 1, fz, 'sea_lantern')
  }
  await sleep(120)
  // side trees
  var tr = [[-5, 0], [5, 0], [0, -5], [0, 5]]
  for (var t = 0; t < tr.length; t++) {
    var tx = cx + tr[t][0], tz = cz + tr[t][1]
    await cfill(tx, GY + 1, tz, tx, GY + 3, tz, 'oak_log'); await cfill(tx - 1, GY + 3, tz - 1, tx + 1, GY + 4, tz + 1, 'oak_leaves')
  }
  await sleep(120)
}

// a campus / practice sports field: grass pitch, white lines, small bleachers, floodlights
async function renderField(cx, cz) {
  await cfill(cx - 8, GY, cz - 8, cx + 7, GY, cz + 7, 'grass_block')
  await cfill(cx - 6, GY, cz - 6, cx + 6, GY, cz - 6, 'white_concrete'); await cfill(cx - 6, GY, cz + 6, cx + 6, GY, cz + 6, 'white_concrete')
  await cfill(cx - 6, GY, cz - 6, cx - 6, GY, cz + 6, 'white_concrete'); await cfill(cx + 6, GY, cz - 6, cx + 6, GY, cz + 6, 'white_concrete')
  await cfill(cx - 6, GY, cz, cx + 6, GY, cz, 'white_concrete'); await sleep(100)
  await cfill(cx - 8, GY + 1, cz - 8, cx + 7, GY + 2, cz - 8, 'smooth_stone'); await cfill(cx - 8, GY + 1, cz + 8, cx + 7, GY + 2, cz + 8, 'smooth_stone')
  var f = [[-8, -8], [8, -8], [-8, 8], [8, 8]]
  for (var i = 0; i < f.length; i++) { await cfill(cx + f[i][0], GY + 1, cz + f[i][1], cx + f[i][0], GY + 6, cz + f[i][1], 'iron_bars'); await cset(cx + f[i][0], GY + 7, cz + f[i][1], 'sea_lantern') }
  await sleep(120)
}

// a sports arena: a bowl of stands with red seats around a grass pitch + floodlight pylons
async function renderStadium(cx, cz) {
  await cfill(cx - 5, GY, cz - 5, cx + 4, GY, cz + 4, 'grass_block'); await cfill(cx - 5, GY, cz, cx + 4, GY, cz, 'white_concrete'); await sleep(100)
  var mat = 'light_gray_concrete'
  await cfill(cx - 7, GY, cz - 7, cx + 6, GY + 5, cz - 7, mat); await cfill(cx - 7, GY, cz + 6, cx + 6, GY + 5, cz + 6, mat)
  await cfill(cx - 7, GY, cz - 7, cx - 7, GY + 5, cz + 6, mat); await cfill(cx + 6, GY, cz - 7, cx + 6, GY + 5, cz + 6, mat); await sleep(120)
  await cfill(cx - 6, GY + 1, cz - 6, cx + 5, GY + 4, cz - 6, 'red_concrete'); await cfill(cx - 6, GY + 1, cz + 5, cx + 5, GY + 4, cz + 5, 'red_concrete')
  await cfill(cx - 6, GY + 1, cz - 6, cx - 6, GY + 4, cz + 5, 'red_concrete'); await cfill(cx + 5, GY + 1, cz - 6, cx + 5, GY + 4, cz + 5, 'red_concrete'); await sleep(120)
  var f = [[-7, -7], [6, -7], [-7, 6], [6, 6]]
  for (var i = 0; i < f.length; i++) { await cfill(cx + f[i][0], GY + 6, cz + f[i][1], cx + f[i][0], GY + 9, cz + f[i][1], 'iron_block'); await cset(cx + f[i][0], GY + 10, cz + f[i][1], 'sea_lantern') }
  await sleep(120)
}

// a parking lot / plaza that supports a nearby facility
async function renderLot(cx, cz) {
  await cfill(cx - 8, GY, cz - 8, cx + 7, GY, cz + 7, 'gray_concrete')
  for (var zz = cz - 6; zz <= cz + 6; zz += 3) await cfill(cx - 6, GY, zz, cx + 6, GY, zz, 'white_concrete')
  await sleep(100)
}

// villa garden: lawn, path, low fence — a detached-house yard
async function renderYard(cx, cz) {
  await cfill(cx - 7, GY, cz - 7, cx + 7, GY, cz + 7, 'grass_block')
  await cfill(cx - 1, GY, cz - 7, cx + 1, GY, cz + 7, 'dirt_path'); await sleep(100)
  await cfill(cx - 7, GY + 1, cz - 7, cx + 7, GY + 1, cz - 7, 'oak_fence'); await cfill(cx - 7, GY + 1, cz + 7, cx + 7, GY + 1, cz + 7, 'oak_fence')
  await cfill(cx - 7, GY + 1, cz - 7, cx - 7, GY + 1, cz + 7, 'oak_fence'); await cfill(cx + 7, GY + 1, cz - 7, cx + 7, GY + 1, cz + 7, 'oak_fence')
  await cset(cx, GY + 1, cz - 7, 'air'); await sleep(100)   // gate
  var tr = [[-5, -5], [5, 5]]
  for (var t = 0; t < tr.length; t++) { var tx = cx + tr[t][0], tz = cz + tr[t][1]; await cfill(tx, GY + 1, tz, tx, GY + 3, tz, 'oak_log'); await cfill(tx - 1, GY + 3, tz - 1, tx + 1, GY + 4, tz + 1, 'oak_leaves') }
  await sleep(100)
}

// raise a green hill (truncated mound) with a flat top pad; returns the top ground level
async function raiseHill(cx, cz) {
  var M = 3 + (ihash(cx, cz) % 3)   // 3-5 tall
  for (var y = 1; y <= M; y++) { var s = 9 - Math.floor(3 * y / M); await cfill(cx - s, GY + y, cz - s, cx + s, GY + y, cz + s, 'dirt') }
  await cfill(cx - 6, GY + M, cz - 6, cx + 6, GY + M, cz + 6, 'grass_block')   // flat green pad on top
  await sleep(150)
  return GY + M
}

async function run() {
  await sleep(3000); cmd(`/tp ${NAME} 0 ${GY + 40} 0`); await sleep(3500)
  try { bot.creative.startFlying() } catch (e) {}
  if (!done['_canvas']) { await prepareCanvas(); done['_canvas'] = 1; saveProgress() }
  pushEvent('SYS', 'Nuttum online — building New York City'); bot.chat('Nuttum online. building New York City.')

  const plots = []; for (let r = 0; r <= MAXRING; r++) for (let gj = -r; gj <= r; gj++) for (let gi = -r; gi <= r; gi++) if (Math.max(Math.abs(gi), Math.abs(gj)) === r) plots.push([gi, gj])
  while (true) {
    for (const [gi, gj] of plots) {
      const key = `${gi},${gj}`; if (done[key]) continue
      const zone = zoneFor(gi, gj)
      const cx = gi * CELL, cz = gj * CELL, ox = cx - 6, oz = cz - 6
      await moveTo(cx + 22, GY + 16, cz + 22); try { await bot.lookAt(new Vec3(cx, GY + 8, cz), true) } catch (e) {}
      try {
        if (Math.abs(cx) > ISLAND - 9 || Math.abs(cz) > ISLAND - 9) { pushEvent('NUTTUM', 'reclaiming land from the sea to keep building'); await reclaimLand(cx, cz) }
        const t = zone.type
        if (t === 'park') { pushEvent('NUTTUM', 'laying out a green ' + zone.name); await renderPark(cx, cz); done[key] = zone.name }
        else if (t === 'feature') { pushEvent('NUTTUM', 'building a public plaza with a monument and fountains'); await renderFeature(cx, cz); done[key] = 'Plaza & Monument' }
        else if (t === 'field') { pushEvent('NUTTUM', 'marking out a sports field'); await renderField(cx, cz); done[key] = 'Sports Field' }
        else if (t === 'stadium') { pushEvent('NUTTUM', 'raising a sports arena'); await renderStadium(cx, cz); done[key] = 'Sports Arena' }
        else if (t === 'lot') { await pave(cx, cz); pushEvent('NUTTUM', 'paving a parking plaza'); await renderLot(cx, cz); await decorate(cx, cz); done[key] = 'Parking & Plaza' }
        else if (t === 'hillhouse') {
          pushEvent('NUTTUM', 'terracing a hillside for a home'); const baseY = await raiseHill(cx, cz)
          pushEvent('PLAN', `designing ${zone.name} @ grid(${gi},${gj})`); const spec = await askSpec(gi, gj, zone)
          pushEvent('NUTTUM', cleanSay(spec.say) || `a house on the hill`); bot.chat(cleanSay(spec.say) || `a house on the hill`)
          await renderTower(ox, oz, zone, spec, baseY); done[key] = String(spec.name || zone.name).slice(0, 40)
        }
        else if (t === 'villa') {
          await renderYard(cx, cz)
          pushEvent('PLAN', `designing ${zone.name} @ grid(${gi},${gj})`); const spec = await askSpec(gi, gj, zone)
          pushEvent('NUTTUM', cleanSay(spec.say) || `a villa with a garden`); bot.chat(cleanSay(spec.say) || `a villa with a garden`)
          await renderTower(ox, oz, zone, spec); done[key] = String(spec.name || zone.name).slice(0, 40)
        }
        else {   // AI-designed building on a paved street block
          await pave(cx, cz)
          pushEvent('PLAN', `designing ${zone.name} @ grid(${gi},${gj})`)
          const spec = await askSpec(gi, gj, zone)
          pushEvent('NUTTUM', cleanSay(spec.say) || `building ${zone.name}`); bot.chat(cleanSay(spec.say) || `building a ${zone.name}`)
          await renderTower(ox, oz, zone, spec)
          await decorate(cx, cz)                 // streetlights + street trees
          done[key] = String(spec.name || zone.name).slice(0, 40)
        }
        saveProgress(); pushEvent('BUILD', `${done[key]} complete`)
        cmd(`/dynmap radiusrender 30`)   // keep the web map current for this block
        console.log(`[${buildingsCount()}] ${zone.type} "${done[key]}" @ grid(${gi},${gj})`)
      } catch (e) { console.error(`plot(${gi},${gj})`, e.message); pushEvent('ERR', `retrying ${zone.name}`); await sleep(2500) }
      await sleep(2200)   // let the map + viewer catch up between buildings
    }
    await sleep(60000)
  }
}

bot.once('spawn', () => {
  console.log('spawned as', NAME); bot.loadPlugin(pathfinder)
  try { const md = require('minecraft-data')(bot.version); const m = new Movements(bot, md); m.canDig = false; bot.pathfinder.setMovements(m) } catch (e) {}
  if (mineflayerViewer) { try { mineflayerViewer(bot, { port: VIEWER_PORT, firstPerson: false, viewDistance: 3 }); console.log('viewer on', VIEWER_PORT) } catch (e) { console.error('viewer', e.message) } }
  run().catch(e => console.error('run err', e))
})
bot.on('chat', (u, m) => { if (u && u !== NAME) { recentChat.push(`${u}: ${m}`); if (recentChat.length > 8) recentChat.shift(); pushEvent('CHAT', `${u}: ${m}`) } })
bot.on('kicked', (r) => console.log('KICKED:', r))
bot.on('error', (e) => console.log('ERROR:', e.message))
bot.on('end', (r) => console.log('END:', r))
