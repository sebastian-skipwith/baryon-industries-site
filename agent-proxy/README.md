# World Model relay: hosted agent + live aircraft (optional)

The World Model works for everyone without this: the free local command engine
understands "fly to…", "copper mines in Chile", "show earthquakes", "night vision",
dates, measurements and more, and visitors can paste their own Anthropic key in
**Ask → Settings** for the full Claude agent (the key stays in their browser and
is sent only to Anthropic).

Deploying this one Cloudflare Worker adds two things:

1. **The Claude agent for every visitor**, on your Anthropic account, with the spend bounded:
   - only `POST /v1/messages`, only the models listed in `worker.js`
   - the system prompt must be the World Model agent's, so it can't be used as a free
     general-purpose Claude endpoint; only the `web_search_20250305` server tool is allowed
   - `PER_IP_PER_HOUR` requests per network per hour
   - a hard `DAILY_BUDGET_USD` ceiling (default $5/day) metered from real token usage
     plus $0.01 per web search
2. **Live aircraft.** No aircraft feed that is free for commercial use lets browsers
   call it directly. `GET /adsb/v2/point/{lat}/{lon}/{nm}` relays
   [adsb.lol](https://adsb.lol) (ODbL), edge-cached for 8 s and limited per network.
   No key is involved.

## Deploy (about five minutes, Cloudflare free plan)

```bash
cd agent-proxy
npx wrangler login
npx wrangler kv namespace create BUDGET      # paste the printed id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY    # paste your key when prompted — it never enters this repo
npx wrangler deploy                          # prints https://baryon-world-agent.<you>.workers.dev
```

Then in `/world/config.js` set both `agentEndpoint` and `liveRelay` to that URL,
commit and push. The Ask panel switches to "hosted" automatically and the Live
Earth panel gains the aircraft layer.

To run only the aircraft relay, skip the `secret put` step and set only `liveRelay`.
