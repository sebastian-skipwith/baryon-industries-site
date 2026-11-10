// Listing hygiene. The relay already normalises scraper rows; this repeats the
// same rules defensively (it is idempotent) and adds the flags the app filters on.
import { parseCitySt } from "./geo.js";

const PRICE_ONLY = /^\s*(?:\$\s?[\d,]+(?:\.\d+)?|free)\s*$/i;
const JUST_LISTED = /^\s*just listed\s*$/i;
const SHIPS = /ships to you/i;

/** First dollar amount in a price string: "$80$99" -> 80, "Free" -> 0, "$1,234" -> 1234. */
export function parsePrice(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (/^free\b/i.test(s)) return 0;
  const m = s.match(/\$\s?([\d,]+(?:\.\d+)?)/) ?? s.match(/^([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Ads from people buying, collecting, hauling or stripping scrap: competitors, not sellers.
// Written to spare ordinary sale wording ("buyer must pick up", "service panel",
// "SER service entrance cable", "truck needed", "pickup only", "we take cash").
const WANTED_TITLE = [
  /\b(wtb|iso|in search of|wanted|in need of)\b/i,
  /(?<!\b(truck|trailer|tools?|help|nothing|no|not|equipment|ladder|repairs?|work|tlc|fixing|cleaning|parts)\s)\bneeded\b/i,
  /\b(buying|we buy|i buy|will buy|cash for|paying cash|pay cash for|top dollar)\b/i,
  /(?<!\bserious\s)\bbuyers?\b(?!\s+(must|to|will|needs?|has|should|is|pays?|picks?|loads?|hauls?|brings?|responsible|beware|only|welcome|please))/i,
  /\blooking for\b(?!\s+(a\s+)?(quick\s+sale|offers?|best\s+offer|new\s+home|serious))/i,
  /\b(i|we)\s+want\b/i, /\bwant\s+your\b/i,
  /\b(i|we)\s+(can\s+|will\s+|'ll\s+)?(pick\s*n?\s*-?\s*up|picknup|haul|remove|collect)\b/i,
  /\b(i|we)\s+(can\s+|will\s+)?take\s+(your|all|any|it\s+all|old|unwanted)\b/i,
  /\bpicking\s+(up|any|all)\b/i, /\bpick\s*-?\s*ups?\s+(of\s+)?(your|all|any)\b/i,
  /\bfree\s+(pick\s*-?\s*ups?|removal|haul(ing|\s+away)?)\b(?!\s*only)/i,
  /\b(scrap|metal|appliances?|junk)\b[\w\s,&/-]{0,24}?(?<!\b(you|must|for|to|buyer|buyers)\s)\b(pick\s*-?\s*ups?|removal|hauling|haul\s+(off|away))\b(?!\s*(only|required|needed|asap))/i,
  /\b(junk|scrap|appliance|metal|wire|copper)\s+(removal|hauling|recycling\s+service)\b/i,
  // "Clean outs" (plural) or a clean-out service is a hauler's ad; one seller's "farm cleanout" is a sale.
  /\bremoval\s+(service|for\s+free|free)\b/i, /\bclean\s*-?\s*outs\b/i,
  /\b(stripping|removal|hauling|junk|scrap|pick\s*-?\s*up|recycling|clean\s*-?\s*out)\s+services?\b/i, /\bservices?\s+(available|offered)\b/i,
  /\brecogemos\b/i, /\bcompro\b/i,
];
/** True when a title (and description, if any) reads like a wanted or service ad. */
export const isWantedTitle = (title, description = "") => {
  const t = String(title ?? "");
  if (WANTED_TITLE.some((re) => re.test(t))) return true;
  // Descriptions are long and full of seller wording, so only the plainest phrases count there.
  const d = String(description ?? "");
  return !!d && /\b(wtb|we buy|i buy|will buy|paying cash for|cash for (your )?(scrap|junk|appliances?)|i pick up (your|all|any)|we pick up (your|all|any)|free (scrap )?removal|stripping services?)\b/i.test(d);
};

const THEFT = /\b(catalytic|cat converters?|utility|lineman|telco|telephone company|railroad|manhole|ground(ing)? (wire|rod)|bus\s*bars?|busbar|substation|water meters?|(new|unused|full|sealed)\s+(\w+\s+){0,2}(spools?|reels?)|(spools?|reels?)\s+of\s+(new|unused)|bulk copper|cash only)\b/i;
const REFRIGERANT = /\b(air ?condition(?:er|ers|ing)?|a\/c|ac units?|window units?|mini[- ]?splits?|heat pumps?|condensers?|condensing units?|fridges?|refrigerators?|freezers?|dehumidifiers?|water coolers?|vending|ice makers?|chillers?|hvac)\b/i;
const COPPER = /\b(copper|thhn|romex|wire|wiring|cable|brass|bronze|acr|radiators?|motors?|transformers?|bus\s*bar)\b/i;

const PCB = /\b(transformers?|ballasts?|capacitors?)\b/i;

export const textFlags = (text) => ({
  theft: THEFT.test(String(text ?? "")),
  refrigerant: REFRIGERANT.test(String(text ?? "")),
  copper: COPPER.test(String(text ?? "")),
  pcb: PCB.test(String(text ?? "")),
});

/** Normalises one listing (relay shape or raw scraper row) into the app's shape. */
export function normalizeListing(raw, query = "") {
  if (!raw) return null;
  const id = String(raw.id ?? raw.listing_id ?? "").trim();
  const url = String(raw.url ?? raw.listing_url ?? "").trim();
  if (!id && !url) return null;
  let title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
  let location = raw.location == null ? "" : String(raw.location).replace(/\s+/g, " ").trim();
  const priceText = String(raw.priceText ?? (typeof raw.price === "string" ? raw.price : "") ?? "").trim();
  let price = typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : parsePrice(priceText);
  const flags = { shipped: false, wanted: false, repaired: false, titleMissing: false, locationUnknown: false, ...(raw.flags ?? {}) };

  // Shifted rows: the title slot holds "Just listed" or a bare price and the real title sits in location.
  if (!title || JUST_LISTED.test(title) || PRICE_ONLY.test(title)) {
    const locIsPlace = parseCitySt(location) || SHIPS.test(location);
    if (location && !locIsPlace && !PRICE_ONLY.test(location)) {
      if (price == null && PRICE_ONLY.test(title)) price = parsePrice(title);
      title = location;
      location = "";
      flags.repaired = true;
    } else {
      if (price == null && PRICE_ONLY.test(title)) price = parsePrice(title);
      if (PRICE_ONLY.test(location)) location = "";
      title = "";
      flags.titleMissing = true;
    }
  }
  if (SHIPS.test(location)) { flags.shipped = true; location = ""; }
  // The app decides "wanted" itself from the same text the relay saw, with rules that
  // spare ordinary sale wording; the relay's own guess is kept for reference only.
  flags.relayWanted = !!raw.flags?.wanted;
  flags.wanted = isWantedTitle(title, raw.description);
  const place = parseCitySt(location);
  if (!place) flags.locationUnknown = true;

  const photos = Array.isArray(raw.photos) ? raw.photos.filter((u) => typeof u === "string" && /^https:\/\//.test(u)) : [];
  const image = String(raw.image ?? raw.image_url ?? photos[0] ?? "").trim() || null;
  return {
    id: id || url,
    title: title || "Untitled listing",
    price: price == null ? null : Math.max(0, price),
    priceText: priceText || (price === 0 ? "Free" : price != null ? `$${price}` : ""),
    location: place ? `${place.city}, ${place.st}` : location,
    place,
    url: /^https:\/\//.test(url) ? url : "",
    image: image && /^https:\/\//.test(image) ? image : null,
    seller: raw.seller ?? raw.seller_name ?? null,
    description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : null,
    photos,
    flags,
    queries: [query].filter(Boolean),
  };
}

/** Merges listings from several sweeps: same id, same URL, or same title + price + place. */
export function dedupe(listings) {
  const byKey = new Map();
  const out = [];
  for (const l of listings) {
    if (!l) continue;
    const keys = [`id:${l.id}`, l.url && `url:${l.url.replace(/[?#].*$/, "")}`, !l.flags.titleMissing && `tpl:${l.title.toLowerCase()}|${l.price}|${l.location.toLowerCase()}`].filter(Boolean);
    const hit = keys.map((k) => byKey.get(k)).find(Boolean);
    if (hit) {
      for (const q of l.queries) if (!hit.queries.includes(q)) hit.queries.push(q);
      if (!hit.description && l.description) hit.description = l.description;
      continue;
    }
    out.push(l);
    keys.forEach((k) => byKey.set(k, l));
  }
  return out;
}
