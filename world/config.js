// Public configuration for the World Model. Safe to publish: contains no secrets.
export const config = {
  // URL of a hosted agent proxy (see /agent-proxy/README.md). The proxy holds the
  // Anthropic API key server-side and enforces rate limits and a daily budget.
  // Leave empty to use a visitor-supplied key or the free local command engine.
  agentEndpoint: "",
  // Model used by the Claude agent (visitors can change it in Agent settings).
  defaultModel: "claude-opus-5",
  // Optional ArcGIS Location Platform API key (a public, referrer-restricted key —
  // restrict it to https://baryon.industries/* in the ArcGIS dashboard). When set,
  // Esri World Imagery (sub-metre, worldwide) is added on top of the open imagery.
  arcgisKey: "",
  // Optional relay for feeds that do not allow browser access (live aircraft).
  // Same Cloudflare Worker as the agent proxy; see /agent-proxy/README.md.
  liveRelay: "",
};
