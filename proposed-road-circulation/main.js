"use strict";
/* GBA road circulation viewer. No build step: index.html + style.css + main.js + datasets.json (+ tileset.json/images or a zip). */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => Math.round(v * 100) + "%";
const PREVIEW_PX = 2400, DETAIL_ZOOM = 13.5;

let CFG = { title: "GBA Road Circulation Plan", center: [77.5946, 12.9716], zoom: 10.5, search_viewbox: [77.2, 13.4, 77.95, 12.6],
  tilesets: ["tileset.json", "gba-tileset.zip"], legend: ["legend.json"], boundaries: ["boundaries.json", "boundaries.geojson"] };     // .json first: some static servers can't serve .geojson (HTTP 500)
let TS = null, ZIP = null, MODE = null, BASE = "";   // tileset.json, JSZip, "folder" | "zip", url prefix of the tileset
let map = null, gOp = 0.6, tilesReady = false;
const T = {};          // per sheet: {s, vis, op, urls:{preview,full}, cur, added}
const C = {};          // per corporation: {vis, op, open}
let order = [];
let sel = { ids: [], i: 0, place: null };

/* ------------------------------------------------------------------ persistent cache (Cache Storage; localStorage is far too small for sheets)
   Sheets and their downscaled previews are kept between visits so a reload makes no image requests.
   The cache is dropped automatically when tileset.json (or the zip's size/ETag/Last-Modified) changes. */
const CACHE = "gba-tiles-v1";
let cacheStore = null, SRC = "";                       // SRC = absolute url prefix identifying this tileset in the cache
const absUrl = u => new URL(u, location.href).href;
const ckey = (k, kind) => k + (k.includes("?") ? "&" : "?") + "gba=" + kind;
async function cacheOpen() {
  if (cacheStore) return cacheStore;
  try { if (window.caches) cacheStore = await caches.open(CACHE); } catch (e) {}
  return cacheStore;
}
async function cacheGet(key) { try { const c = await cacheOpen(), r = c && await c.match(key); return r ? await r.blob() : null; } catch (e) { return null; } }
async function cachePut(key, blob) { try { const c = await cacheOpen(); if (c) await c.put(key, new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } })); } catch (e) {} }
async function stampCheck(id, stamp) {                 // returns true when the cache is still valid for this tileset
  let old = null; try { old = localStorage.getItem("gba-stamp:" + id); } catch (e) {}
  if (old === stamp) return true;
  try { await caches.delete(CACHE); cacheStore = null; } catch (e) {}
  try { localStorage.setItem("gba-stamp:" + id, stamp); } catch (e) {}
  return false;
}
async function digest(text) {
  try { const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  catch (e) { return String(text.length); }
}

/* ------------------------------------------------------------------ loading */
let toastTimer = null;
function status(msg, p, keep) {
  clearTimeout(toastTimer);
  $("toast").hidden = !msg; $("status").textContent = msg || "";
  $("bar").style.display = p == null ? "none" : "block";
  if (p != null) $("bar").style.width = Math.round(p * 100) + "%";
  if (msg && !keep && p == null) toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4000);
}
async function readProgress(resp) {
  const total = +resp.headers.get("content-length") || 0, rd = resp.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length;
    status("Downloading tileset… " + (got / 1e6).toFixed(0) + (total ? " / " + (total / 1e6).toFixed(0) : "") + " MB", total ? got / total : null, true); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out.buffer;
}
async function fromZipBuffer(buf) {
  status("Reading zip…", null, true);
  ZIP = await JSZip.loadAsync(buf);
  const f = ZIP.file("tileset.json"); if (!f) throw new Error("tileset.json not found in zip");
  TS = JSON.parse(await f.async("string")); MODE = "zip"; BASE = "";
}
async function loadZipUrl(u) {                          // zip next to the page: reuse the cached copy when the server file is unchanged
  const key = ckey(absUrl(u), "zip"); SRC = absUrl(u);
  let stamp = "";
  try { const h = await fetch(u, { method: "HEAD" });
    if (h.ok) stamp = [h.headers.get("etag"), h.headers.get("last-modified"), h.headers.get("content-length")].join("|"); } catch (e) {}
  const same = stamp && await stampCheck(SRC, stamp);
  if (same) { const b = await cacheGet(key); if (b) { status("Reading cached tileset…", null, true); await fromZipBuffer(await b.arrayBuffer()); MODE = "zip"; return true; } }
  const r = await fetch(u); if (!r.ok) return false;
  const buf = await readProgress(r);
  if (stamp) await stampCheck(SRC, stamp), cachePut(key, new Blob([buf]));
  await fromZipBuffer(buf); return true;
}
async function boot() {
  try { const r = await fetch("datasets.json"); if (r.ok) CFG = Object.assign(CFG, await r.json()); } catch (e) {}
  const q = new URLSearchParams(location.search), src = q.get("src") || q.get("zip");
  const cands = src ? [src] : CFG.tilesets;
  status("Looking for the tileset…", null, true);
  for (const u of cands) {
    try {
      if (/\.zip(\?|$)/i.test(u)) { if (!(await loadZipUrl(u))) continue; return start(); }
      const r = await fetch(u); if (!r.ok) continue;
      const txt = await r.text(); TS = JSON.parse(txt); MODE = TS.format === "pmtiles" ? "pmtiles" : "folder";
      BASE = u.replace(/[^/]*$/, ""); SRC = absUrl(BASE);
      await stampCheck(SRC, await digest(txt));
      return start();
    } catch (e) { console.warn(u, e); }
  }
  status(""); $("drop").hidden = false;
}
$("pick").onclick = () => $("file").click();
$("file").onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); };
async function loadFile(f) {
  try { $("drop").hidden = true; SRC = ""; await fromZipBuffer(await f.arrayBuffer()); await start(); }
  catch (e) { status("Couldn’t read that file: " + e.message, null, true); $("drop").hidden = false; }
}
["dragover", "dragenter"].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); $("drop").classList.remove("over"); }));
document.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

/* ------------------------------------------------------------------ images */
async function fullBlob(s) {                            // original sheet image: zip entry, cache, or network (then cached)
  if (MODE === "zip") return ZIP.file(s.image).async("blob");
  const url = absUrl(BASE + s.image), hit = await cacheGet(url);
  if (hit) return hit;
  const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status + " " + s.image);
  const blob = await r.blob(); cachePut(url, blob); return blob;
}
const previewKey = s => SRC ? ckey(SRC + s.image, "preview") : null;
async function ensureUrls(t) {
  if (t.urls.preview) return;
  const pk = previewKey(t.s), hit = pk && await cacheGet(pk);
  if (hit) { t.urls.preview = URL.createObjectURL(hit); if (hit.size && t.s.width && t.s.height && Math.max(t.s.width, t.s.height) <= PREVIEW_PX) t.urls.full = t.urls.preview; return; }
  const blob = await fullBlob(t.s); t.blob = blob;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, PREVIEW_PX / Math.max(bmp.width, bmp.height));
  if (k >= 0.999) { t.urls.preview = t.urls.full = URL.createObjectURL(blob); bmp.close(); return; }
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
  const ext = (t.s.image.match(/\.(\w+)$/) || [])[1] || "";            // zip blobs carry no MIME type: use the file name
  const alpha = /^(png|webp)$/i.test(ext);
  const pv = await new Promise(r => cv.toBlob(r, alpha ? (/png/i.test(ext) ? "image/png" : "image/webp") : "image/jpeg", 0.9));
  t.urls.preview = URL.createObjectURL(pv);
  if (pk) cachePut(pk, pv);
}
async function ensureFull(t) {
  if (t.urls.full) return t.urls.full;
  if (!t.blob) t.blob = await fullBlob(t.s);
  return (t.urls.full = URL.createObjectURL(t.blob));
}

/* ------------------------------------------------------------------ map layers */
const effOpacity = id => T[id].op * C[T[id].s.corporation].op * gOp;
const srcId = id => "s-" + id, lyrId = id => "l-" + id;
const PM = () => MODE === "pmtiles";
const PMC = () => PM() && !(TS.pmtiles || []).every(f => (f.sheets || []).length === 1);   // true: one archive per corporation (no per-sheet layers)
const pmFiles = id => (TS.pmtiles || []).filter(f => (f.sheets || []).includes(id));   // a big sheet may be cut into several archives
const lyrIds = id => PM() ? pmFiles(id).map(f => "l-" + f.file) : [lyrId(id)];
const isOn = id => C[T[id].s.corporation].vis && (PMC() || T[id].vis);
/* where the .pmtiles files live: ?pmtiles=<url prefix>, tileset.json "base_url", datasets.json "pmtiles_base", else next to tileset.json.
   The host MUST answer HTTP Range requests (Cloudflare R2, S3, GitHub-less static hosts...; Cloudflare *Pages* does not). */
const pmBase = () => new URLSearchParams(location.search).get("pmtiles") || TS.base_url || CFG.pmtiles_base || BASE;
const pmUrl = f => "pmtiles://" + absUrl((pmBase().replace(/\/?$/, "/") === "/" ? "" : pmBase().replace(/\/?$/, "/")) + f.file);
async function checkRange() {
  const f = (TS.pmtiles || [])[0]; if (!f) return;
  try {
    const r = await fetch(pmUrl(f).slice(10), { headers: { Range: "bytes=0-15" } });
    if (r.status !== 206) status("This host ignores HTTP Range requests, so the .pmtiles files can't be read. Host them on R2/S3 (or any host with range support) and set pmtiles_base.", null, true);
    if (r.body) r.body.cancel();
  } catch (e) { console.warn("range check", e); }
}
const pmId = f => "pm-" + f.file.replace(/\W+/g, "_");
function applyCorp(corp) {                               // a corporation may be split over several archives
  (TS.pmtiles || []).filter(f => f.corporation === corp).forEach(f => {
    const id = pmId(f); if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, "visibility", C[corp].vis ? "visible" : "none");
    map.setPaintProperty(id, "raster-opacity", C[corp].op * gOp);
  });
}
function addPmtiles() {
  (TS.pmtiles || []).forEach(f => {
    const sid = pmId(f);
    map.addSource(sid, { type: "raster", url: pmUrl(f), tileSize: 256,
      minzoom: f.minzoom || 0, maxzoom: f.maxzoom || 17 });
    map.addLayer({ id: sid, type: "raster", source: sid, paint: { "raster-opacity": C[f.corporation] ? C[f.corporation].op * gOp : gOp,
      "raster-fade-duration": 0, "raster-resampling": "linear" } }, "fp-line");
  });
}
const ring = s => [...s.coordinates, s.coordinates[0]];
async function addTile(id) {
  const t = T[id]; if (t.added) return;
  if (PM()) {                                           // per-sheet PMTiles archive: tiles are streamed by range request
    const fs = pmFiles(id); if (!fs.length) return;
    fs.forEach(f => {
      map.addSource("s-" + f.file, { type: "raster", url: pmUrl(f), tileSize: 256, minzoom: f.minzoom || 0, maxzoom: f.maxzoom || 17 });
      map.addLayer({ id: "l-" + f.file, type: "raster", source: "s-" + f.file,
        paint: { "raster-opacity": effOpacity(id), "raster-fade-duration": 0, "raster-resampling": "linear" } }, "fp-line");
    });
    t.added = true; return;
  }
  await ensureUrls(t); if (t.added) return;
  map.addSource(srcId(id), { type: "image", url: t.urls.preview, coordinates: t.s.coordinates });
  map.addLayer({ id: lyrId(id), type: "raster", source: srcId(id),
    paint: { "raster-opacity": effOpacity(id), "raster-fade-duration": 0, "raster-resampling": "linear" } }, "fp-line");
  t.added = true; t.cur = "preview";
}
function applyVisibility(id) {
  if (PMC()) { applyCorp(T[id].s.corporation); drawOutlines(); return; }
  const t = T[id], on = isOn(id);
  if (t.added) {
    lyrIds(id).forEach(l => { map.setLayoutProperty(l, "visibility", on ? "visible" : "none"); map.setPaintProperty(l, "raster-opacity", effOpacity(id)); });
  } else if (on) addTile(id).then(() => applyVisibility(id));
  drawOutlines();
}
const applyAll = () => order.forEach(applyVisibility);
function drawOutlines() {
  const s = map.getSource("fp"); if (!s) return;
  s.setData({ type: "FeatureCollection", features: order.filter(isOn).map(id => ({ type: "Feature", properties: { id },
    geometry: { type: "Polygon", coordinates: [ring(T[id].s)] } })) });
}
function drawSelection() {
  const feats = sel.ids.map((id, n) => ({ type: "Feature", properties: { main: n === sel.i ? 1 : 0 },
    geometry: { type: "Polygon", coordinates: [ring(T[id].s)] } }));
  map.getSource("sel").setData({ type: "FeatureCollection", features: feats });
}
function bboxOf(s) { const xs = s.coordinates.map(c => c[0]), ys = s.coordinates.map(c => c[1]); return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]; }
function inView(s) {
  const b = map.getBounds(), [[x0, y0], [x1, y1]] = bboxOf(s);
  return x0 <= b.getEast() && x1 >= b.getWest() && y0 <= b.getNorth() && y1 >= b.getSouth();
}
let detailTimer = null;
function refreshDetail() {
  if (PM()) return;
  clearTimeout(detailTimer);
  detailTimer = setTimeout(() => {
    const hi = map.getZoom() >= DETAIL_ZOOM;
    order.forEach(id => {
      const t = T[id]; if (!t.added || !isOn(id)) return;
      const want = hi && inView(t.s) ? "full" : "preview";
      if (t.cur === want) return;
      if (want === "preview") { map.getSource(srcId(id)).updateImage({ url: t.urls.preview, coordinates: t.s.coordinates }); t.cur = want; return; }
      ensureFull(t).then(u => {                          // may need a (cached) download first
        if (t.cur === "full" || map.getZoom() < DETAIL_ZOOM) return;
        map.getSource(srcId(id)).updateImage({ url: u, coordinates: t.s.coordinates }); t.cur = "full";
      }).catch(e => console.warn("full image", e));
    });
  }, 250);
}
function pip(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const hitsAt = pt => order.filter(id => isOn(id) && pip(pt, T[id].s.coordinates)).sort((a, b) => effOpacity(b) - effOpacity(a)).slice(0, 8);

/* ------------------------------------------------------------------ panels (hidden menus) */
const PANELS = { layers: ["pLayers", "bLayers"], legend: ["pLegend", "bLegend"] };
function togglePanel(name) {
  for (const [k, [p, b]] of Object.entries(PANELS)) {
    const open = k === name && $(p).hidden;
    $(p).hidden = !open; $(b).classList.toggle("on", open);
  }
}
$("bLayers").onclick = () => togglePanel("layers");
$("bLegend").onclick = () => togglePanel("legend");
$("zin").onclick = () => map.zoomIn(); $("zout").onclick = () => map.zoomOut();
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("results").hidden) $("results").hidden = true;
  else if (!$("card").hidden) clearSelection();
  else togglePanel(null);
});

async function cacheInfo() {
  try {
    const c = await cacheOpen(); const n = c ? (await c.keys()).length : 0;
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    $("cacheInfo").textContent = c ? "· " + n + " files" + (e && e.usage ? ", " + (e.usage / 1e6).toFixed(0) + " MB" : "") : "· unavailable here";
  } catch (x) {}
}
$("clearCache").onclick = async () => {
  try { await caches.delete(CACHE); cacheStore = null; Object.keys(localStorage).filter(k => k.startsWith("gba-stamp:")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  status("Saved sheets cleared; they will be downloaded again on the next load."); cacheInfo();
};
$("bLayers").addEventListener("click", cacheInfo);

/* ------------------------------------------------------------------ layer list */
function renderList() {
  const q = $("filter").value.trim().toLowerCase(), box = $("list"); box.innerHTML = ""; let n = 0;
  for (const corp of Object.keys(C)) {
    const ids = order.filter(id => T[id].s.corporation === corp && (!q || (id + " " + corp).toLowerCase().includes(q)));
    if (!ids.length) continue;
    const open = C[corp].open || !!q;
    const h = document.createElement("div"); h.className = "row corp";
    h.innerHTML = '<input class="sw" type="checkbox" ' + (C[corp].vis ? "checked" : "") + '><span class="grow">' + esc(corp) + ' <span class="n">' + ids.length + '</span></span>' +
      '<input type="range" min="0" max="1" step="0.01" value="' + C[corp].op + '" title="corporation opacity"><span class="hint">' + (open ? "▾" : "▸") + '</span>';
    const [cb, name, rg] = h.children;
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => { C[corp].vis = cb.checked; applyAll(); renderList(); };
    rg.onclick = e => e.stopPropagation();
    rg.oninput = () => { C[corp].op = +rg.value; order.forEach(id => { if (T[id].s.corporation === corp) applyVisibility(id); }); };
    h.onclick = () => { C[corp].open = !C[corp].open; renderList(); };
    box.append(h);
    if (!open) continue;
    const wrap = document.createElement("div"); wrap.className = "tiles";
    for (const id of ids) {
      const t = T[id]; n++;
      const r = document.createElement("div"); r.className = "row" + (sel.ids[sel.i] === id ? " sel" : "");
      r.innerHTML = PMC() ? '<span class="nm">' + esc(sname(id)) + spage(id) + '</span>' :
        '<input class="sw" type="checkbox" ' + (t.vis ? "checked" : "") + '><span class="nm">' + esc(sname(id)) + spage(id) + '</span>' +
        '<input type="range" min="0" max="1" step="0.01" value="' + t.op + '" title="sheet opacity">';
      const [c, nm, o] = PMC() ? [null, r.children[0], null] : r.children;
      if (c) c.onchange = () => { t.vis = c.checked; applyVisibility(id); };
      if (o) o.oninput = () => { t.op = +o.value; applyVisibility(id); };
      nm.onclick = () => selectSheet(id);
      wrap.append(r);
    }
    box.append(wrap);
  }
  const vis = order.filter(isOn).length;
  $("showAll").hidden = $("hideAll").hidden = PMC();
  $("count").textContent = "· " + vis + " of " + order.length + " visible";
}
$("filter").oninput = renderList;
$("showAll").onclick = () => { order.forEach(i => (T[i].vis = true)); Object.values(C).forEach(c => (c.vis = true)); applyAll(); renderList(); };
$("hideAll").onclick = () => { order.forEach(i => (T[i].vis = false)); applyAll(); renderList(); };
$("gop").oninput = e => { gOp = +e.target.value; order.forEach(applyVisibility); };
$("outlines").onchange = e => map.setLayoutProperty("fp-line", "visibility", e.target.checked ? "visible" : "none");

/* ------------------------------------------------------------------ points (replace popups): click the map -> "Point n" with the sheets that cover it */
/* each authority has its own notice, address and deadline (GBA: No. CC/GBA/PR/304/2026-27; BDA: BDA/TPM/277807/2026-27/2505, comments 9 Oct - 8 Dec 2026) */
const AUTH = {
  GBA: { name: "GBA", to: "gba.masterplan@gmail.com", until: new Date(2026, 11, 12), untilText: "11th December 2026",
    subject: "Suggestion / Objection on Road Circulation Network to be implemented in the Local Planning Area of the Greater Bengaluru Authority",
    intro: "According to the notice put out by the Greater Bengaluru Authority, No. CC/GBA/PR/304/2026-27, citizens may put out their suggestions or objections via email to this email address. Please consider the following my submission.",
    where: p => "Corporation: " + (p.corp || "–"), sign: ["<YOUR NAME>"] },
  BDA: { name: "BDA", to: "bdarmp2041@gmail.com", until: new Date(2026, 11, 9), untilText: "8th December 2026",
    subject: "Suggestion / Objection on Road Circulation Network to be implemented in the Local Planning Area of the Bangalore Development Authority",
    intro: "According to the notification put out by the Bangalore Development Authority, No. BDA/TPM/277807/2026-27/2505, citizens may put out their suggestions or objections via email to this email address. Please consider the following my submission.",
    where: () => "Authority: Bangalore Development Authority (BDA)", sign: ["<YOUR NAME>", "<YOUR ADDRESS>", "<YOUR MOBILE>"] }
};
const authOf = p => (p.ids.length ? (T[p.ids[0]].s.authority || "GBA") : (p.corp === "BDA" ? "BDA" : "GBA"));
const sname = id => (T[id] && T[id].s.authority === "BDA" && T[id].s.grid_no != null) ? "BDA Grid " + T[id].s.grid_no : id;      // BDA scans are one page per grid: show the grid, not 'p1'
const spage = id => (T[id].s.authority === "BDA") ? "" : ' <span class="hint">p' + esc(T[id].s.citation.page) + '</span>';
const mailOpen = a => new Date() < AUTH[a].until;       // GBA takes email; BDA takes its own printed form (bda-feedback-form.pdf, downloaded blank)
const PLACEHOLDER = "<YOUR SUGGESTION OR OBJECTION OR DESCRIPTION OF POINT>";
let P = [], act = -1, addMode = false, nextN = 1;
const centroid = s => [s.coordinates.reduce((a, c) => a + c[0], 0) / s.coordinates.length, s.coordinates.reduce((a, c) => a + c[1], 0) / s.coordinates.length];
let CORP_GEO = [];                                       // OSM corporation outlines (boundaries.geojson), used to decide a point's corporation
const polyHas = (pt, poly) => pip(pt, poly[0]) && !poly.slice(1).some(h => pip(pt, h));
function corpAt(pt) {
  const names = [...new Set(order.map(id => T[id].s.corporation))];
  for (const f of CORP_GEO) {
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    if (polys.some(p => polyHas(pt, p))) { const n = names.find(c => (f.properties.name || "").toLowerCase().includes(c.toLowerCase())); if (n) return n; }
  }
  return "";
}
async function loadBoundaries() {
  try {
    let j = null;
    if (MODE === "zip" && ZIP.file("boundaries.geojson")) j = JSON.parse(await ZIP.file("boundaries.geojson").async("string"));
    else for (const u of CFG.boundaries) { const r = await fetch(u); if (r.ok) { j = await r.json(); break; } }
    if (j) CORP_GEO = j.features.filter(f => !f.properties.kind || f.properties.kind === "gba_corporation");
    else console.warn("boundaries.json not found next to the viewer: point corporations fall back to sheet frames (less accurate)");
  } catch (e) { console.warn("boundaries unavailable", e); }
  P.forEach(locatePoint); if (P.length) afterPointChange();      // points placed before the outlines arrived (e.g. onboarding) get re-assigned
}
/* sheets covering the point, within the point's corporation. The corporation comes from the OSM corporation outlines only (sheet frames overlap and
   include lots of blank margin): inside an outline = that corporation, outside all five = BDA. Only if the outlines couldn't be loaded at all does it
   fall back to the nearest covering sheet's corporation. */
function sheetsAt(pt) {
  const cov = order.filter(id => pip(pt, T[id].s.coordinates)).map(id => { const c = centroid(T[id].s); return { id, d: Math.hypot(c[0] - pt[0], c[1] - pt[1]) }; }).sort((a, b) => a.d - b.d);
  const corp = CORP_GEO.length ? (corpAt(pt) || "BDA") : (cov.some(x => T[x.id].s.corporation === "BDA") ? "BDA" : cov.length ? T[cov[0].id].s.corporation : "");
  return { corp, ids: cov.filter(x => T[x.id].s.corporation === corp).map(x => x.id) };
}
function syncSel() { const p = P[act]; sel = p ? { ids: p.ids, i: p.i } : { ids: [], i: 0 }; }
function locatePoint(p) { const r = sheetsAt([p.lon, p.lat]); p.corp = r.corp; p.ids = r.ids; p.i = Math.min(p.i || 0, Math.max(0, r.ids.length - 1)); }
function pointMarker(p) {
  const el = document.createElement("div"); el.className = "pt-marker"; el.innerHTML = "<span>" + p.n + "</span>";
  const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]).addTo(map);
  m.on("dragend", () => { const l = m.getLngLat(); p.lon = l.lng; p.lat = l.lat; p.name = ""; locatePoint(p); act = P.indexOf(p); afterPointChange(); });
  el.addEventListener("click", e => { e.stopPropagation(); act = P.indexOf(p); addMode = false; afterPointChange(); });
  return m;
}
function afterPointChange() {
  P.forEach((p, k) => p.marker && p.marker.getElement().classList.toggle("on", k === act));
  syncSel(); renderCard(); drawSelection(); renderList();
  try { history.replaceState(null, "", P[act] ? "#pt=" + P[act].lat.toFixed(5) + "," + P[act].lon.toFixed(5) : location.pathname + location.search); } catch (e) {}
}
function addPoint(lon, lat, name, sheetId) {
  const p = { n: P.length + 1, lon, lat, name: name || "", desc: "", i: 0 };
  locatePoint(p);
  if (sheetId && p.ids.includes(sheetId)) p.i = p.ids.indexOf(sheetId);
  p.marker = pointMarker(p); P.push(p); act = P.length - 1; addMode = false; afterPointChange();
  return p;
}
function movePoint(p, lon, lat, name) { p.lon = lon; p.lat = lat; p.name = name || ""; p.i = 0; locatePoint(p); p.marker.setLngLat([lon, lat]); act = P.indexOf(p); afterPointChange(); }
function removePoint(k) {
  const [p] = P.splice(k, 1); p.marker.remove();
  P.forEach((q, j) => { q.n = j + 1; q.marker.getElement().firstChild.textContent = q.n; });   // keep numbering 1..n
  nextN = P.length + 1;
  act = P.length ? Math.min(k, P.length - 1) : -1; addMode = false; afterPointChange();
}
function clearSelection() {
  P.forEach(p => p.marker.remove()); P = []; act = -1; nextN = 1; addMode = false; afterPointChange();
}
function selectSheet(id) {                              // from the Layers list: drop a point on the sheet's centre
  const c = centroid(T[id].s);
  addPoint(c[0], c[1], "", id);
  map.fitBounds(bboxOf(T[id].s), { padding: { top: 60, left: 40, right: 60, bottom: Math.round(innerHeight * 0.45) }, maxZoom: 15 });
}
let soloSaved = null;                                    // visibility before "Only this sheet", restored when toggled off
const isSolo = id => order.every(i => T[i].vis === (i === id)) && Object.values(C).every(c => c.vis);
function toggleSolo(id) {
  if (isSolo(id)) {
    if (soloSaved) { order.forEach(i => { if (i in soloSaved.t) T[i].vis = soloSaved.t[i]; });
      Object.keys(C).forEach(k => { if (k in soloSaved.c) C[k].vis = soloSaved.c[k]; }); }
    else order.forEach(i => (T[i].vis = true));
    soloSaved = null;
  } else {
    soloSaved = { t: Object.fromEntries(order.map(i => [i, T[i].vis])), c: Object.fromEntries(Object.entries(C).map(([k, c]) => [k, c.vis])) };
    order.forEach(i => (T[i].vis = i === id)); Object.values(C).forEach(k => (k.vis = true));
  }
  applyAll(); renderList(); renderCard();
}
const authsOf = pts => [...new Set(pts.map(authOf))];     // authorities involved; >1 = mixed GBA + BDA email, sent to both
function mailText(forUrl, pts) {
  const as = authsOf(pts), A = AUTH[as[0]];
  const L = ["Dear Concerned,", as.length > 1 ? "This submission is addressed to both the Greater Bengaluru Authority (notice No. CC/GBA/PR/304/2026-27) and the Bangalore Development Authority (notification No. BDA/TPM/277807/2026-27/2505), in response to their invitations for suggestions or objections on the Road Circulation Network. Please consider the following my submission." : A.intro, ""];
  pts.forEach(p => {
    const s = p.ids[p.i] && T[p.ids[p.i]].s, gn = s && s.grid_no != null ? s.grid_no : "–";
    L.push("Point " + p.n + ":", "lat: " + p.lat.toFixed(6), "lon: " + p.lon.toFixed(6), AUTH[authOf(p)].where(p), "Grid No: " + gn, "Description: " + PLACEHOLDER, "");
  });
  L.push("Thanks,", ...(as.length > 1 ? AUTH.BDA.sign : A.sign));
  return L.join(forUrl ? "\r\n" : "\n");
}
const mailtoUrl = pts => {
  const as = authsOf(pts), A = AUTH[as[0]];
  const subject = as.length > 1 ? "Suggestion / Objection on Road Circulation Network to be implemented in the Local Planning Areas of the Greater Bengaluru Authority and the Bangalore Development Authority" : A.subject;
  const to = as.includes("GBA") ? AUTH.GBA.to : A.to;               // mixed GBA + BDA: to GBA, BDA in CC
  return "mailto:" + to + "?" + (as.length > 1 ? "cc=" + AUTH.BDA.to + "&" : "") + "subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(mailText(true, pts));
};
function renderCard() {
  const card = $("card"), p = P[act];
  if (!p) { card.hidden = true; return; }
  card.hidden = false;
  const id = p.ids[p.i], t = id && T[id], s = t && t.s, c = (s && s.citation) || {};
  const pageUrl = c.download_url ? c.download_url + "#page=" + c.page : null;
  const au = authOf(p), same = P.filter(q => mailOpen(authOf(q))), canMailAll = same.length > 1 && same.some(q => authOf(q) === "GBA");
  const row = (k, v) => v ? "<dt>" + k + "</dt><dd>" + v + "</dd>" : "";
  card.innerHTML =
    '<div class="head"><div class="ptabs">' + P.map((q, k) => '<button class="chip' + (k === act ? " on" : "") + '" data-p="' + k + '">Point ' + q.n + '</button>').join("") +
      '<button class="chip' + (addMode ? " on" : "") + '" data-a="add" title="Then click the map">+ Add another point</button></div><button class="x" title="Close all points">✕</button></div>' +
    (addMode ? '<div class="hint" style="margin-top:6px">Click the map to place Point ' + (P.length + 1) + '.</div>' : '') +
    '<div style="display:flex;align-items:center;gap:8px;margin-top:8px"><h3>Point ' + p.n + (p.corp ? ' · ' + esc(p.corp) : '') + '</h3><button class="btn" data-a="del" style="margin-left:auto">Remove Point ' + p.n + '</button></div>' +
    (p.name ? '<div class="hint">' + esc(p.name) + '</div>' : '') +
    '<dl class="kv">' + row("Lat", p.lat.toFixed(6)) + row("Lon", p.lon.toFixed(6)) + row(authOf(p) === "BDA" ? "Authority" : "Corporation", esc(p.corp || "–")) + (s && s.grid_no != null ? row("Grid No", esc(s.grid_no)) : "") + '</dl>' +
    '<div class="sub2">Sheets at this point</div>' +
    (p.ids.length ? '<div class="chips">' + p.ids.map((x, n) => '<button class="chip' + (n === p.i ? " on" : "") + '" data-i="' + n + '">' + esc(sname(x)) + '</button>').join("") + '</div>' :
      '<div class="hint">No sheet covers this point.</div>') +
    (s ? '<dl class="kv">' +
      row("Notification", esc(c.notification || "")) +
      row("Source", c.notification && !c.download_url ? "" : pageUrl ? '<a target="_blank" rel="noopener" href="' + esc(pageUrl) + '">' + esc(c.pdf) + ', page ' + esc(c.page) + '</a>' : esc(c.pdf) + ", page " + esc(c.page)) +
      row("Resource", c.resource_page ? '<a target="_blank" rel="noopener" href="' + esc(c.resource_page) + '">' + esc(c.resource_name || "OpenCity resource page") + '</a>' : esc(c.resource_name)) +
      row("Dataset", c.dataset ? '<a target="_blank" rel="noopener" href="' + esc(c.dataset) + '">' + esc(TS.dataset || c.dataset) + '</a>' : "") +
      '</dl>' +
      '<div class="acts">' + (PMC() ? '' : '<button class="btn' + (isSolo(id) ? " primary" : "") + '" data-a="solo" title="Toggle: show only this sheet, click again to bring the others back">Only this sheet</button>' +
      '<button class="btn" data-a="hide">' + (t.vis ? "Hide" : "Show") + '</button>' +
      '<label class="hint" style="display:flex;gap:6px;align-items:center">Opacity <input type="range" min="0" max="1" step="0.01" value="' + t.op + '"></label>') + '</div>' : '') +
    (mailOpen(au) ? '<div class="sub2">' + (au === "BDA" ? "Submit to BDA" : "Email your suggestion or objection") + '</div>' +
    '<div class="acts">' + (au === "BDA" ? '<a class="btn primary" data-a="bdaform" href="bda-feedback-form.pdf" download="BDA-suggestions-form.pdf">Download Suggestions Form</a>'
      : '<a class="btn primary" data-a="mail1" href="#">Email this point</a>') +
      (canMailAll ? '<a class="btn primary" data-a="mailall" href="#">Email all points (' + same.length + ')</a>' : '') +
      (au === "GBA" ? '<button class="btn" data-a="copy">Copy text</button>' : '') + '</div>' +
    '<div class="hint" style="margin-top:6px">' + (au === "BDA" ? 'BDA takes comments on its official form: download the blank form, fill and sign it, and hand it in or email it to ' + AUTH.BDA.to + '. ' : 'Open a draft email to send to GBA. Add your suggestions or objections within the email. ') +
      (canMailAll && same.some(q => authOf(q) === "BDA") ? '“Email all points” goes to GBA with BDA in CC. ' : '') + 'Deadline ' + AUTH[au].untilText + '.</div>' : '');
  card.querySelector(".x").onclick = clearSelection;
  card.querySelectorAll("[data-p]").forEach(b => (b.onclick = () => { act = +b.dataset.p; addMode = false; afterPointChange(); }));
  card.querySelectorAll(".chip[data-i]").forEach(b => (b.onclick = () => { p.i = +b.dataset.i; afterPointChange(); }));
  card.querySelector('[data-a="add"]').onclick = () => { addMode = !addMode; renderCard(); };
  const q = a => card.querySelector('[data-a="' + a + '"]');
  if (q("solo")) q("solo").onclick = () => toggleSolo(id);
  if (q("hide")) q("hide").onclick = () => { t.vis = !t.vis; applyVisibility(id); renderList(); renderCard(); };
  const rg = card.querySelector("input[type=range]"); if (rg) rg.oninput = () => { t.op = +rg.value; applyVisibility(id); };
  if (q("mail1")) q("mail1").onclick = e => { e.preventDefault(); location.href = mailtoUrl([p]); };
  if (q("mailall")) q("mailall").onclick = e => { e.preventDefault(); location.href = mailtoUrl(same); };
  if (q("copy")) q("copy").onclick = async () => {
    const txt = "To: " + AUTH[au].to + "\nSubject: " + AUTH[au].subject + "\n\n" + mailText(false, [p]);
    try { await navigator.clipboard.writeText(txt); status("Email text copied."); } catch (x) { status("Couldn’t copy; use the email button."); }
  };
  q("del").onclick = () => removePoint(act);
}

/* ------------------------------------------------------------------ basemaps, search, location */
const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LAB = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
let baseKind = "osm";
function setBase(kind) {
  baseKind = kind;
  map.setLayoutProperty("osm", "visibility", kind === "osm" ? "visible" : "none");
  map.setLayoutProperty("sat", "visibility", kind === "sat" ? "visible" : "none");
  map.setLayoutProperty("lab", "visibility", kind === "sat" && $("labels").checked ? "visible" : "none");
  $("labRow").hidden = kind !== "sat";
  document.querySelectorAll("#basemap button").forEach(b => b.classList.toggle("on", b.dataset.b === kind));
}
document.querySelectorAll("#basemap button").forEach(b => (b.onclick = () => setBase(b.dataset.b)));
$("labels").onchange = () => setBase(baseKind);

function showPlace(p) {
  const [s, n, w, e] = p.boundingbox.map(Number), pt = [+p.lon, +p.lat];
  if (Math.abs(n - s) < 1e-4 && Math.abs(e - w) < 1e-4) map.flyTo({ center: pt, zoom: 16 });
  else map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 17 });
  if (P[act] && !addMode) movePoint(P[act], pt[0], pt[1], p.display_name); else addPoint(pt[0], pt[1], p.display_name);
}
async function search() {
  const q = $("q").value.trim(), res = $("results"); if (!q) { res.hidden = true; return; }
  res.hidden = false; res.innerHTML = '<div class="r hint">Searching…</div>';
  try {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.search = new URLSearchParams({ q, format: "jsonv2", limit: "6", addressdetails: "0",
      ...($("bias").checked ? { viewbox: CFG.search_viewbox.join(","), bounded: "0" } : {}) });
    const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status);
    const rows = await r.json();
    res.innerHTML = rows.length ? "" : '<div class="r hint">No results.</div>';
    rows.forEach(p => {
      const d = document.createElement("div"); d.className = "r"; d.textContent = p.display_name;
      d.onclick = () => { res.hidden = true; showPlace(p); };
      res.append(d);
    });
  } catch (e) { res.innerHTML = '<div class="r hint">Search failed: ' + esc(e.message) + '</div>'; }
}
$("q").addEventListener("keydown", e => { if (e.key === "Enter") search(); });
$("q").addEventListener("input", () => { $("qclear").hidden = !$("q").value; if (!$("q").value) $("results").hidden = true; });
$("qclear").onclick = () => { $("q").value = ""; $("qclear").hidden = true; $("results").hidden = true; $("q").focus(); };

let locMarker = null, watchId = null;
function circle(lon, lat, r) {
  const pts = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI;
    pts.push([lon + (r * Math.cos(a)) / (111320 * Math.cos(lat * Math.PI / 180)), lat + (r * Math.sin(a)) / 110574]); }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}
function showPos(pos, fly) {
  const { longitude: lon, latitude: lat, accuracy } = pos.coords;
  if (!locMarker) { const el = document.createElement("div"); el.className = "user-location-marker";
    locMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map); }
  locMarker.setLngLat([lon, lat]);
  map.getSource("acc").setData({ type: "FeatureCollection", features: [circle(lon, lat, accuracy)] });
  if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15) });
}
function locate() {
  if (!navigator.geolocation) return status("Geolocation not supported");
  if (!window.isSecureContext) return status("Location needs https or localhost");
  status("Locating…", null, true);
  navigator.geolocation.getCurrentPosition(p => { status("Located ±" + Math.round(p.coords.accuracy) + " m"); showPos(p, true); },
    e => status(e.code === 1 ? "Location permission denied" : "Couldn’t get location"), { enableHighAccuracy: true, timeout: 15000 });
}
$("bLoc").onclick = locate;
$("follow").onchange = e => {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (e.target.checked && navigator.geolocation && window.isSecureContext)
    watchId = navigator.geolocation.watchPosition(p => showPos(p, true), () => {}, { enableHighAccuracy: true });
};

/* ------------------------------------------------------------------ legend (data, rendered as HTML/CSS) */
function swatchEl(s) {
  const el = document.createElement("div"); el.className = "lg-sw";
  if (!s) { el.innerHTML = '<span class="hint">–</span>'; return el; }
  const col = s.color || "#000", th = Math.max(2, Math.min(10, Math.round((s.thickness_px || 8) / 2.2)));
  if (s.kind === "fill") { el.innerHTML = '<div class="box" style="width:100%;background:' + esc(col) + ';border-color:' + esc(col) + '"></div>'; return el; }
  if (s.kind === "outline") { el.innerHTML = '<div class="box" style="width:100%;border:1.5px dashed ' + esc(col) + '"></div>'; return el; }
  if (s.kind === "area-pattern") {
    el.innerHTML = '<div class="box" style="width:100%;border-color:' + esc(col) + ';background:repeating-linear-gradient(135deg,' + esc(col) + ' 0 1.5px,transparent 1.5px 6px)"></div>'; return el;
  }
  let bg = col;
  if (s.kind === "dashed" && s.profile && s.profile.length > 1) {
    let x = 0; const stops = [];
    for (const [ink, frac] of s.profile) { const a = x * 100, b = (x + frac) * 100; stops.push((ink ? col : "transparent") + " " + a.toFixed(1) + "% " + b.toFixed(1) + "%"); x += frac; }
    bg = "linear-gradient(90deg," + stops.join(",") + ")";
  }
  el.innerHTML = '<i style="height:' + th + 'px;background:' + bg + ';border-radius:' + (s.kind === "dashed" ? 0 : th / 2) + 'px"></i>' +
    (s.kind === "symbol" ? '<span class="dot" style="border-color:' + esc(col) + ';background:var(--surface-solid)"></span>' : "");
  return el;
}
function renderLegend(L) {
  const box = $("legendBody"); box.innerHTML = "";
  const p = L.plan || {}, meta = document.createElement("div"); meta.className = "meta";
  meta.innerHTML = [p.title && "<b>" + esc(p.title) + "</b>", (p.authority || []).map(esc).join(" · "),
    p.scale && "Scale " + esc(p.scale) + " (corporation sheets)" + (L.bda_grid && L.bda_grid.scale ? ", " + esc(L.bda_grid.scale) + " (BDA grids)" : "") + (L.overview && L.overview.scale ? ", " + esc(L.overview.scale) + " (overview)" : ""),
    p.scale_bar && p.scale_bar.ticks && p.scale_bar.ticks.length ? "Scale bar labels (m): " + p.scale_bar.ticks.map(esc).join(", ") : ""].filter(Boolean).join("<br>");
  box.append(meta);
  (L.sections || []).forEach(sec => {
    const h = document.createElement("h3"); h.textContent = sec.title; box.append(h);
    (sec.columns || []).forEach(col => col.forEach(e => {
      const r = document.createElement("div"); r.className = "lrow";
      r.append(swatchEl(e.swatch)); const t = document.createElement("span"); t.textContent = e.label; r.append(t); box.append(r);
    }));
  });
  (L.notes || []).forEach(n => { const d = document.createElement("div"); d.className = "meta"; d.style.marginTop = "8px"; d.textContent = n; box.append(d); });
  const src = document.createElement("div"); src.className = "meta"; src.style.marginTop = "8px";
  src.textContent = "Extracted from the scanned PDFs by OCR and pixel sampling (see legend.json).";
  box.append(src);
  $("bLegend").hidden = false;
}
async function loadLegend() {
  try {
    if (MODE === "zip" && ZIP.file("legend.json")) return renderLegend(JSON.parse(await ZIP.file("legend.json").async("string")));
    for (const u of CFG.legend) { const r = await fetch(u); if (r.ok) return renderLegend(await r.json()); }
  } catch (e) { console.warn("legend unavailable", e); }
}

/* ------------------------------------------------------------------ start */
let pmProtocol = null;
function makeMap() {
  if (window.pmtiles && !pmProtocol) { pmProtocol = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", pmProtocol.tile); }
  map = new maplibregl.Map({
    container: "map", center: CFG.center, zoom: CFG.zoom, maxZoom: 21, attributionControl: { compact: true },
    style: { version: 8, sources: {
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" },
      sat: { type: "raster", tiles: [SAT], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community" },
      lab: { type: "raster", tiles: [LAB], tileSize: 256, maxzoom: 19, attribution: "Labels © Esri" } },
      layers: [{ id: "osm", type: "raster", source: "osm" },
               { id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } },
               { id: "lab", type: "raster", source: "lab", layout: { visibility: "none" } }] }
  });
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  return new Promise(res => map.on("load", res));
}
async function start() {
  status("Preparing map…", null, true);
  document.title = CFG.title;
  order = TS.sheets.map(s => s.id).sort();
  order.forEach(id => { const s = TS.sheets.find(x => x.id === id); T[id] = { s, vis: true, op: 1, urls: {}, added: false };
    C[s.corporation] = C[s.corporation] || { vis: true, op: 1, open: false }; });
  await makeMap();
  const empty = { type: "FeatureCollection", features: [] };
  map.addSource("fp", { type: "geojson", data: empty });
  map.addLayer({ id: "fp-line", type: "line", source: "fp", layout: { visibility: "none" }, paint: { "line-color": "#0b6bcb", "line-width": 1.1, "line-opacity": 0.7 } });
  map.addSource("sel", { type: "geojson", data: empty });
  map.addLayer({ id: "sel-fill", type: "fill", source: "sel", filter: ["==", ["get", "main"], 1], paint: { "fill-color": "#0b6bcb", "fill-opacity": 0.1 } });
  map.addLayer({ id: "sel-line", type: "line", source: "sel", paint: { "line-color": "#0b6bcb", "line-width": ["case", ["==", ["get", "main"], 1], 3.5, 1.5],
    "line-opacity": ["case", ["==", ["get", "main"], 1], 1, 0.55] } });
  map.addSource("acc", { type: "geojson", data: empty });
  map.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#0b6bcb", "fill-opacity": 0.12 } });
  map.addLayer({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#0b6bcb", "line-width": 1 } });
  map.on("moveend", refreshDetail);
  const LOADING = "Loading tiles…";                       // toast while map tile requests are in flight; hidden once everything is rendered
  let lastTileEvt = 0, loadTimer = null;
  const loadDone = () => { clearInterval(loadTimer); loadTimer = null; if ($("status").textContent === LOADING) status(""); };
  const loadStart = () => {
    lastTileEvt = Date.now();
    if (!tilesReady) return;
    if ($("status").textContent !== LOADING) status(LOADING, null, true);
    if (!loadTimer) loadTimer = setInterval(() => { if (map.areTilesLoaded() || Date.now() - lastTileEvt > 4000) loadDone(); }, 300);   // 4 s without any tile activity = give up waiting (aborted request)
  };
  map.on("dataloading", e => { if (e.dataType !== "style") loadStart(); });
  map.on("sourcedata", () => { lastTileEvt = Date.now(); });
  map.on("idle", loadDone);
  map.on("click", e => {
    $("results").hidden = true;
    const lon = e.lngLat.lng, lat = e.lngLat.lat;
    if (!P.length || addMode) addPoint(lon, lat); else movePoint(P[act], lon, lat);
  });
  let hov = 0;
  map.on("mousemove", e => {
    if (hov) return;
    hov = requestAnimationFrame(() => { hov = 0;
      map.getCanvas().style.cursor = "crosshair"; });
  });
  const all = TS.sheets.flatMap(s => s.coordinates), xs = all.map(c => c[0]), ys = all.map(c => c[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 40, duration: 0 });
  await loadBoundaries();
  if (CORP_GEO.length) {                                 // OSM corporation outlines, optional layer
    map.addSource("bnd", { type: "geojson", data: { type: "FeatureCollection", features: CORP_GEO } });
    map.addLayer({ id: "bnd-casing", type: "line", source: "bnd", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 5, "line-opacity": 0.7 } }, "fp-line");
    map.addLayer({ id: "bnd-line", type: "line", source: "bnd", layout: { visibility: "none", "line-join": "round" }, paint: { "line-color": "#7a1fa2", "line-width": 2.2, "line-dasharray": [3, 2] } }, "fp-line");
    $("bndRow").hidden = false;
    $("bnd").onchange = e => ["bnd-casing", "bnd-line"].forEach(l => map.setLayoutProperty(l, "visibility", e.target.checked ? "visible" : "none"));
  }
  renderList(); loadLegend();
  if (PM()) checkRange();
  if (PMC()) { addPmtiles(); drawOutlines(); }
  else for (let i = 0; i < order.length; i++) {       // one by one: bounded memory, visible progress
    status("Preparing sheets " + (i + 1) + " / " + order.length + "…", (i + 1) / order.length, true);
    await addTile(order[i]); applyVisibility(order[i]);
  }
  status(TS.sheets.length + " sheets" + (PM() ? " (PMTiles)" : " loaded") + (MODE === "zip" ? " from the zip" : "") + ". Click the map to mark a point.");
  const m = /#sheet=([^&]+)/.exec(location.hash), pt = /#pt=(-?[\d.]+),(-?[\d.]+)/.exec(location.hash);
  if (m && T[decodeURIComponent(m[1])]) selectSheet(decodeURIComponent(m[1]));
  else if (pt) { addPoint(+pt[2], +pt[1]); map.flyTo({ center: [+pt[2], +pt[1]], zoom: 15, duration: 0 }); }
  renderList(); refreshDetail(); tilesReady = true;
}
boot();
