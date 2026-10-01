// Public runtime settings. These temporary HTTPS endpoints expose the real local builder.
// Move them to a named Cloudflare Tunnel before treating the runtime as 24/7 production.
window.NUTTUM = {
  cam: 'https://resumes-bosnia-nsw-glen.trycloudflare.com/cam',
  camMode: 'image',
  viewer: 'https://binary-oops-district-rogers.trycloudflare.com/',
  health: 'https://resumes-bosnia-nsw-glen.trycloudflare.com/health',
  map: 'https://resumes-bosnia-nsw-glen.trycloudflare.com/map/',
  data: '',
  snapshot: '../data/mokkin-live.json',
  contractAddress: '6KRs8XJmSGHRqRRrfGo12ADN32cFHxPZ3uRgMTsppump',
  network: 'solana-mainnet',
  status: {
    fomo: 'live-onchain',
    pumpfun: 'live-onchain',
    buyback: 'awaiting-launch'
  }
};