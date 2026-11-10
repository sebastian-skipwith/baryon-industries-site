// Baryon relay (Cloudflare Worker): World Model hosted agent, live aircraft, and Reclaim.
// Lets every visitor use the World Model agent and Reclaim's AI without their own API key,
// scan Facebook Marketplace through the owner's RapidAPI scraper, and read a dated copper
// reference price, while keeping every key server-side and every cost bounded.
//
// Routes
//   POST /v1/messages        hosted Claude proxy (World Model agent or Reclaim only)
//   GET  /adsb/v2/point/…    live aircraft near a point (adsb.lol, ODbL)
//   GET  /reclaim/sweep      Marketplace search, normalised + flagged, cached 30 min
//   GET  /reclaim/img        CORS image relay for Marketplace photos (fbcdn only, ≤ 5 MB)
//   GET  /reclaim/listing    listing detail; the scraper has no detail endpoint → "unsupported"
//   GET  /reclaim/prices     copper reference price (World Bank Pink Sheet; MetalCharts or
//                            Metals.Dev when their key is set)
//   cron                     refreshes the copper price into KV (visitors never wait on it)
//
// Guards (all enforced here, never trusted from the browser):
//   - Origin allowlist (baryon.industries + local dev)
//   - /v1/messages: model allowlist; max_tokens cap; tool allowlist; the system prompt must
//     start with the World Model agent's or Reclaim's fixed preamble, so the proxy can't be
//     used as a general-purpose free Claude endpoint
//   - World Model: per-IP hourly requests; Reclaim: per-IP daily messages; both: a hard
//     daily USD budget (KV counters)
//   - Marketplace sweeps: per-IP and global daily caps, so strangers can't drain the
//     RapidAPI quota; identical sweeps are served from cache and cost nothing. Reclaim's
//     per-network caps count an IPv6 /64 as one network (one home connection gets a whole /64).
//
// Bindings (wrangler.toml): KV namespace BUDGET; secrets ANTHROPIC_API_KEY and RAPIDAPI_KEY
// (each optional: its feature answers "not configured" without it), METALCHARTS_KEY and
// METALS_DEV_KEY (both optional; without them the copper price comes from the keyless World
// Bank source);
// vars DAILY_BUDGET_USD, PER_IP_PER_HOUR, RECLAIM_MSGS_PER_IP_PER_DAY, SWEEP_PER_IP_PER_DAY,
// SWEEP_PER_DAY, SWEEP_TIMEOUT_MS, ALLOWED_ORIGINS, PINK_SHEET_XLSX_URL (optional). Secrets are
// never logged or echoed.

const PRICES = {
  // $ per million tokens (input, output) — keep in sync with Anthropic pricing.
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};
const MAX_TOKENS_CAP = 12000;
const SYSTEM_PREFIX = "You are the Baryon World Model agent.";
const RECLAIM_PREFIX = "You are Reclaim, Baryon's material arbitrage engine.";
const ALLOWED_SERVER_TOOLS = new Set(["web_search_20250305"]);
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
const MAX_MESSAGE_BYTES = 20 * 1024 * 1024; // Reclaim sends listing photos; Anthropic's own cap is 32 MB
const ADSB_PER_IP_PER_HOUR = 900; // the World Model polls every 10 s at most

const RAPIDAPI_HOST_DEFAULT = "facebook-scraper-api9.p.rapidapi.com";
const SWEEP_MAX_LIMIT = 40; // one upstream call always asks for 40; visitors get a slice
const SWEEP_CACHE_SECONDS = 30 * 60;
const SWEEP_EMPTY_CACHE_SECONDS = 5 * 60; // an empty answer may be a scraper hiccup
// A failed scrape gives the visitor their scan back, but only this many times a day: otherwise
// one network could replay a query that always fails and burn the site-wide allowance for free.
const SWEEP_REFUNDS_PER_IP_PER_DAY = 2;
const KV_RETRY_MS = 1100; // KV allows one write per second to the same key
const IMG_MAX_BYTES = 5 * 1024 * 1024;
const IMG_PER_IP_PER_HOUR = 600; // in-isolate only (no KV write per photo)
const IMG_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]);
const LB_PER_TONNE = 2204.62262185;
const LB_PER_KG = 2.20462262185;
const TROY_OZ_PER_LB = 14.5833333333;
const PRICE_KV_KEY = "reclaim:price:copper:v1";
const PRICE_ATTEMPT_KV_KEY = "reclaim:price:copper:attempt:v1";
const PRICE_REFRESH_AFTER_MS = 26 * 3600 * 1000; // cron runs twice a day; older than this = stale
const PRICE_RETRY_SECONDS = 3600; // at most one refresh attempt an hour outside the cron
const PINK_SHEET_PAGE = "https://www.worldbank.org/en/research/commodity-markets";
// Current workbook (Oct 2026 release). The page above is checked first because the
// document id in this URL changes from year to year.
const PINK_SHEET_XLSX =
  "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
const UA = "baryon-reclaim (+https://baryon.industries/reclaim)";

// ---------------------------------------------------------------------------------------
// Small shared helpers

const utcDay = () => new Date().toISOString().slice(0, 10);
const secondsToUtcMidnight = () => {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
};
const intVar = (v, dflt, min = 0) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? n : dflt;
};

function jsonResponse(status, body, cors, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", ...extra },
  });
}

// Counters live in KV (shared across the edge, eventually consistent) and in this isolate's
// memory (exact for bursts that land on the same isolate). The higher of the two wins.
const memByNamespace = new WeakMap();
function memFor(env) {
  const ns = env.BUDGET && typeof env.BUDGET === "object" ? env.BUDGET : memFor;
  let m = memByNamespace.get(ns);
  if (!m) memByNamespace.set(ns, (m = new Map()));
  return m;
}
function memGet(env, key) {
  const m = memFor(env);
  const e = m.get(key);
  if (!e) return 0;
  if (e.exp < Date.now()) {
    m.delete(key);
    return 0;
  }
  return e.n;
}
function memSet(env, key, n, ttlSec) {
  const m = memFor(env);
  m.set(key, { n, exp: Date.now() + ttlSec * 1000 });
  if (m.size > 5000) {
    const now = Date.now();
    for (const [k, v] of m) if (v.exp < now) m.delete(k);
    if (m.size > 5000) m.clear();
  }
}
async function readCounter(env, key) {
  const kv = Number((await env.BUDGET.get(key)) || 0);
  return Math.max(Number.isFinite(kv) ? kv : 0, memGet(env, key));
}
// The in-memory count is set at once (synchronously), so a check-then-bump with no await in
// between is exact within this isolate. KV refuses a second write to the same key within a
// second, so a refused write is retried (up to 3 times, with jitter) with this isolate's latest
// count, and skipped once a later write from this isolate has already stored this bump.
const writeSeqByNamespace = new WeakMap();
function writeSeq(env, key) {
  const ns = env.BUDGET && typeof env.BUDGET === "object" ? env.BUDGET : memFor;
  let m = writeSeqByNamespace.get(ns);
  if (!m) writeSeqByNamespace.set(ns, (m = new Map()));
  let s = m.get(key);
  if (!s) {
    if (m.size > 5000) m.clear();
    m.set(key, (s = { seq: 0, stored: 0 }));
  }
  return s;
}
async function bumpCounter(env, key, current, ttlSec, delta = 1) {
  const n = Math.max(0, current + delta);
  memSet(env, key, n, ttlSec);
  const s = writeSeq(env, key);
  const mine = ++s.seq;
  for (let attempt = 0; ; attempt++) {
    if (s.stored >= mine) return;
    const covers = s.seq;
    const latest = memFor(env).has(key) ? memGet(env, key) : n;
    try {
      await env.BUDGET.put(key, String(latest), { expirationTtl: ttlSec });
      s.stored = Math.max(s.stored, covers);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, KV_RETRY_MS + Math.floor(Math.random() * 1500)));
    }
  }
}
const quiet = (p) => Promise.resolve(p).catch(() => {});

// One network = one IPv4 address, or one IPv6 /64 (a single home or phone gets a whole /64,
// so counting full IPv6 addresses would let one visitor rotate past every per-network cap).
function networkOf(ip) {
  const s = String(ip || "unknown").trim().toLowerCase();
  if (!s.includes(":")) return s;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(s)) return s.slice(7); // IPv4-mapped
  const [head, tail] = s.split("%")[0].split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  if (groups.length < 4 || groups.slice(0, 4).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// Defence in depth: never echo a secret, even if an upstream quotes it back in an error.
function redact(env, text) {
  let t = String(text ?? "");
  for (const k of [env.RAPIDAPI_KEY, env.ANTHROPIC_API_KEY, env.METALS_DEV_KEY, env.METALCHARTS_KEY]) {
    if (typeof k === "string" && k.length >= 8 && t.includes(k)) t = t.split(k).join("[redacted]");
  }
  return t;
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------
// GET /adsb/v2/point/{lat}/{lon}/{nm} — live aircraft near a point from adsb.lol
// (ODbL), which sends no CORS headers. Edge-cached for a few seconds so many
// visitors looking at the same area share one upstream call.
async function relayAdsb(url, env, ctx, ip, cors) {
  const m = url.pathname.match(/^\/adsb\/v2\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  const json = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json", ...extra } });
  if (!m) return json(404, { error: "Use /adsb/v2/point/{lat}/{lon}/{nm}" });
  const lat = Number(m[1]), lon = Number(m[2]), nm = Math.min(250, Number(m[3]));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !(nm > 0)) return json(400, { error: "Bad coordinates." });

  const key = `adsb:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const used = Number((await env.BUDGET.get(key)) || 0);
  if (used >= ADSB_PER_IP_PER_HOUR) return json(429, { error: "Too many aircraft requests from this network." });
  ctx.waitUntil(env.BUDGET.put(key, String(used + 1), { expirationTtl: 7200 }));

  // Snap to a 0.5° grid and 50 nm steps so nearby views share a cache entry.
  const snap = (v) => (Math.round(v * 2) / 2).toFixed(1);
  const upstream = `https://api.adsb.lol/v2/point/${snap(lat)}/${snap(lon)}/${Math.min(250, Math.ceil(nm / 50) * 50)}`;
  const res = await fetch(upstream, { cf: { cacheTtl: 8, cacheEverything: true }, headers: { "user-agent": "baryon-world-model (+https://baryon.industries/world)" } });
  if (!res.ok) return json(res.status === 429 ? 429 : 502, { error: `adsb.lol answered ${res.status}` });
  return new Response(res.body, {
    status: 200,
    headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=5", "x-data-licence": "ODbL 1.0, © adsb.lol contributors" },
  });
}

// ---------------------------------------------------------------------------------------
// Reclaim — Marketplace listing normalisation
//
// The scraper returns {listing_id, title, price, location, image_url, listing_url,
// seller_name} per listing, but its fields sometimes shift: the title can be the badge
// "Just listed" (real title in `location`), or a bare price like "$80" with the
// struck-through old price in `location` ("$99") and `price` = "$80$99". Nothing is
// dropped silently; repaired rows carry flags.repaired.

const PRICE_ONLY = /^(?:free|\$\s?\d[\d,]*(?:\.\d+)?(?:\s*\$\s?\d[\d,]*(?:\.\d+)?)*)$/i;
const BADGE_ONLY = /^(?:just listed|new listing|sponsored)$/i;
const US_STATES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia|Puerto Rico";
const PLACE = new RegExp(`^[\\p{L}\\p{M}.'’\\- ]{2,60},\\s*(?:[A-Z]{2}|${US_STATES})$`, "u");
const SHIPS = /^ships to you$/i;
// Ads from people buying, hauling, clearing out or stripping — competitors, not sellers. Each
// rule is narrow on purpose: sellers write "serious buyers only", "repair needed", "you haul
// it", "pick up only" and "buyer responsible for removal", and those must stay unflagged.
const WANTED = [
  /\b(?:wtb|iso|in search of)\b/i,
  /\bwanted\b/i,
  /\blooking\s+for\b(?!\s+(?:offers?|(?:a\s+)?(?:new\s+)?home|someone|somebody|anyone|(?:a\s+)?buyers?|trades?|(?:the\s+)?best\s+offer|cash))/i,
  /(?<!\b(?:repairs?|tlc|work|fix(?:ing)?|parts?|nothing|tools?|cleaning|cleanup|love|some|minor|paint|battery|batteries|cord|charger|assembly)\s+)\bneeded\b/i,
  /\b(?:we|i|will|now)\s+buy\b/i,
  /\bbuying\b/i,
  /(?<!\bserious\s+)\bbuyers?\b(?!\s+(?:only|pays?|must|responsible|picks?\s*-?\s*up|to|will|needs?|has|should|beware|welcome))/i,
  /\b(?:cash\s+for|pay(?:ing)?\s+cash|top\s+dollar|will\s+pay|we\s+pay|paying\s+for)\b/i,
  /\b(?:i|we)(?:\s*['’]ll|\s+(?:can|will|do|also))?\s+(?:pick\s*n?\s*-?\s*up|remove|collect|take\s+(?:your|all|any)|haul\s+(?:away|off|your|scrap|junk|it\s+(?:away|off)))\b/i,
  /\bpicking\s+(?:up|any|all)\b/i,
  /\bwant\s+your\b/i,
  /\b(?:scrap|junk|metal|appliances?|trash|debris)\s+(?:removal|hauling)\b/i,
  /\b(?:removal|hauling|clean\s*-?\s*out)\s+services?\b/i,
  /\bclean\s*-?\s*outs\b/i,
  /\brecogemos\b/i,
  /\bstripping\s+services?\b/i,
  /\b(?:scrap|metal|appliances?|junk)\s+pick\s*-?\s*ups?\b(?!\s+only)/i,
  /\bpick\s*-?\s*ups?\s+(?:all|any|of\s+your|your)\b/i,
  /\bfree\s+pick\s*-?\s*ups?\b(?!\s+only)/i,
  /\bhaul\s+(?:away\s+|off\s+)?your\b/i,
];
const IMG_HOST_OK = (host) =>
  host === "fbcdn.net" || host.endsWith(".fbcdn.net") || /^scontent[a-z0-9.-]*\.cdninstagram\.com$/.test(host);
// A relayable photo URL: https, Meta's image CDN, default port, no credentials.
function imageUrl(v) {
  const u = safeHttpsUrl(v);
  return u && !u.port && !u.username && !u.password && IMG_HOST_OK(u.hostname.toLowerCase()) ? u : null;
}

function cleanText(v, max = 300) {
  if (v == null) return "";
  return String(v)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\uFFFC\uFFFD]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
const fmtUsd = (n) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// price = the FIRST dollar amount ("Free" → 0, "$80$99" → 80, "$1,000" → 1000).
function parsePrice(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? { price: raw, priceText: raw === 0 ? "Free" : fmtUsd(raw) } : { price: null, priceText: "" };
  const t = cleanText(raw, 80);
  if (!t) return { price: null, priceText: "" };
  if (/^free\b/i.test(t)) return { price: 0, priceText: "Free" };
  const amounts = [...t.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter(Number.isFinite);
  if (amounts.length) {
    const p = amounts[0];
    return { price: p, priceText: amounts.length > 1 && amounts[1] !== p ? `${fmtUsd(p)} (was ${fmtUsd(amounts[1])})` : fmtUsd(p) };
  }
  if (/^\d[\d,]*(?:\.\d+)?$/.test(t)) {
    const p = Number(t.replace(/,/g, ""));
    return { price: p, priceText: fmtUsd(p) };
  }
  return { price: null, priceText: t };
}

function safeHttpsUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}
function okImage(v) {
  return imageUrl(v)?.href ?? null;
}

function normaliseListing(raw) {
  if (!raw || typeof raw !== "object") return null;
  let id = cleanText(raw.listing_id ?? raw.id, 40);
  if (!/^\d{5,25}$/.test(id)) {
    const m = String(raw.listing_url ?? raw.url ?? "").match(/\/marketplace\/item\/(\d{5,25})/);
    id = m ? m[1] : "";
  }
  if (!id) return null; // nothing to link to; counted in `skipped`

  let title = cleanText(raw.title);
  let location = cleanText(raw.location, 200);
  let repaired = false, shipped = false;
  const rawPrice = raw.price != null && cleanText(raw.price) !== "" ? raw.price : null;
  const { price, priceText } = parsePrice(rawPrice ?? (PRICE_ONLY.test(title) ? title : null));

  if (SHIPS.test(location)) {
    shipped = true;
    location = "";
  }
  if (!title || BADGE_ONLY.test(title) || PRICE_ONLY.test(title)) {
    if (location && !PRICE_ONLY.test(location) && !PLACE.test(location)) {
      title = location; // the real title slid into the location field
      location = "";
    } else {
      if (PRICE_ONLY.test(location)) location = ""; // the old (struck-through) price slid in
      title = ""; // the scraper lost the real title
    }
    repaired = true;
  } else if (location && PRICE_ONLY.test(location)) {
    location = "";
    repaired = true;
  }

  const description = cleanText(raw.description, 4000) || null;
  const image = okImage(raw.image_url ?? raw.image);
  const photos = [];
  for (const p of [image, ...(Array.isArray(raw.photos) ? raw.photos : []), ...(Array.isArray(raw.images) ? raw.images : [])]) {
    const ok = okImage(p);
    if (ok && !photos.includes(ok) && photos.length < 12) photos.push(ok);
  }
  const text = `${title} ${description || ""}`;
  return {
    id,
    title, // "" when the scraper lost the real title (flags.repaired); the link still works
    price,
    priceText,
    location: location || null,
    url: `https://www.facebook.com/marketplace/item/${id}`,
    image: photos[0] || null,
    seller: cleanText(raw.seller_name ?? raw.seller, 120) || null,
    description,
    photos,
    flags: { shipped, wanted: WANTED.some((re) => re.test(text)), repaired },
  };
}

function normaliseListings(items) {
  const listings = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const l = normaliseListing(raw);
    if (!l) skipped++;
    else if (!seen.has(l.id)) {
      seen.add(l.id);
      listings.push(l);
    }
  }
  return { listings, skipped };
}

// ---------------------------------------------------------------------------------------
// GET /reclaim/sweep?q=&location=&lat=&lng=&limit=

const inflightSweeps = new Map();

// Wait for work another request started, with a timer of our own: the runtime treats a
// request that is only awaiting another request's promise as hung, and the pending timer
// keeps this one alive. Resolves null on timeout or failure.
function waitShared(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

function cleanQuery(v) {
  const q = cleanText(v, 200).toLowerCase();
  return q.length >= 2 && q.length <= 80 && /^[\p{L}\p{N}\s#&'’.,/+\-()]+$/u.test(q) ? q : null;
}
function cleanLocation(v) {
  const l = cleanText(v, 200);
  return l.length >= 2 && l.length <= 100 && /^[\p{L}\p{M}\p{N}\s.,'’\-]+$/u.test(l) ? l : null;
}
// Hashed, so a long non-Latin query + home base can't exceed KV's 512-byte key limit.
const sweepCacheKey = async (q, loc) => `reclaim:sweep:v2:${await sha256Hex(`${q}|${loc.toLowerCase().replace(/\s*,\s*/g, ",").replace(/\.+/g, "")}`)}`;
const sweepCacheRequest = (key) => new Request(`https://reclaim-sweep-cache.baryon.invalid/${encodeURIComponent(key)}`);

async function readSweepCache(env, key) {
  try {
    const hit = await caches.default.match(sweepCacheRequest(key));
    if (hit) return await hit.json();
  } catch {}
  try {
    const raw = await env.BUDGET.get(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function writeSweepCache(env, key, payload) {
  const body = JSON.stringify(payload);
  const ttl = payload.listings.length ? SWEEP_CACHE_SECONDS : SWEEP_EMPTY_CACHE_SECONDS;
  const jobs = [env.BUDGET.put(key, body, { expirationTtl: ttl })];
  try {
    jobs.push(
      caches.default.put(
        sweepCacheRequest(key),
        new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` } }),
      ),
    );
  } catch {}
  return Promise.allSettled(jobs);
}

async function callScraper(env, q, location) {
  const host = env.RAPIDAPI_HOST || RAPIDAPI_HOST_DEFAULT;
  const timeoutMs = intVar(env.SWEEP_TIMEOUT_MS, 55000, 1000);
  const target =
    `https://${host}/facebook/marketplace?query=${encodeURIComponent(q)}` +
    `&location=${encodeURIComponent(location)}&limit=${SWEEP_MAX_LIMIT}&country=us`;
  let res;
  try {
    res = await fetch(target, {
      headers: { "x-rapidapi-host": host, "x-rapidapi-key": env.RAPIDAPI_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      status: timedOut ? 504 : 502,
      error: timedOut
        ? `The Marketplace scraper didn't answer within ${Math.round(timeoutMs / 1000)} s. It is often slow; try again in a minute.`
        : "Couldn't reach the Marketplace scraper. Try again in a minute.",
    };
  }
  if (!res.ok) {
    const why =
      res.status === 401 || res.status === 403
        ? "The scraper refused the relay's credentials (site owner: check the RapidAPI subscription)."
        : res.status === 429
          ? "The scraper's own rate limit was hit. Try again in a few minutes."
          : `The Marketplace scraper answered ${res.status}.`;
    return { status: res.status === 429 ? 503 : 502, error: why };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { status: 502, error: "The Marketplace scraper sent something that isn't JSON." };
  }
  if (!body || body.success === false || !body.data || !Array.isArray(body.data.listings)) {
    const said = body?.error?.message ?? body?.error ?? body?.message ?? "";
    const msg = cleanText(redact(env, typeof said === "string" ? said : ""), 160);
    return { status: 502, error: `The Marketplace scraper reported a problem${msg ? `: ${msg}` : "."}` };
  }
  return { status: 200, items: body.data.listings };
}

async function reclaimSweep(url, env, ctx, ip, cors) {
  const fail = (status, code, error, extra = {}, headers = {}) => jsonResponse(status, { ok: false, error, code, ...extra }, cors, { "cache-control": "no-store", ...headers });
  if (!env.RAPIDAPI_KEY) return fail(503, "not_configured", "The Marketplace scanner isn't switched on for this site yet.");

  const p = url.searchParams;
  const q = cleanQuery(p.get("q"));
  if (!q) return fail(400, "bad_request", "Search for 2–80 letters or numbers, e.g. “copper wire”.");
  const location = cleanLocation(p.get("location"));
  if (!location) return fail(400, "bad_request", "Set a home base like “Macon, GA”.");
  for (const [k, lim] of [["lat", 90], ["lng", 180]]) {
    const v = p.get(k);
    if (v != null && v !== "" && !(Math.abs(Number(v)) <= lim)) return fail(400, "bad_request", `${k} must be a number between -${lim} and ${lim}.`);
  }
  const limitRaw = p.get("limit");
  const limit = limitRaw == null || limitRaw === "" ? 20 : Math.floor(Number(limitRaw));
  if (!(limit >= 1 && limit <= SWEEP_MAX_LIMIT)) return fail(400, "bad_request", `limit must be 1–${SWEEP_MAX_LIMIT}.`);

  const perIp = intVar(env.SWEEP_PER_IP_PER_DAY, 8);
  const perDay = intVar(env.SWEEP_PER_DAY, 150);
  const day = utcDay();
  const net = networkOf(ip);
  const ipKey = `reclaim:sweep:ip:${net}:${day}`;
  const refundKey = `reclaim:sweep:refund:${net}:${day}`;
  const dayKey = `reclaim:sweep:day:${day}`;
  const ttl = 60 * 60 * 26;
  const key = await sweepCacheKey(q, location);

  const respond = (payload, cached, ipUsed, dayUsed) =>
    jsonResponse(
      200,
      {
        ok: true,
        query: q,
        location,
        fetchedAt: payload.fetchedAt,
        cached,
        listings: payload.listings.slice(0, limit),
        ...(payload.skipped ? { skipped: payload.skipped } : {}),
        quota: { ipLeft: Math.max(0, perIp - ipUsed), dayLeft: Math.max(0, perDay - dayUsed) },
      },
      cors,
      { "cache-control": "no-store", "x-reclaim-cache": cached ? "hit" : "miss" },
    );

  // 1. Identical sweeps (same query + home base) in the last 30 min cost nothing.
  const hit = await readSweepCache(env, key);
  if (hit && Array.isArray(hit.listings)) {
    const [ipUsed, dayUsed] = await Promise.all([readCounter(env, ipKey), readCounter(env, dayKey)]);
    return respond(hit, true, ipUsed, dayUsed);
  }
  // 2. Someone else is already running this sweep: share their answer (free). If that sweep
  //    ends without an answer (its visitor was over a cap), check again, so that only one of
  //    the waiting requests starts a new upstream call.
  for (let round = 0; round < 3; round++) {
    const running = inflightSweeps.get(key);
    if (!running) break;
    const shared = await waitShared(running, intVar(env.SWEEP_TIMEOUT_MS, 55000, 1000) + 5000);
    if (shared && (shared.payload || shared.error)) {
      const [ipUsed, dayUsed] = await Promise.all([readCounter(env, ipKey), readCounter(env, dayKey)]);
      if (shared.payload) return respond(shared.payload, true, ipUsed, dayUsed);
      return fail(shared.status, "upstream", shared.error, { quota: { ipLeft: Math.max(0, perIp - ipUsed), dayLeft: Math.max(0, perDay - dayUsed) } });
    }
  }

  // Register this sweep at once, so identical sweeps arriving while it runs (the scraper
  // commonly takes 20–40 s) wait for it instead of paying again.
  let settle;
  const job = new Promise((r) => (settle = r));
  inflightSweeps.set(key, job);
  try {
    // 3. Quotas — reserved before the upstream call. The check and the in-memory
    //    reservation run with no await in between, so parallel requests can't overrun.
    const [ipRead, dayRead] = await Promise.all([readCounter(env, ipKey), readCounter(env, dayKey)]);
    const ipUsed = Math.max(ipRead, memGet(env, ipKey));
    const dayUsed = Math.max(dayRead, memGet(env, dayKey));
    const retry = { "retry-after": String(secondsToUtcMidnight()) };
    if (dayUsed >= perDay)
      return fail(429, "quota_day", "Today's free Marketplace scans for the whole site are used up. They reset at midnight UTC; pasting a listing still works.", { quota: { ipLeft: Math.max(0, perIp - ipUsed), dayLeft: 0 } }, retry);
    if (ipUsed >= perIp)
      return fail(429, "quota_ip", `You've used today's ${perIp} free Marketplace scans from this network. They reset at midnight UTC; pasting a listing still works.`, { quota: { ipLeft: 0, dayLeft: Math.max(0, perDay - dayUsed) } }, retry);
    const reservations = [bumpCounter(env, ipKey, ipUsed, ttl), bumpCounter(env, dayKey, dayUsed, ttl)];
    try {
      await Promise.all(reservations);
    } catch {
      // KV refused the write even after retries (e.g. the free plan's daily write limit).
      // Without a durable count the site-wide cap can't be enforced, so fail closed to protect
      // the RapidAPI quota. The visitor's in-memory reservation is released.
      await Promise.allSettled(reservations);
      memSet(env, ipKey, Math.max(0, memGet(env, ipKey) - 1), ttl);
      return fail(429, "quota_day", "The scanner's daily allowance can't be checked right now, so scans are paused. Try again later; pasting a listing still works.", {}, retry);
    }

    // 4. Upstream.
    let result = await callScraper(env, q, location);
    if (result.status === 200) {
      const { listings, skipped } = normaliseListings(result.items);
      result = { status: 200, payload: { fetchedAt: new Date().toISOString(), listings, skipped } };
      ctx.waitUntil(quiet(writeSweepCache(env, key, result.payload)));
    }
    settle(result);
    if (result.status !== 200) {
      // The visitor got nothing, so give their scan back, up to SWEEP_REFUNDS_PER_IP_PER_DAY
      // times a day. The site-wide count stays spent: the scraper may still have billed the call.
      let refunded = false;
      const refunds = await readCounter(env, refundKey).catch(() => Infinity);
      if (refunds < SWEEP_REFUNDS_PER_IP_PER_DAY) {
        refunded = true;
        ctx.waitUntil(quiet(bumpCounter(env, refundKey, refunds, ttl)));
        ctx.waitUntil(quiet(bumpCounter(env, ipKey, Math.max(ipUsed + 1, memGet(env, ipKey)), ttl, -1)));
      }
      return fail(result.status, "upstream", result.error, {
        quota: { ipLeft: Math.max(0, perIp - ipUsed - (refunded ? 0 : 1)), dayLeft: Math.max(0, perDay - dayUsed - 1) },
      });
    }
    return respond(result.payload, false, ipUsed + 1, dayUsed + 1);
  } finally {
    settle(null); // no-op when already settled; releases waiters after a quota refusal or error
    if (inflightSweeps.get(key) === job) inflightSweeps.delete(key);
  }
}

// ---------------------------------------------------------------------------------------
// GET /reclaim/img?u=<https image url> — Marketplace photos with CORS, so the browser can
// base64 them for AI vision. Only Meta's image CDN, only images, at most 5 MB.

async function reclaimImage(url, env, ip, cors) {
  const fail = (status, error) => jsonResponse(status, { ok: false, error, code: "bad_request" }, cors, { "cache-control": "no-store" });
  let target = imageUrl(url.searchParams.get("u") || "");
  if (!target) return fail(400, "Only https Marketplace photo URLs (fbcdn.net) can be relayed.");

  const hourKey = `reclaim:img:${networkOf(ip)}:${new Date().toISOString().slice(0, 13)}`;
  const used = memGet(env, hourKey);
  if (used >= IMG_PER_IP_PER_HOUR) return jsonResponse(429, { ok: false, error: "Too many photo requests from this network. Try again later.", code: "quota_ip" }, cors);
  memSet(env, hourKey, used + 1, 3700);

  let res;
  for (let hop = 0; ; hop++) {
    try {
      res = await fetch(target.href, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
        cf: { cacheTtl: 86400, cacheEverything: true },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return jsonResponse(502, { ok: false, error: "Couldn't fetch that photo.", code: "upstream" }, cors);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location") && hop < 2) {
      let next = null;
      try {
        next = imageUrl(new URL(res.headers.get("location"), target).href);
      } catch {}
      if (!next) return fail(400, "That photo redirects outside Meta's image CDN.");
      target = next;
      continue;
    }
    break;
  }
  if (!res.ok) return jsonResponse(res.status === 404 || res.status === 403 ? 404 : 502, { ok: false, error: `The photo host answered ${res.status} (Marketplace photo links expire).`, code: "upstream" }, cors);
  // Raster photo types only: no SVG (script), no HTML or anything a browser might render.
  let type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!IMG_TYPES.has(type)) return jsonResponse(415, { ok: false, error: "That URL isn't a photo.", code: "upstream" }, cors);
  if (type === "image/jpg") type = "image/jpeg";
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > IMG_MAX_BYTES) return jsonResponse(413, { ok: false, error: "That photo is larger than 5 MB.", code: "upstream" }, cors);

  if (!res.body) return jsonResponse(502, { ok: false, error: "The photo host sent an empty answer.", code: "upstream" }, cors);
  // Read with a hard byte ceiling (content-length can be missing or wrong).
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > IMG_MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {}
      return jsonResponse(413, { ok: false, error: "That photo is larger than 5 MB.", code: "upstream" }, cors);
    }
    chunks.push(value);
  }
  if (!total) return jsonResponse(502, { ok: false, error: "The photo host sent an empty answer.", code: "upstream" }, cors);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      ...cors,
      "content-type": type,
      "content-length": String(total),
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

// ---------------------------------------------------------------------------------------
// GET /reclaim/listing?id= — PullAPI's Facebook scraper (facebook-scraper-api9) documents
// only /facebook/page, /profile, /posts and /marketplace (search). There is no listing-detail
// endpoint, so the app works from search results plus pasted descriptions. Answered with
// 200 so the browser console stays clean.

function reclaimListing(url, cors) {
  const id = url.searchParams.get("id") || "";
  if (!/^\d{5,25}$/.test(id)) return jsonResponse(400, { ok: false, error: "id must be a Marketplace listing number.", code: "bad_request" }, cors);
  return jsonResponse(
    200,
    { ok: false, code: "unsupported", error: "The Marketplace scraper has no listing-detail endpoint. Open the listing and paste its description instead." },
    cors,
    { "cache-control": "public, max-age=86400" },
  );
}

// ---------------------------------------------------------------------------------------
// Copper reference price.
//   Default (no key): World Bank Commodity Price Data (The Pink Sheet), monthly averages,
//     CC BY 4.0 — "Copper (LME), grade A, minimum 99.9935% purity, cathodes and wire bar
//     shapes, settlement price", USD per metric tonne. Fetched with If-Modified-Since, so
//     most refreshes are a 304.
//   Optional METALCHARTS_KEY (preferred when set): MetalCharts /v1/prices, COMEX copper
//     futures (HG) in US$/lb. Its API terms allow commercial use on every plan, the free tier
//     included, and displaying the data to your own users, with a visible link to
//     metalcharts.org on the free plan (the app links the source name to sourceUrl).
//   Optional METALS_DEV_KEY: Metals.Dev /v1/latest (LME copper, ≤ 60 s delay). Its terms
//     allow publishing rates on a commercial website only with an active subscription.
//   The Pink Sheet parse unpacks a 2.4 MB worksheet (15–45 ms of CPU, more than the Workers
//   Free plan's 10 ms), so visitors never wait on a refresh when a record exists: the cron
//   refreshes, and a stale record is served (marked stale) while one background attempt an
//   hour tries again.

// Minimal ZIP reader (stored + deflate) — enough for one .xlsx.
function zipEntries(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function zipStream(buf, entry) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(entry.local, true) !== 0x04034b50) throw new Error("bad zip entry");
  const start = entry.local + 30 + dv.getUint16(entry.local + 26, true) + dv.getUint16(entry.local + 28, true);
  const data = buf.subarray(start, start + entry.size);
  const raw = new Blob([data]).stream();
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`zip method ${entry.method} unsupported`);
}
async function zipText(buf, entries, name) {
  const e = entries.get(name);
  if (!e) throw new Error(`${name} missing`);
  return new Response(zipStream(buf, e)).text();
}
// Inflate a big sheet but keep only its first and last `keep` bytes (no full copy in memory).
async function zipHeadTail(buf, entries, name, keep) {
  const e = entries.get(name);
  if (!e) throw new Error(`${name} missing`);
  const reader = zipStream(buf, e).getReader();
  const head = [];
  let headLen = 0;
  let tail = [];
  let tailLen = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (headLen < keep) {
      head.push(value);
      headLen += value.byteLength;
    }
    tail.push(value);
    tailLen += value.byteLength;
    while (tail.length > 1 && tailLen - tail[0].byteLength >= keep) tailLen -= tail.shift().byteLength;
  }
  const join = (parts) => {
    const all = new Uint8Array(parts.reduce((n, c) => n + c.byteLength, 0));
    let o = 0;
    for (const c of parts) {
      all.set(c, o);
      o += c.byteLength;
    }
    return new TextDecoder().decode(all);
  };
  return { head: join(head), tail: join(tail) };
}
const xmlUnescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
function sharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) out.push(xmlUnescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")).trim());
  return out;
}
function rowCells(rowXml, strings) {
  const cells = {};
  for (const c of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, attrs, inner = ""] = c;
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    const isText = inner.match(/<is>([\s\S]*?)<\/is>/);
    if (/\bt="s"/.test(attrs) && v) cells[col] = strings[Number(v[1])] ?? "";
    else if (isText) cells[col] = xmlUnescape([...isText[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
    else if (v) cells[col] = /\bt="str"/.test(attrs) ? xmlUnescape(v[1]) : Number(v[1]);
  }
  return cells;
}

async function parsePinkSheetCopper(buf) {
  const entries = zipEntries(buf);
  const wb = await zipText(buf, entries, "xl/workbook.xml");
  const rels = await zipText(buf, entries, "xl/_rels/workbook.xml.rels");
  const sheetTag = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => /name="Monthly Prices"/i.test(t));
  if (!sheetTag) throw new Error("Monthly Prices sheet missing");
  const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
  const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = (relTag?.match(/Target="([^"]+)"/) || [])[1];
  if (!target) throw new Error("sheet target missing");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const strings = entries.has("xl/sharedStrings.xml") ? sharedStrings(await zipText(buf, entries, "xl/sharedStrings.xml")) : [];
  const { head, tail } = await zipHeadTail(buf, entries, sheetPath, 64 * 1024);

  // Header: find the "Copper" column and check its unit is $/mt.
  const headRows = [...head.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 12).map((m) => rowCells(m[1], strings));
  let col = null, unit = "";
  for (let i = 0; i < headRows.length && !col; i++) {
    for (const [c, v] of Object.entries(headRows[i])) {
      if (typeof v === "string" && /^copper$/i.test(v.trim())) {
        col = c;
        unit = headRows.slice(i + 1, i + 3).map((r) => String(r[c] ?? "")).join(" ");
        break;
      }
    }
  }
  if (!col) throw new Error("Copper column missing");
  if (!/\$\s*\/\s*mt/i.test(unit)) throw new Error(`unexpected copper unit "${unit}"`);

  // Latest month with a copper value.
  const tailRows = [...tail.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((m) => rowCells(m[1], strings)).reverse();
  for (const r of tailRows) {
    const period = String(r.A ?? "").trim();
    const v = r[col];
    const m = period.match(/^(\d{4})M(\d{2})$/);
    if (m && typeof v === "number" && v > 0) {
      if (v < 1000 || v > 60000) throw new Error(`implausible copper price ${v}`);
      return { period: `${m[1]}-${m[2]}`, usdPerTonne: v, column: col };
    }
  }
  throw new Error("no monthly copper value found");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthEnd = (period) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

async function fetchPinkSheet(env, prev) {
  let xlsxUrl = env.PINK_SHEET_XLSX_URL || "";
  let nextUpdate = null;
  try {
    const page = await fetch(PINK_SHEET_PAGE, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    if (page.ok) {
      const html = await page.text();
      const m = html.match(/https:\/\/thedocs\.worldbank\.org\/en\/doc\/[A-Za-z0-9-]+\/related\/CMO-Historical-Data-Monthly\.xlsx/);
      if (m && !xlsxUrl) xlsxUrl = m[0];
      const nu = html.replace(/<[^>]+>/g, " ").match(/Next update:?\s*([A-Z][a-z]+ \d{1,2},? \d{4})/);
      const d = nu ? new Date(`${nu[1]} 12:00 UTC`) : null;
      if (d && !isNaN(d)) nextUpdate = d.toISOString().slice(0, 10);
    }
  } catch {}
  xlsxUrl ||= prev?.xlsxUrl || PINK_SHEET_XLSX;
  const headers = { "user-agent": UA };
  const reuse = prev && prev.frequency === "monthly" && prev.xlsxUrl === xlsxUrl && prev.lastModified;
  if (reuse) headers["if-modified-since"] = prev.lastModified;
  const res = await fetch(xlsxUrl, { headers, signal: AbortSignal.timeout(30000) });
  if (res.status === 304 && reuse) return { ...prev, ...(nextUpdate ? { nextUpdate } : {}), fetchedAt: new Date().toISOString() };
  if (!res.ok) throw new Error(`World Bank answered ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { period, usdPerTonne } = await parsePinkSheetCopper(buf);
  const [y, mo] = period.split("-").map(Number);
  const lastModified = res.headers.get("last-modified") || null;
  return {
    ok: true,
    usdPerLb: Math.round((usdPerTonne / LB_PER_TONNE) * 10000) / 10000,
    usdPerTonne,
    basis: `Copper (LME), grade A cathode, settlement price — ${MONTHS[mo - 1]} ${y} monthly average, converted from US$/tonne`,
    source: "World Bank Commodity Price Data (The Pink Sheet)",
    sourceUrl: PINK_SHEET_PAGE,
    asOf: monthEnd(period),
    period,
    frequency: "monthly",
    published: lastModified ? new Date(lastModified).toISOString().slice(0, 10) : null,
    ...(nextUpdate ? { nextUpdate } : {}),
    license: "CC BY 4.0 — The World Bank: Commodity Price Data (The Pink Sheet)",
    fetchedAt: new Date().toISOString(),
    xlsxUrl,
    lastModified,
  };
}

async function fetchMetalsDev(env) {
  const res = await fetch(`https://api.metals.dev/v1/latest?api_key=${encodeURIComponent(env.METALS_DEV_KEY)}&currency=USD&unit=kg`, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Metals.Dev answered ${res.status}`);
  const j = await res.json();
  const metals = j?.metals || {};
  const key = Number(metals.lme_copper) > 0 ? "lme_copper" : "copper";
  const v = Number(metals[key]);
  const unit = String(j?.unit || "kg").toLowerCase();
  const perLb = { kg: v / LB_PER_KG, g: v * 453.59237, toz: v * TROY_OZ_PER_LB, mt: v / LB_PER_TONNE, lb: v }[unit];
  if (j?.status !== "success" || !(perLb >= 0.5 && perLb <= 40)) throw new Error("Metals.Dev returned no usable copper price");
  const ts = j?.timestamps?.metal || j?.timestamp || new Date().toISOString();
  return {
    ok: true,
    usdPerLb: Math.round(perLb * 10000) / 10000,
    usdPerTonne: Math.round(perLb * LB_PER_TONNE * 100) / 100,
    basis: key === "lme_copper" ? "LME copper, latest (≤ 60 s delayed), converted to US$/lb" : "Copper spot, latest (≤ 60 s delayed), converted to US$/lb",
    source: "Metals.Dev",
    sourceUrl: "https://metals.dev",
    asOf: new Date(ts).toISOString(),
    frequency: "intraday",
    license: "Metals.Dev API terms (publishing on a website requires an active subscription)",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchMetalCharts(env) {
  const res = await fetch("https://api.metalcharts.org/v1/prices", {
    headers: { authorization: `Bearer ${env.METALCHARTS_KEY}`, accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`MetalCharts answered ${res.status}`);
  const j = await res.json();
  const hg = j?.data?.HG;
  const v = Number(hg?.price);
  const ts = Date.parse(hg?.timestamp ?? "");
  if (j?.success !== true || !hg || !(v >= 0.5 && v <= 40) || !Number.isFinite(ts)) throw new Error("MetalCharts returned no usable copper price");
  if (hg.exchange && !/comex/i.test(String(hg.exchange))) throw new Error("MetalCharts HG isn't COMEX copper");
  // Weekends and holidays leave the last settlement a few days old; older than that is broken.
  if (hg.stale === true || Date.now() - ts > 5 * 86400 * 1000 || ts > Date.now() + 3600 * 1000) throw new Error("MetalCharts copper price is stale");
  return {
    ok: true,
    usdPerLb: Math.round(v * 10000) / 10000,
    usdPerTonne: Math.round(v * LB_PER_TONNE * 100) / 100,
    basis: "COMEX copper futures (HG), latest price, US$/lb",
    source: "MetalCharts",
    sourceUrl: "https://metalcharts.org",
    asOf: new Date(ts).toISOString(),
    frequency: "intraday",
    license: "MetalCharts API terms: commercial display allowed (free plan: with a visible link to metalcharts.org)",
    fetchedAt: new Date().toISOString(),
  };
}

// At most one refresh attempt per PRICE_RETRY_SECONDS outside the cron, across the edge (KV)
// and in this isolate, so a failing or CPU-killed refresh isn't retried on every page view.
async function claimPriceAttempt(env) {
  if (memGet(env, PRICE_ATTEMPT_KV_KEY)) return false;
  let marked = null;
  try {
    marked = await env.BUDGET.get(PRICE_ATTEMPT_KV_KEY);
  } catch {}
  if (marked || memGet(env, PRICE_ATTEMPT_KV_KEY)) return false;
  memSet(env, PRICE_ATTEMPT_KV_KEY, 1, PRICE_RETRY_SECONDS);
  await quiet(env.BUDGET.put(PRICE_ATTEMPT_KV_KEY, new Date().toISOString(), { expirationTtl: PRICE_RETRY_SECONDS }));
  return true;
}

// One refresh at a time per isolate; requests arriving meanwhile share it. Outside the cron a
// refresh first claims the hourly attempt slot and resolves null when it can't.
let inflightPrice = null;
function refreshCopperPrice(env, { cron = false } = {}) {
  if (inflightPrice) return inflightPrice;
  inflightPrice = (async () => {
    if (cron) {
      memSet(env, PRICE_ATTEMPT_KV_KEY, 1, PRICE_RETRY_SECONDS);
      await quiet(env.BUDGET.put(PRICE_ATTEMPT_KV_KEY, new Date().toISOString(), { expirationTtl: PRICE_RETRY_SECONDS }));
    } else if (!(await claimPriceAttempt(env))) return null;
    let prev = null;
    try {
      prev = JSON.parse((await env.BUDGET.get(PRICE_KV_KEY)) || "null");
    } catch {}
    let rec = null;
    const errors = [];
    if (env.METALCHARTS_KEY) {
      try {
        rec = await fetchMetalCharts(env);
      } catch (e) {
        errors.push(String(e?.message || e));
      }
    }
    if (!rec && env.METALS_DEV_KEY) {
      try {
        rec = await fetchMetalsDev(env);
      } catch (e) {
        errors.push(String(e?.message || e));
      }
    }
    if (!rec) {
      try {
        rec = await fetchPinkSheet(env, prev);
      } catch (e) {
        errors.push(String(e?.message || e));
      }
    }
    if (!rec) throw new Error(errors.join("; ") || "no price source answered");
    // Keep the Pink Sheet bookkeeping (URL, Last-Modified) for the next conditional GET.
    if (rec.frequency !== "monthly" && prev?.frequency === "monthly") rec = { ...rec, xlsxUrl: prev.xlsxUrl, lastModified: prev.lastModified };
    await env.BUDGET.put(PRICE_KV_KEY, JSON.stringify(rec));
    return rec;
  })().finally(() => {
    inflightPrice = null;
  });
  return inflightPrice;
}

const publicPrice = (rec, stale) => {
  const { xlsxUrl, lastModified, ...pub } = rec;
  return stale ? { ...pub, stale: true } : pub;
};

async function reclaimPrices(env, ctx, cors) {
  let rec = null;
  try {
    rec = JSON.parse((await env.BUDGET.get(PRICE_KV_KEY)) || "null");
  } catch {}
  if (rec && !(Number(rec.usdPerLb) > 0)) rec = null;
  const age = rec ? Date.now() - Date.parse(rec.fetchedAt || 0) : Infinity;
  if (rec && age < PRICE_REFRESH_AFTER_MS) return jsonResponse(200, publicPrice(rec, false), cors, { "cache-control": "public, max-age=600" });
  if (rec) {
    // Not refreshed for over a day (the cron failed or was cut off): answer at once with the
    // last good value, marked stale, and let one background attempt an hour try again.
    ctx.waitUntil(quiet(refreshCopperPrice(env)));
    return jsonResponse(200, publicPrice(rec, true), cors, { "cache-control": "public, max-age=300" });
  }
  // Nothing stored yet (just deployed): one attempt an hour runs while the visitor waits;
  // everyone else gets a 503 and the site's dated /data/copper.json.
  const fresh = await waitShared(refreshCopperPrice(env), 55000);
  if (fresh) return jsonResponse(200, publicPrice(fresh, false), cors, { "cache-control": "public, max-age=600" });
  return jsonResponse(503, { ok: false, code: "upstream", error: "No copper reference price could be fetched right now; the site's dated fallback applies." }, cors, { "cache-control": "no-store" });
}

// ---------------------------------------------------------------------------------------

async function handle(request, env, ctx) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "https://baryon.industries").split(",").map((s) => s.trim());
  const corsOk = allowed.includes(origin);
  const cors = {
    "Access-Control-Allow-Origin": corsOk ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, user-agent, anthropic-version, anthropic-beta, x-api-key, anthropic-dangerous-direct-browser-access, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-retry-count, x-stainless-runtime, x-stainless-runtime-version, x-stainless-timeout, x-stainless-helper-method",
    "Access-Control-Expose-Headers": "retry-after, x-reclaim-cache",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  const reply = (status, message) =>
    new Response(JSON.stringify({ type: "error", error: { type: "proxy_error", message } }), {
      status,
      headers: { ...cors, "content-type": "application/json" },
    });

  const url = new URL(request.url);
  const isReclaim = url.pathname.startsWith("/reclaim/");
  if (request.method === "OPTIONS") return new Response(null, { status: corsOk ? 204 : 403, headers: cors });
  if (!corsOk)
    return isReclaim ? jsonResponse(403, { ok: false, error: "Origin not allowed.", code: "forbidden" }, cors) : reply(403, "Origin not allowed.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (request.method === "GET" && url.pathname.startsWith("/adsb/")) return relayAdsb(url, env, ctx, ip, cors);
  if (isReclaim) {
    if (request.method !== "GET") return jsonResponse(405, { ok: false, error: "Use GET.", code: "bad_request" }, cors);
    if (url.pathname === "/reclaim/sweep") return reclaimSweep(url, env, ctx, ip, cors);
    if (url.pathname === "/reclaim/img") return reclaimImage(url, env, ip, cors);
    if (url.pathname === "/reclaim/listing") return reclaimListing(url, cors);
    if (url.pathname === "/reclaim/prices") return reclaimPrices(env, ctx, cors);
    return jsonResponse(404, { ok: false, error: "Unknown Reclaim route.", code: "bad_request" }, cors);
  }
  if (request.method !== "POST" || url.pathname !== "/v1/messages") return reply(404, "Only POST /v1/messages, GET /adsb/… and GET /reclaim/… are served.");

  // ---- request validation (which agent is asking decides the rate guard)
  if (Number(request.headers.get("content-length") || 0) > MAX_MESSAGE_BYTES) return reply(413, "Request too large.");
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, "Invalid JSON.");
  }
  if (!body || typeof body !== "object") return reply(400, "Invalid JSON.");
  const systemText = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((b) => b?.text || "").join("") : "";
  const agent = systemText.startsWith(SYSTEM_PREFIX) ? "world" : systemText.startsWith(RECLAIM_PREFIX) ? "reclaim" : null;
  if (!agent) return reply(400, "This endpoint only serves the Baryon World Model agent and Reclaim.");
  if (!env.ANTHROPIC_API_KEY) return reply(503, "The hosted AI isn't switched on for this site. Add your own Anthropic key in settings.");

  // ---- rate + budget guards
  const hour = new Date().toISOString().slice(0, 13);
  const day = hour.slice(0, 10);
  if (agent === "world") {
    const ipKey = `ip:${ip}:${hour}`;
    const perIp = Number(env.PER_IP_PER_HOUR || 40);
    const used = await readCounter(env, ipKey);
    if (used >= perIp) return reply(429, "Hourly limit reached for this network. Try again later, or add your own key in Agent settings.");
    ctx.waitUntil(quiet(bumpCounter(env, ipKey, used, 7200)));
  } else {
    const ipKey = `reclaim:msg:${networkOf(ip)}:${day}`;
    const perIp = intVar(env.RECLAIM_MSGS_PER_IP_PER_DAY, 60);
    const used = await readCounter(env, ipKey);
    if (used >= perIp)
      return reply(429, `Today's ${perIp} free Reclaim AI requests from this network are used up. Add your own Anthropic key in Reclaim settings, or come back tomorrow.`);
    ctx.waitUntil(quiet(bumpCounter(env, ipKey, used, 60 * 60 * 26)));
  }
  const spent = Number((await env.BUDGET.get(`usd:${day}`)) || 0);
  const cap = Number(env.DAILY_BUDGET_USD || 5);
  if (spent >= cap)
    return reply(
      429,
      agent === "world"
        ? "Today's free agent budget is used up. Add your own key in Agent settings, or come back tomorrow."
        : "Today's free Reclaim AI budget is used up. Add your own Anthropic key in Reclaim settings, or come back tomorrow.",
    );

  if (!PRICES[body.model]) return reply(400, "Model not available through the hosted agent.");
  body.max_tokens = Math.min(Number(body.max_tokens) || 4000, MAX_TOKENS_CAP);
  if (!Array.isArray(body.messages) || body.messages.length > 80) return reply(400, "Conversation too long.");
  for (const t of body.tools || []) {
    if (t.type && t.type !== "custom" && !ALLOWED_SERVER_TOOLS.has(t.type)) return reply(400, `Tool type ${t.type} not allowed.`);
  }

  // ---- forward
  const headers = {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
  };
  const beta = request.headers.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;
  const upstream = await fetch(`https://api.anthropic.com/v1/messages${url.search}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const [price_in, price_out] = PRICES[body.model];
  // Cache writes bill at 1.25x input, cache reads at 0.1x (5-minute TTL).
  const inputUnits = (u) => (u?.input_tokens || 0) + 1.25 * (u?.cache_creation_input_tokens || 0) + 0.1 * (u?.cache_read_input_tokens || 0);
  const record = (inTok, outTok, searches = 0) => {
    const usd = (inTok * price_in + outTok * price_out) / 1e6 + searches * WEB_SEARCH_USD;
    return env.BUDGET.get(`usd:${day}`).then((v) =>
      env.BUDGET.put(`usd:${day}`, String(Number(v || 0) + usd), { expirationTtl: 60 * 60 * 48 }),
    );
  };

  const outHeaders = { ...cors, "content-type": upstream.headers.get("content-type") || "application/json" };
  if (!upstream.body) return new Response(null, { status: upstream.status, headers: outHeaders });

  if (body.stream) {
    // Tee the SSE stream: one branch to the browser, one to count tokens.
    const [toClient, toMeter] = upstream.body.tee();
    ctx.waitUntil(
      (async () => {
        const reader = toMeter.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "", inTok = 0, outTok = 0, searches = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5));
              if (ev.type === "message_start") inTok = inputUnits(ev.message?.usage);
              if (ev.type === "message_delta") {
                outTok = ev.usage?.output_tokens || outTok;
                searches = ev.usage?.server_tool_use?.web_search_requests || searches;
              }
            } catch {}
          }
        }
        await record(inTok, outTok, searches);
      })(),
    );
    return new Response(toClient, { status: upstream.status, headers: outHeaders });
  }

  const text = await upstream.text();
  try {
    const j = JSON.parse(text);
    if (j.usage) ctx.waitUntil(record(inputUnits(j.usage), j.usage.output_tokens || 0, j.usage.server_tool_use?.web_search_requests || 0));
  } catch {}
  return new Response(redact(env, text), { status: upstream.status, headers: outHeaders });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch {
      // Never leak internals (or a secret) in an error; always answer with CORS so the app can
      // show a message instead of an opaque network failure.
      const origin = request.headers.get("Origin") || "";
      const allowed = (env.ALLOWED_ORIGINS || "https://baryon.industries").split(",").map((s) => s.trim());
      const cors = { "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0], Vary: "Origin" };
      return new URL(request.url).pathname.startsWith("/reclaim/")
        ? jsonResponse(500, { ok: false, error: "The relay hit an internal error. Try again in a minute.", code: "upstream" }, cors)
        : jsonResponse(500, { type: "error", error: { type: "proxy_error", message: "The relay hit an internal error." } }, cors);
    }
  },

  // Cron Trigger (wrangler.toml [triggers]): keep the copper price warm in KV.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(quiet(refreshCopperPrice(env, { cron: true })));
  },
};
