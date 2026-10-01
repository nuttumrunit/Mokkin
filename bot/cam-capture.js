// Renders the local live view and saves a fresh frame every couple seconds.
// Runs on the host (localhost is fast), so the frame is always the real world — visitors just
// see an image that refreshes, which is light enough for anyone, anywhere.
require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const { chromium } = require('playwright')
const path = require('path')
const OUT = path.resolve(process.env.NUTTUM_CAM_FILE || path.join(__dirname, '..', 'data', 'cam.jpg'))
const URL = process.env.NUTTUM_VIEWER_URL || 'http://localhost:' + (process.env.NUTTUM_VIEWER_PORT || 3007)

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.NUTTUM_BROWSER_CHANNEL || 'msedge',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-webgl']
  })
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  await page.goto(URL, { waitUntil: 'load', timeout: 40000 })
  await page.waitForTimeout(9000)   // let the world stream in + render
  console.log('cam-capture: streaming frames ->', OUT)
  let n = 0
  while (true) {
    try { await page.screenshot({ path: OUT, type: 'jpeg', quality: 72 }); if (++n % 20 === 0) console.log('frames', n) }
    catch (e) { console.log('shot err', e.message) }
    await page.waitForTimeout(2500)
  }
})().catch(e => { console.error('cam-capture fatal:', e.message); process.exit(1) })
