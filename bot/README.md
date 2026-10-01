# Mokkin runtime

Mokkin is a market paced Minecraft city builder. The runtime observes verified Fomo and pump.fun trades, deduplicates them globally by Solana transaction signature, and releases exactly one block placement credit per accepted trade.

## Requirements

- Node.js 20+
- A Paper Minecraft server with command permission for the offline `Mokkin` player
- squaremap for the public world map
- An OpenAI compatible model endpoint for new building plans
- A stable Solana WebSocket RPC for production traffic
- Stable HTTPS hostnames for public camera, viewer, map, and data access

## Setup

```powershell
cd bot
Copy-Item .env.example .env
Copy-Item ai.config.example.json ai.config.json
npm install
```

Fill in `.env` and `ai.config.json`. Keep both files private.

Start the components in separate terminals:

```powershell
npm run gateway
npm run listener
npm start
npm run capture
```

The default local services are:

- signal gateway: `http://127.0.0.1:8891`
- builder data and health: `http://127.0.0.1:8890`
- viewer: `http://127.0.0.1:3007`

## Onchain verification

`chain-listener.js` opens one Solana WebSocket and maintains three log subscriptions:

- Fomo's observed Solana signer and fee payer: successful transactions containing `Instruction: Swap`
- Official Pump program: successful buy or sell instructions
- Official PumpSwap program: successful buy or sell instructions

Events wait briefly for cross source attribution. A transaction carrying both Fomo and PumpSwap evidence is classified as Fomo, then the gateway performs a second global signature deduplication. Failed transactions are never submitted.

The default public Solana RPC is suitable for development but has no capacity guarantee. Set `NUTTUM_SOLANA_WS` to a dedicated provider endpoint for continuous production ingestion.

The signed gateway still accepts private adapters at `/events/fomo` and `/events/pumpfun`. Every event must contain a stable `signature`, `txHash`, `transaction`, or `id`. When `NUTTUM_WEBHOOK_SECRET` is configured, include `x-nuttum-signature`, the hex HMAC SHA 256 of the raw body.

`GET /health` and `GET /signals` show accepted totals, recent signatures, and minute buckets. The bot stores consumed credits in `signal-consumption.json`. Configured block milestones are written to `milestones.json` with `pending` status. No wallet or token transaction is sent automatically.

Site: <https://mokkin.fun/>

## License

MIT