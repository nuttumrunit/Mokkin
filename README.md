# Mokkin

Mokkin is a market-paced AI city builder. Verified activity across Fomo and pump.fun determines when the builder can move. Each unique transaction releases exactly one Minecraft block placement credit; the AI determines where that block belongs in the city.

[Open the site](https://mokkin.fun/) · [City console](https://mokkin.fun/home/index.html) · [Read the story](https://mokkin.fun/story.html) · [X](https://x.com/mokkinlabs)

## What is included

- A public entry page, long form story, and responsive city console
- A Mineflayer builder driven by an OpenAI compatible planning model
- A live Solana listener for Fomo trades, Pump bonding curve trades, and PumpSwap trades
- Successful transaction filtering, global signature deduplication, and one minute activity buckets
- Persistent block credit consumption and pending milestone records
- Live camera capture, world map, runtime telemetry, chat, and guestbook integrations

## Runtime flow

```text
Fomo Solana signer ---\
                       > successful swap or trade -> global signature dedupe -> one block credit
Pump + PumpSwap ------/                                                   |
                                                                          +-> milestone record
                                                                          +-> public telemetry
```

The Fomo app does not publish a developer API. Mokkin therefore observes its public Solana signer and accepts only successful transactions containing a swap instruction. Pump.fun activity is read from the official Pump and PumpSwap program addresses and accepts only successful buy or sell instructions. If one Fomo trade routes through PumpSwap, Fomo wins attribution and the signature is counted once.

The current Fomo feed covers Solana. Other Fomo supported chains are not silently estimated. Buyback and burn records remain `pending` until a contract address, public thresholds, funded wallet, and reviewed executor are supplied.

## Run locally

The static site can be served from the repository root:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

The runtime requires Node.js 20+, a Paper Minecraft server, squaremap, and an OpenAI compatible model endpoint:

```powershell
cd bot
Copy-Item .env.example .env
Copy-Item ai.config.example.json ai.config.json
npm install
```

Run these in separate terminals:

```powershell
npm run gateway
npm run listener
npm start
npm run capture
```

The listener defaults to Solana's public RPC. Use a dedicated `NUTTUM_SOLANA_WS` endpoint for production uptime and capacity. See [bot/README.md](bot/README.md) for ports, verification rules, and deployment notes.

## Public deployment

GitHub Pages hosts only the static frontend. A 24/7 camera, map, data endpoint, listener, and Minecraft runtime require an always on host plus stable HTTPS hostnames. Keep the event gateway on localhost, keep secrets out of the repository, and update `home/config.js` with stable public camera, viewer, map, and data URLs.

The contract address is deliberately `TBA` until launch. No private key or automated financial transaction belongs in this repository.

## License

MIT