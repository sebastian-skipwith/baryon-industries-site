// Client for the Reclaim relay (Cloudflare Worker). The relay holds the scraper
// key; the browser only ever sees normalised listings and quota counts.
import { S } from "./state.js";

export class RelayError extends Error {
  constructor(message, code, status = 0, quota = null) {
    super(message);
    Object.assign(this, { code, status, quota });
  }
}

const MESSAGES = {
  quota_ip: "You've used today's scans from this network. The allowance resets daily.",
  quota_day: "Today's shared scan budget is used up for everyone. Try again tomorrow.",
  upstream: "The marketplace source didn't answer for this search.",
  bad_request: "The scanner couldn't run this search.",
  not_configured: "The scanner isn't switched on at the relay yet.",
  forbidden: "The relay doesn't accept requests from this address of the site.",
  network: "Couldn't reach the scanner. Check your connection and try again.",
};
export const relayMessage = (code) => MESSAGES[code] ?? "The scanner had a problem.";

/** GET /reclaim/sweep */
export async function sweep({ q, location, lat, lng, limit = 40, signal }) {
  if (!S.relay) throw new RelayError(MESSAGES.not_configured, "not_configured");
  const params = new URLSearchParams({ q, location, limit: String(Math.min(40, Math.max(1, limit))) });
  // Two decimals (about 1 km) is plenty for a distance filter and keeps the home base vague.
  if (Number.isFinite(lat) && Number.isFinite(lng)) { params.set("lat", lat.toFixed(2)); params.set("lng", lng.toFixed(2)); }
  let res;
  try {
    res = await fetch(`${S.relay}/reclaim/sweep?${params}`, { signal });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new RelayError(MESSAGES.network, "network");
  }
  let j = null;
  try { j = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !j || j.ok !== true) {
    const code = j?.code && MESSAGES[j.code] ? j.code : res.status === 429 ? "quota_ip" : res.status === 400 ? "bad_request" : res.status === 403 ? "forbidden" : res.status === 503 || res.status === 501 ? "not_configured" : "upstream";
    throw new RelayError(j?.error || MESSAGES[code], code, res.status, j?.quota ?? null);
  }
  if (!Array.isArray(j.listings)) throw new RelayError(MESSAGES.upstream, "upstream", res.status, j.quota ?? null);
  return j;
}

/** GET /reclaim/img: a listing photo as a Blob (for AI vision). */
export async function relayImageBlob(url, { signal } = {}) {
  if (!S.relay) throw new RelayError(MESSAGES.not_configured, "not_configured");
  if (!/^https:\/\//.test(String(url ?? ""))) throw new RelayError("No photo.", "bad_request");
  let res;
  try { res = await fetch(`${S.relay}/reclaim/img?u=${encodeURIComponent(url)}`, { signal }); }
  catch (e) { if (e?.name === "AbortError") throw e; throw new RelayError(MESSAGES.network, "network"); }
  if (!res.ok) throw new RelayError("The photo couldn't be fetched.", "upstream", res.status);
  const blob = await res.blob();
  if (!/^image\//.test(blob.type) || blob.size > 5 * 1024 * 1024 || blob.size < 64) throw new RelayError("The photo couldn't be read.", "upstream");
  return blob;
}

let detailSupported = null;
/** GET /reclaim/listing: description and extra photos, when the provider offers them. */
export async function listingDetail(id, { signal } = {}) {
  if (!S.relay || detailSupported === false || !id) return null;
  try {
    const res = await fetch(`${S.relay}/reclaim/listing?id=${encodeURIComponent(id)}`, { signal });
    const j = await res.json().catch(() => null);
    if (j?.code === "unsupported" || res.status === 404 || res.status === 501) { detailSupported = false; return null; }
    if (!res.ok || !j?.ok) return null;
    detailSupported = true;
    return {
      description: typeof j.description === "string" && j.description.trim() ? j.description.trim().slice(0, 5000) : null,
      photos: Array.isArray(j.photos) ? j.photos.filter((u) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 10) : [],
    };
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return null;
  }
}
