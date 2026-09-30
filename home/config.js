// Public runtime settings. Keep unavailable services empty so the UI reports them honestly.
// For 24/7 service, replace the empty values with stable HTTPS hostnames from a named tunnel.
window.NUTTUM = {
  cam: '',
  map: '',
  data: '',
  snapshot: 'nuttum-live.json',
  contractAddress: '',
  network: 'solana-mainnet',
  status: {
    fomo: 'awaiting-feed',
    pumpfun: 'awaiting-feed',
    buyback: 'awaiting-launch'
  }
};