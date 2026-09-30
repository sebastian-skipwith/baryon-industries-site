// Visual modes — God's-eye looks for the globe: Thermal (FLIR ironbow), Night vision
// (PVS-14 style P43 phosphor), CRT, and Noir, rendered as a real-time WebGL
// post-process over the map canvas, plus a telemetry HUD.
//
// Looks adapted from God's Eye View by Bilawal Sidhu (MIT licence,
// https://github.com/bilawalsidhu/gods-eye-view — src/styles/thermal.js,
// surveillance.js, retro.js, noir.js). See /THIRD_PARTY_NOTICES.md.
import { app, $, fmt } from "./core.js";

const MODES = [
  { id: "standard", label: "Standard" },
  { id: "thermal", label: "Thermal" },
  { id: "nvg", label: "Night vision" },
  { id: "crt", label: "CRT" },
  { id: "noir", label: "Noir" },
];

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const COMMON = `
precision highp float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec2 res;
uniform float time;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 blur5(vec2 u, float r){
  vec2 px = r / res;
  vec3 c = texture2D(tex,u).rgb*0.36;
  c += texture2D(tex,u+vec2(px.x,0.)).rgb*0.16; c += texture2D(tex,u-vec2(px.x,0.)).rgb*0.16;
  c += texture2D(tex,u+vec2(0.,px.y)).rgb*0.16; c += texture2D(tex,u-vec2(0.,px.y)).rgb*0.16;
  return c;
}
float vignette(vec2 u, float k){ vec2 c = u-0.5; return clamp(1.0 - dot(c,c)*k, 0.0, 1.0); }
`;

const FRAG = {
  // FLIR ironbow: black -> purple -> magenta -> red -> orange -> yellow -> white.
  thermal: COMMON + `
vec3 ironbow(float t){
  t = clamp(t,0.,1.); float s = t*6.0;
  vec3 c0=vec3(0.),c1=vec3(.13,0.,.30),c2=vec3(.49,0.,.45),c3=vec3(.86,.10,.18),c4=vec3(1.,.55,0.),c5=vec3(1.,.91,.32),c6=vec3(1.);
  if(s<1.) return mix(c0,c1,s); if(s<2.) return mix(c1,c2,s-1.); if(s<3.) return mix(c2,c3,s-2.);
  if(s<4.) return mix(c3,c4,s-3.); if(s<5.) return mix(c4,c5,s-4.); return mix(c5,c6,s-5.);
}
void main(){
  vec3 c = blur5(uv, 1.6);
  // warm surfaces (bright, red-ish, man-made) read hot; water and vegetation cold
  float t = lum(c)*0.85 + (c.r - c.b)*0.35 + 0.08;
  t = smoothstep(0.05, 0.95, t);
  vec3 col = ironbow(t);
  col += (hash(uv*res + time*37.0) - 0.5) * 0.05;
  col *= mix(0.72, 1.0, vignette(uv, 1.1));
  gl_FragColor = vec4(col, 1.0);
}`,
  // P43 phosphor green, soft bloom, scintillation, circular tube vignette, honeycomb.
  nvg: COMMON + `
void main(){
  vec3 c = texture2D(tex, uv).rgb;
  vec3 b = blur5(uv, 5.0);
  float l = lum(c) * 1.12 + lum(b) * 0.42;
  l = pow(clamp(l, 0.0, 1.4), 0.85);
  float grain = hash(uv*res*0.5 + floor(time*24.0)*13.0);
  l += (grain - 0.5) * 0.16;
  vec3 col = vec3(0.10, 1.0, 0.36) * l * 0.95 + vec3(0.0, 0.05, 0.02);
  // circular intensifier-tube edge
  vec2 d = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  float r = length(d);
  col *= smoothstep(0.62, 0.52, r);
  // honeycomb fibre-optic plate
  vec2 hp = uv * res / 3.0;
  col *= 0.94 + 0.06 * step(0.5, fract(hp.x + step(0.5, fract(hp.y*0.5))*0.5)) * step(0.5, fract(hp.y));
  gl_FragColor = vec4(col, 1.0);
}`,
  // CRT: chromatic aberration, scanlines, shadow mask, flicker, slight barrel.
  crt: COMMON + `
vec2 barrel(vec2 u){ vec2 c = u*2.0-1.0; float r2 = dot(c,c); c *= 1.0 + r2*0.045; return c*0.5+0.5; }
void main(){
  vec2 u = barrel(uv);
  if(u.x<0.||u.y<0.||u.x>1.||u.y>1.){ gl_FragColor = vec4(0.,0.,0.,1.); return; }
  float ca = 1.4 / res.x;
  vec3 col = vec3(texture2D(tex, u+vec2(ca,0.)).r, texture2D(tex, u).g, texture2D(tex, u-vec2(ca,0.)).b);
  float scan = 0.82 + 0.18 * sin(u.y * res.y * 3.14159);
  float mask = 0.9 + 0.1 * sin(u.x * res.x * 2.094);
  col = pow(col, vec3(0.95)) * scan * mask;
  col *= 0.97 + 0.03 * sin(time * 9.0);
  col = mix(col, col * vec3(0.9, 1.05, 0.95), 0.4);
  col *= mix(0.65, 1.0, vignette(u, 1.3));
  gl_FragColor = vec4(col, 1.0);
}`,
  // Noir: high-contrast monochrome, film grain, heavy vignette.
  noir: COMMON + `
void main(){
  float l = lum(texture2D(tex, uv).rgb);
  l = smoothstep(0.06, 0.9, l);
  l = pow(l, 1.15);
  l += (hash(uv*res + floor(time*18.0)*7.0) - 0.5) * 0.09;
  l *= mix(0.45, 1.0, vignette(uv, 1.6));
  gl_FragColor = vec4(vec3(l), 1.0);
}`,
};

let gl, canvas, programs = {}, texture, raf = 0, mode = "standard", start = performance.now();

function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(VERT, gl.VERTEX_SHADER));
  gl.attachShader(p, compile(fragSrc, gl.FRAGMENT_SHADER));
  gl.bindAttribLocation(p, 0, "p");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return { p, tex: gl.getUniformLocation(p, "tex"), res: gl.getUniformLocation(p, "res"), time: gl.getUniformLocation(p, "time") };
}

function setupGL() {
  canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  $("#fx").prepend(canvas); // under the HUD
  gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: false });
  if (!gl) throw new Error("WebGL unavailable for visual modes");
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
}

function frame() {
  raf = 0;
  if (mode === "standard") return;
  const src = app.map.getCanvas();
  if (canvas.width !== src.width || canvas.height !== src.height) {
    canvas.width = src.width;
    canvas.height = src.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  const prog = programs[mode] ??= program(FRAG[mode]);
  gl.useProgram(prog.p);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.uniform1i(prog.tex, 0);
  gl.uniform2f(prog.res, canvas.width, canvas.height);
  gl.uniform1f(prog.time, (performance.now() - start) / 1000);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // keep noise/flicker alive at ~30fps even when the map is idle
  setTimeout(schedule, 33);
}
function schedule() { if (!raf && mode !== "standard") raf = requestAnimationFrame(frame); }

/* ---------------------------------------------------------------- HUD */
function hudText() {
  const m = app.map, c = m.getCenter();
  const now = new Date();
  const utc = now.toISOString().slice(11, 19);
  const z = m.getZoom();
  const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** z);
  const alt = (mpp * m.getCanvas().clientHeight) / (2 * Math.tan((36.87 * Math.PI) / 360));
  return {
    tl: `BARYON // WORLD MODEL<br>MODE ${MODES.find((x) => x.id === mode)?.label.toUpperCase()}<br>${now.toISOString().slice(0, 10)} ${utc}Z`,
    tr: `LAT ${c.lat >= 0 ? "N" : "S"} ${Math.abs(c.lat).toFixed(4)}<br>LON ${c.lng >= 0 ? "E" : "W"} ${Math.abs(c.lng).toFixed(4)}<br>ALT ${alt >= 1000 ? fmt(alt / 1000, 1) + " KM" : fmt(alt) + " M"}`,
    bl: `HDG ${String(Math.round((m.getBearing() + 360) % 360)).padStart(3, "0")}°  TILT ${Math.round(m.getPitch())}°<br>ZOOM ${z.toFixed(2)}`,
    br: `LAYERS ${app.layers.active().length}<br>${app.layers.active().filter((id) => app.layers.get(id)?.live).length} LIVE FEEDS`,
  };
}
function renderHud() {
  const hud = $("#hud");
  if (!hud || mode === "standard") return;
  const t = hudText();
  for (const k of ["tl", "tr", "bl", "br"]) hud.querySelector(`.hud-${k}`).innerHTML = t[k];
}

/* ---------------------------------------------------------------- mode switching */
export function setMode(next) {
  if (!FRAG[next] && next !== "standard") next = "standard";
  mode = next;
  app.visualMode = next;
  document.body.dataset.mode = next;
  $$("#modebar button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === next)));
  if (next === "standard") {
    canvas && (canvas.style.display = "none");
  } else {
    try {
      if (!gl) setupGL();
      canvas.style.display = "block";
      schedule();
    } catch (err) {
      console.error(err);
      app.ui.toast("Visual modes need WebGL.", { tone: "error" });
      mode = "standard";
      document.body.dataset.mode = "standard";
    }
  }
  renderHud();
  app.emit("visual:changed", mode);
  import("./core.js").then(({ syncHash }) => syncHash());
}
const $$ = (sel) => [...document.querySelectorAll(sel)];

export function init() {
  const bar = $("#modebar");
  bar.innerHTML = MODES.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === "standard"}">${m.label}</button>`).join("");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b) setMode(b.dataset.mode);
  });
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.className = "hud";
  hud.setAttribute("aria-hidden", "true");
  hud.innerHTML = `<div class="hud-tl"></div><div class="hud-tr"></div><div class="hud-bl"></div><div class="hud-br"></div><div class="hud-reticle"></div>`;
  $("#fx").append(hud);
  // The effect paints right above the map canvas, inside the map's own stacking context,
  // so markers and popups MapLibre adds later still draw on top of it.
  app.map.getCanvas().after($("#fx"));

  app.map.on("render", () => { if (mode !== "standard") schedule(); });
  app.map.on("move", renderHud);
  setInterval(renderHud, 1000);
  app.on("visual:set", (m) => setMode(m));

  app.tools.define("set_visual_mode", {
    description: "Change how the globe looks: standard, thermal (FLIR ironbow heat look), nvg (night-vision green), crt (retro monitor), or noir (black and white). Purely visual; data is unchanged.",
    input_schema: { type: "object", properties: { mode: { type: "string", enum: MODES.map((m) => m.id) } }, required: ["mode"] },
    async run({ mode: m }) { setMode(m); return { ok: true, mode: app.visualMode }; },
    local: {
      patterns: [/\b(thermal|flir|heat ?vision|infra-?red)\b/i, /\b(night ?vision|nvg|night mode)\b/i, /\b(crt|retro|old monitor)\b/i, /\b(noir|black and white|b&w|monochrome)\b/i, /\b(standard|normal) (mode|view|look)\b/i],
      parse: (m, text) => ({
        mode: /thermal|flir|heat|infra/i.test(text) ? "thermal" : /night|nvg/i.test(text) ? "nvg" : /crt|retro|monitor/i.test(text) ? "crt" : /noir|black|b&w|mono/i.test(text) ? "noir" : "standard",
      }),
    },
  });
}
