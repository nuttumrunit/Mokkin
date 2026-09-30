# Nuttum runtime

Nuttum is a market-paced Minecraft city builder. The runtime accepts verified Fomo and pump.fun events, deduplicates them by transaction ID, and releases exactly one block-placement credit per accepted trade.

## Requirements

- Node.js 20+
- A Paper Minecraft server with command permission for the offline `Nuttum` player
- Dynmap if the public world map is required
- An OpenAI-compatible model endpoint
- Stable HTTPS hostnames (for example, named Cloudflare Tunnels) for public camera, map, and data access

## Setup

```powershell
cd bot
Copy-Item .env.example .env
Copy-Item ai.config.example.json ai.config.json
npm install
npm run capture:install
```

Fill in `.env` and `ai.config.json`. Keep both files private.

Start the components in separate terminals:

```powershell
npm run gateway
npm start
npm run capture
```

The default local services are:

- signal gateway: `http://127.0.0.1:8891`
- builder data and health: `http://127.0.0.1:8890`
- viewer: `http://127.0.0.1:3007`

## Feeding verified trades

Your provider adapter should POST either one event or an `events` array to `/events/fomo` or `/events/pumpfun`. Every event must contain a stable `signature`, `txHash`, `transaction`, or `id`.

```json
{"events":[{"signature":"a-real-chain-transaction-signature"}]}
```

When `NUTTUM_WEBHOOK_SECRET` is configured, include `x-nuttum-signature`, the hex HMAC SHA-256 of the raw request body. Never expose an unsigned gateway to the internet.

`GET /health` and `GET /signals` show accepted and deduplicated totals. The bot stores consumed credits in `signal-consumption.json`. Configured block milestones are written to `milestones.json` with `pending` status. No wallet or token transaction is sent automatically.

For a temporary local demonstration only, set `NUTTUM_SIGNAL_MODE=legacy`. Production should remain `market`.

Site: <https://nuttumrunit.github.io/Nuttum/> · MIT License