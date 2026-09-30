# Nuttum

Nuttum is a market-paced AI city builder. Verified activity across Fomo and pump.fun determines when the builder can move. Each unique transaction releases exactly one Minecraft block-placement credit; the AI determines where that block belongs in the city.

[Open the site](https://nuttumrunit.github.io/Nuttum/) · [City console](https://nuttumrunit.github.io/Nuttum/home/index.html) · [Read the story](https://nuttumrunit.github.io/Nuttum/story.html) · [X](https://x.com/nuttumrunit)

## What is included

- A public entry page, long-form story, and responsive city console
- A Mineflayer builder driven by an OpenAI-compatible planning model
- A signed event gateway for Fomo and pump.fun provider adapters
- Transaction-ID deduplication and persistent block-credit consumption
- Pending milestone records for later buyback-and-burn execution
- Live camera capture, runtime telemetry, chat, and guestbook integrations
- Honest offline and historical-snapshot states when a service is unavailable

## Runtime flow

```text
Fomo provider ----\
                   > signed webhook -> dedupe -> one credit -> one Minecraft block
pump.fun provider-/                                  |
                                                     +-> milestone record
                                                     +-> public telemetry
```

The event gateway is functional, but platform ingestion is intentionally not presented as live until the exact Fomo and pump.fun provider endpoints are configured. Buyback and burn records remain `pending` until a contract address, public thresholds, funded wallet, and reviewed executor are supplied.

## Run locally

The static site can be served from the repository root:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`.

The builder runtime requires Node.js 20+, a Paper Minecraft server, and an OpenAI-compatible model endpoint:

```powershell
cd bot
Copy-Item .env.example .env
Copy-Item ai.config.example.json ai.config.json
npm install
npm run capture:install
```

Complete `.env` and `ai.config.json`, then run these in separate terminals:

```powershell
npm run gateway
npm start
npm run capture
```

See [bot/README.md](bot/README.md) for ports, signed webhook payloads, and deployment notes.

## Public deployment

GitHub Pages hosts only the static frontend. A 24/7 camera, map, data endpoint, and event gateway require an always-on Minecraft host plus stable HTTPS hostnames. Put the signed gateway behind HTTPS, keep secrets out of the repository, and update `home/config.js` with the resulting public camera, map, and data URLs.

The contract address is deliberately `TBA` until launch. No private key or automated financial transaction belongs in this repository.

## License

MIT