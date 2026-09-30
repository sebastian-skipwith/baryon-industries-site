// Baryon World Model — hosted agent proxy (Cloudflare Worker).
// Lets every visitor use the World Model agent without their own API key, while
// keeping the owner's Anthropic key server-side and the spend bounded.
//
// Guards (all enforced here, never trusted from the browser):
//   - Origin allowlist (baryon.industries + local dev)
//   - Only POST /v1/messages; model allowlist; max_tokens cap; tool allowlist
//   - The system prompt must start with the World Model agent's fixed preamble,
//     so the proxy can't be used as a general-purpose free Claude endpoint
//   - Per-IP hourly request limit and a hard daily USD budget (KV counters)
//
// Bindings (wrangler.toml): KV namespace BUDGET; secret ANTHROPIC_API_KEY;
// vars DAILY_BUDGET_USD, PER_IP_PER_HOUR, ALLOWED_ORIGINS.

const PRICES = {
  // $ per million tokens (input, output) — keep in sync with Anthropic pricing.
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};
const MAX_TOKENS_CAP = 12000;
const SYSTEM_PREFIX = "You are the Baryon World Model agent.";
const ALLOWED_SERVER_TOOLS = new Set(["web_search_20250305"]);
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
const ADSB_PER_IP_PER_HOUR = 900; // the World Model polls every 10 s at most

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

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "https://baryon.industries").split(",").map((s) => s.trim());
    const corsOk = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": corsOk ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "content-type, user-agent, anthropic-version, anthropic-beta, x-api-key, anthropic-dangerous-direct-browser-access, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-retry-count, x-stainless-runtime, x-stainless-runtime-version, x-stainless-timeout, x-stainless-helper-method",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (status, message) =>
      new Response(JSON.stringify({ type: "error", error: { type: "proxy_error", message } }), {
        status,
        headers: { ...cors, "content-type": "application/json" },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: corsOk ? 204 : 403, headers: cors });
    if (!corsOk) return reply(403, "Origin not allowed.");
    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (request.method === "GET" && url.pathname.startsWith("/adsb/")) return relayAdsb(url, env, ctx, ip, cors);
    if (request.method !== "POST" || url.pathname !== "/v1/messages") return reply(404, "Only POST /v1/messages and GET /adsb/… are served.");

    // ---- rate + budget guards
    const hour = new Date().toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    const ipKey = `ip:${ip}:${hour}`;
    const perIp = Number(env.PER_IP_PER_HOUR || 40);
    const used = Number((await env.BUDGET.get(ipKey)) || 0);
    if (used >= perIp) return reply(429, "Hourly limit reached for this network. Try again later, or add your own key in Agent settings.");
    const spent = Number((await env.BUDGET.get(`usd:${day}`)) || 0);
    const cap = Number(env.DAILY_BUDGET_USD || 5);
    if (spent >= cap) return reply(429, "Today's free agent budget is used up. Add your own key in Agent settings, or come back tomorrow.");
    ctx.waitUntil(env.BUDGET.put(ipKey, String(used + 1), { expirationTtl: 7200 }));

    // ---- request validation
    let body;
    try {
      body = await request.json();
    } catch {
      return reply(400, "Invalid JSON.");
    }
    if (!PRICES[body.model]) return reply(400, "Model not available through the hosted agent.");
    body.max_tokens = Math.min(Number(body.max_tokens) || 4000, MAX_TOKENS_CAP);
    const systemText = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((b) => b.text || "").join("") : "";
    if (!systemText.startsWith(SYSTEM_PREFIX)) return reply(400, "This endpoint only serves the Baryon World Model agent.");
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
    return new Response(text, { status: upstream.status, headers: outHeaders });
  },
};
