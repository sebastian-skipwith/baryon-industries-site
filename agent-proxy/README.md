# Baryon relay: World Model agent, live aircraft, Reclaim

One Cloudflare Worker serves three site features. Nothing breaks without it:

- **World Model** (`/world`): the free local command engine works for everyone, and visitors
  can paste their own Anthropic key in **Ask → Settings**.
- **Reclaim** (`/reclaim`): appraising a pasted listing, the price tables, the pipeline and the
  calculator all work, and visitors can use their own Anthropic key. Only the Marketplace
  scanner says "not deployed yet". Copper prices fall back to the dated `/data/copper.json`.

## What the Worker adds

1. **Hosted Claude** (`POST /v1/messages`) for the World Model agent and Reclaim's AI, paid
   from your Anthropic account with a spending limit:
   - only the models listed in `worker.js`, `max_tokens` capped, only the `web_search` server tool
   - the system prompt must start with the World Model agent's preamble or Reclaim's
     (`You are Reclaim, Baryon's material arbitrage engine.`), so nobody can use the relay as a
     free general-purpose Claude endpoint
   - World Model: `PER_IP_PER_HOUR` requests per network per hour. Reclaim:
     `RECLAIM_MSGS_PER_IP_PER_DAY` messages per network per day (default 60).
   - one shared hard ceiling, `DAILY_BUDGET_USD` (default $5 a day), metered from real token
     usage plus $0.01 per web search
2. **Live aircraft** (`GET /adsb/v2/point/{lat}/{lon}/{nm}`): relays
   [adsb.lol](https://adsb.lol) (ODbL), edge-cached for 8 s, limited per network. No key needed.
3. **Reclaim**:

   | Route | What it does |
   |---|---|
   | `GET /reclaim/sweep?q=&location=City, ST&lat=&lng=&limit=≤40` | Searches Facebook Marketplace through your RapidAPI subscription to PullAPI's `facebook-scraper-api9`. Results are cleaned up on the server: fields the scraper shifted are repaired (a "Just listed" title, or a bare `$80` title with the old price in `location`), the price is the first `$` amount (`$80$99` → 80, `Free` → 0), and every listing gets `flags.shipped`, `flags.wanted` (buyers, haulers and stripping services rather than sellers) and `flags.repaired`. Nothing is dropped; when the scraper lost a title entirely, `title` is `""` with `flags.repaired` set and the listing link still works. Identical sweeps (same query and home base) are cached for 30 minutes, and a cached sweep doesn't use up anyone's scans. |
   | `GET /reclaim/img?u=` | Relays Marketplace photos with CORS so the browser can send them to the AI. Only https URLs on `fbcdn.net` and Meta's `scontent*.cdninstagram.com` image hosts (default port, no credentials, redirects only inside those hosts), only raster photos (JPEG, PNG, WebP, GIF, AVIF, HEIC; never SVG or HTML), 5 MB at most. |
   | `GET /reclaim/listing?id=` | Always answers `{ok:false, code:"unsupported"}`. The scraper's documented endpoints are only page, profile, posts and Marketplace search, so there is no listing-detail call that returns descriptions or full photo sets. |
   | `GET /reclaim/prices` | A copper reference price with its source, date and licence (see below), kept in KV and refreshed by a Cron Trigger twice a day. |

   The scanner caps protect your RapidAPI quota: `SWEEP_PER_IP_PER_DAY` (default 8) per
   network and `SWEEP_PER_DAY` (default 150) for the whole site, both resetting at midnight
   UTC. A network is one IPv4 address or one IPv6 /64 (a home or phone gets a whole /64, so
   counting single IPv6 addresses would let one person rotate past the cap). If a scrape
   fails, the visitor gets the scan back, at most twice a day, so a query that always fails
   can't be replayed to burn the site total. Failed scrapes still count toward the site total
   because RapidAPI may have billed the call. The scraper often takes 20–40 s, so the relay
   waits up to `SWEEP_TIMEOUT_MS` (55 s).

The RapidAPI key, the Anthropic key and the optional MetalCharts and Metals.Dev keys exist
only as Worker secrets. They never reach the browser, this repo or a log, the Worker writes no
logs, and any upstream error text that quotes a key is redacted before it is passed on.

## Deploy (about ten minutes, Cloudflare free plan)

```bash
cd agent-proxy
npx wrangler login
npx wrangler kv namespace create BUDGET      # paste the printed id into wrangler.toml
npx wrangler secret put RAPIDAPI_KEY         # Reclaim scanner: your RapidAPI key for facebook-scraper-api9
npx wrangler secret put METALCHARTS_KEY      # recommended: daily COMEX copper (free MetalCharts account, see below)
npx wrangler secret put ANTHROPIC_API_KEY    # optional: hosted Claude for /world and /reclaim
npx wrangler deploy --dry-run                # first time: checks the bundle without deploying
npx wrangler deploy                          # prints https://baryon-world-agent.<you>.workers.dev
```

`wrangler deploy` also registers the cron in `wrangler.toml` (`17 5,17 * * *`, UTC).
Paste each key when prompted. None of them goes into the repo.

Then edit `/world/config.js`, commit and push:

```js
agentEndpoint: "https://baryon-world-agent.<you>.workers.dev", // only if you set ANTHROPIC_API_KEY
liveRelay:     "https://baryon-world-agent.<you>.workers.dev", // live aircraft on /world
reclaimRelay:  "https://baryon-world-agent.<you>.workers.dev", // Reclaim scanner, photos, prices
```

Reclaim uses `reclaimRelay`, then `agentEndpoint`, then `liveRelay`, so one URL in any of
them turns the scanner on. Only set `agentEndpoint` if `ANTHROPIC_API_KEY` is set. Without
the key, `/v1/messages` answers 503 "hosted AI isn't switched on" and both apps keep
offering visitors their own key.

### Check it after deploying

```bash
R=https://baryon-world-agent.<you>.workers.dev
O='Origin: https://baryon.industries'
curl -s -H "$O" "$R/reclaim/prices"
curl -s -H "$O" "$R/reclaim/sweep?q=copper%20wire&location=Macon,%20GA&limit=5"   # uses 1 scan
curl -s -H "$O" "$R/reclaim/listing?id=1"                                          # 400 bad_request
```

Requests without an allowed `Origin` get a 403 (`ALLOWED_ORIGINS` lists
`https://baryon.industries` and `http://localhost:8124`).

## Copper reference price

- **Default, no key:** World Bank Commodity Price Data (The Pink Sheet), monthly. The relay
  reads the newest month's "Copper (LME), grade A … settlement price" in US$/tonne from
  `CMO-Historical-Data-Monthly.xlsx`, converts it to US$/lb, and labels it as a monthly
  average with `asOf` set to the month's last day, plus `published` and `nextUpdate`. Licence:
  **CC BY 4.0**, which the World Bank Data Catalog applies to its datasets by default and
  which allows commercial use with attribution. Credit it as "The World Bank: Commodity Price
  Data (The Pink Sheet)". The workbook's URL is read from the commodity-markets page on every
  refresh; set the `PINK_SHEET_XLSX_URL` var to pin it. Refreshes send `If-Modified-Since`,
  so they cost almost nothing until the next monthly release (the Pink Sheet comes out early
  each month).
- **Recommended, daily COMEX:** `npx wrangler secret put METALCHARTS_KEY` switches to
  [MetalCharts](https://metalcharts.org/copper-price-api) `GET /v1/prices`, COMEX copper
  futures (`HG`) in US$/lb, which is what Reclaim's grade bands are shares of. Its
  [API terms](https://metalcharts.org/api-terms) (updated 18 Oct 2026) allow commercial use on
  every plan, the free tier included, and displaying the data to your own users; the free plan
  requires a visible link to metalcharts.org next to the data, which Reclaim shows (the source
  name links to `sourceUrl`). The free plan (account, no card) allows 200 requests a month; the
  cron uses about 60. Don't build anything that re-serves their feed to others: the terms
  forbid proxying their endpoints, and they note some data reaches them from exchanges under
  their own terms. The relay rejects a MetalCharts answer that is marked stale, more than 5
  days old, not COMEX, or outside $0.50–40/lb, and falls back to the next source.
- **Optional, intraday LME:** `npx wrangler secret put METALS_DEV_KEY` uses
  [Metals.Dev](https://metals.dev) `lme_copper` (at most 60 s delayed) when MetalCharts isn't
  set or fails. Metals.Dev's terms allow publishing its rates on websites "as long as you
  maintain an active subscription", so only use a paid-plan key here.
- **Not used:** LME and CME/COMEX data directly, which need a redistribution licence; IMF data
  (also behind FRED's copper series), where commercial reuse needs permission; the free plans
  of metals-api.com and metalpriceapi.com, which forbid commercial use; and Yahoo or Kitco
  pages, which forbid it in their terms.
- **CPU (World Bank only):** when a new month is published, the relay unpacks a 2.4 MB
  worksheet. On the real October 2026 workbook that took 15–45 ms of CPU (about 100 ms cold)
  in Node, more than the Workers Free plan's 10 ms, so on Free the refresh may be cut off.
  Visitors never wait on a refresh when a value is stored: they get it at once (marked
  `stale: true` once it is over a day old) while one background attempt an hour tries again.
  With nothing stored yet, one request an hour tries while it waits and the rest get a 503, so
  the site shows `/data/copper.json`. A MetalCharts key (a small JSON answer) or Workers Paid
  ($5 a month) avoids the problem.
- **`/data/copper.json`** is the dated value the site shows until the relay is deployed
  (September 2026 average: $14,474/t = $6.5653/lb, published 2 Oct 2026, checked against the
  workbook itself). Update it by hand after each monthly release (next: 3 Nov 2026), or leave
  it once the relay is live.

The reference price is for refined copper on an exchange. Scrap yards pay well below it, so
Reclaim always shows yard prices as ranges and tells people to check with their yard.

## Costs and limits to know

- **KV writes:** Workers Free allows 1,000 KV writes a day. Each uncached sweep uses 3 (5 when
  a failed scrape is given back), a hosted AI message 2, an aircraft poll 1, and the price feed
  up to about 4 a day. A busy day of 150 sweeps plus 250 AI messages comes close to the limit.
  KV also accepts only one write a second to the same key (the site-wide scan count), so a
  refused write is retried up to three times; if KV still refuses, sweeps **pause**
  (`quota_day`) rather than running uncounted. Workers Paid includes 1 million writes a month.
- **Caps are approximate across the globe.** KV is eventually consistent (up to about 60 s)
  between Cloudflare locations, so someone spreading requests across locations could slightly
  exceed a cap. Requests that reach the same Worker instance are counted exactly, because
  counters are also held in memory.
- **Caching:** the Cache API does nothing on `*.workers.dev`, so sweeps are also cached in KV.
  On a custom domain, both caches are used.
- **Meta's terms:** scraping Marketplace goes against Meta's terms of service. That risk was
  accepted knowingly. The relay shows only what the scraper returns, links every listing back
  to Facebook, and never stores listings beyond the 30-minute cache.

## Local development

`node C:/Users/sebas/.baryon-dev/relay-dev.mjs` runs this exact `worker.js` on
`http://localhost:8787`, with in-memory KV, fake secrets, a fixture of 96 real Marketplace
rows (shifted rows included), a stand-in photo and a canned copy of `/data/copper.json`. It
never calls RapidAPI or Anthropic, and it only answers requests from this machine. Its header
comment lists the options and test queries.

The Worker's tests (fake keys, every upstream intercepted) are in
`C:/Users/sebas/.baryon-dev/reclaim-build/worker-review/`; they supersede the first suite in
`worker-test/`, two of whose expectations changed on purpose (refund limit, price-refresh
backoff):

```bash
cd C:/Users/sebas/.baryon-dev/reclaim-build/worker-review
node --no-warnings --test                      # 45 tests, incl. a diff against the pre-Reclaim worker
node --no-warnings mutants.mjs                 # re-breaks each fix; every test must catch its bug
node --no-warnings relay-dev.contract.check.mjs  # relay-dev over HTTP on ports 8798/8799
```
