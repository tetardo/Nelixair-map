(async function () {
  const CFG = window.NELIXAIR_CONFIG;
  const params = new URLSearchParams(location.search);
  const $ = (s) => document.querySelector(s);

  // ---------- Données : PMTiles, ou repli GeoJSON ----------
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  async function exists(url) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      return r.ok;
    } catch { return false; }
  }
  const useGeojson = params.has("geojson") || !(await exists(CFG.pmtiles));
  const pmUrl = new URL(CFG.pmtiles, location.href).href;
  const attribution = CFG.attribution;
  const navSources = useGeojson
    ? {
        fixes: { type: "geojson", data: CFG.geojson.fixes, attribution },
        airways: { type: "geojson", data: CFG.geojson.airways },
      }
    : { nav: { type: "vector", url: "pmtiles://" + pmUrl, attribution } };
  const src = (layer) => (useGeojson ? { source: layer } : { source: "nav", "source-layer": layer });

  // ---------- Fond de carte : style libre, re-colorisé façon carte en route ----------
  const PAPER = "#f3f0e6";
  const DROP = /road|highway|bridge|tunnel|rail|building|poi|aeroway|transit|housenumber|landuse|park|ferry|aerialway|motorway|path|pier|mountain_peak/i;
  async function basemap() {
    try {
      const r = await fetch(CFG.basemapStyle);
      if (!r.ok) throw new Error(r.status);
      const st = await r.json();
      st.layers = st.layers.filter((l) => !DROP.test(l.id));
      for (const l of st.layers) {
        l.paint = l.paint || {};
        if (l.type === "background") l.paint["background-color"] = PAPER;
        else if (l.type === "fill" && /water/i.test(l.id)) l.paint["fill-color"] = "#d4e3e8";
        else if (l.type === "fill") l.paint["fill-opacity"] = 0.25;
        else if (l.type === "line" && /water|river/i.test(l.id)) l.paint["line-color"] = "#bcd3db";
        else if (l.type === "line" && /boundary|admin/i.test(l.id)) l.paint["line-color"] = "#9e967f";
        else if (l.type === "symbol") {
          l.paint["text-color"] = /water|ocean|sea|lake/i.test(l.id) ? "#6b8fa0" : "#8a8473";
          l.paint["text-halo-color"] = PAPER;
        }
      }
      st.glyphs = st.glyphs || CFG.glyphs;
      return st;
    } catch (e) {
      console.warn("Fond de carte indisponible, fond uni utilisé", e);
      return { version: 8, glyphs: CFG.glyphs, sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": PAPER } }] };
    }
  }

  const map = new maplibregl.Map({
    container: "map",
    style: await basemap(),
    center: CFG.center,
    zoom: CFG.zoom,
    minZoom: 1.5,
    maxZoom: 13,
    hash: "map",
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "nautical" }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  // ---------- Couches ----------
  const C = { high: "#24365f", low: "#2f6b4f", both: "#4b4f80", sel: "#c2410c", ink: "#1d2433", navaid: "#1f5fa8", ndb: "#8a3d74" };
  const F = CFG.font, FB = CFG.fontBold;
  const freqText = ["case", ["has", "freq"],
    ["case", ["==", ["get", "cls"], "ndb"],
      ["number-format", ["get", "freq"], { "max-fraction-digits": 0 }],
      ["number-format", ["get", "freq"], { "min-fraction-digits": 2, "max-fraction-digits": 2 }]],
    ""];
  const lineWidth = ["interpolate", ["linear"], ["zoom"], 2, 0.5, 6, 1.1, 10, 2];

  function addLayers() {
    window.NelixairSymbols.register(map);
    for (const [id, s] of Object.entries(navSources)) if (!map.getSource(id)) map.addSource(id, s);
    map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    const levels = [["L", C.low, 4], ["B", C.both, 3], ["H", C.high, 2]];
    for (const [lv, color, minzoom] of levels) {
      map.addLayer({ id: `awy-${lv}`, type: "line", ...src("airways"), minzoom,
        filter: ["==", ["get", "level"], lv],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": lineWidth, "line-opacity": 0.85 } });
    }
    map.addLayer({ id: "awy-sel", type: "line", ...src("airways"),
      filter: ["==", ["get", "ident"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": C.sel, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 10, 4], "line-opacity": 0.9 } });

    // Idents de voies en cartouche + MEA au-dessous aux zooms élevés
    for (const lv of ["L", "B", "H"]) {
      map.addLayer({ id: `awy-lbl-${lv}`, type: "symbol", ...src("airways"), minzoom: lv === "H" ? 5 : 6,
        filter: ["==", ["get", "level"], lv],
        layout: {
          "symbol-placement": "line-center",
          "text-field": ["step", ["zoom"], ["get", "ident"],
            8, ["format", ["get", "ident"], {}, ["case", ["has", "mea"], ["concat", "\n", ["to-string", ["get", "mea"]]], ""], { "font-scale": 0.8 }]],
          "text-font": FB, "text-size": 10.5, "text-rotation-alignment": "viewport", "text-keep-upright": true,
          "icon-image": lv === "L" ? "box-L" : "box-H", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3],
          "icon-rotation-alignment": "viewport", "symbol-sort-key": lv === "H" ? 0 : 1,
        },
        paint: { "text-color": lv === "L" ? C.low : C.high } });
    }

    // Waypoints
    map.addLayer({ id: "wpt", type: "symbol", ...src("fixes"), minzoom: 6,
      filter: ["==", ["get", "cls"], "waypoint"],
      layout: {
        "icon-image": "sym-waypoint", "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1],
        "icon-allow-overlap": true,
        "text-field": ["step", ["zoom"], "", 7.5, ["get", "ident"]],
        "text-font": F, "text-size": 10, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true,
      },
      paint: { "text-color": C.ink, "text-halo-color": "#fff", "text-halo-width": 1.2 } });

    // Navaids : symbole + cartouche ident/fréquence
    map.addLayer({ id: "nav", type: "symbol", ...src("fixes"), minzoom: 3,
      filter: ["!=", ["get", "cls"], "waypoint"],
      layout: {
        "icon-image": ["concat", "sym-", ["get", "cls"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 1],
        "icon-allow-overlap": true,
        "symbol-sort-key": ["match", ["get", "cls"], ["vortac", "vordme", "vor"], 0, 1],
      },
      paint: {} });
    map.addLayer({ id: "nav-lbl", type: "symbol", ...src("fixes"), minzoom: 5,
      filter: ["!=", ["get", "cls"], "waypoint"],
      layout: {
        "text-field": ["step", ["zoom"], ["get", "ident"],
          7, ["format", ["get", "ident"], { "text-font": ["literal", FB] }, "\n", {}, freqText, { "font-scale": 0.85 }]],
        "text-font": F, "text-size": 10.5, "text-anchor": "left", "text-offset": [1.3, 0], "text-justify": "left",
        "icon-image": ["case", ["==", ["get", "cls"], "ndb"], "box-ndb", "box-nav"], "icon-text-fit": "both", "icon-text-fit-padding": [2, 4, 2, 4],
        "text-optional": false,
      },
      paint: { "text-color": ["case", ["==", ["get", "cls"], "ndb"], C.ndb, C.navaid] } });

    map.addLayer({ id: "sel-pt", type: "circle", source: "sel",
      paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": C.sel, "circle-stroke-width": 2.5 } });
  }

  // ---------- Visibilité par groupe ----------
  const GROUPS = {
    "awy-H": ["awy-H", "awy-lbl-H"], "awy-L": ["awy-L", "awy-lbl-L"],
    navaid: ["nav", "nav-lbl"], waypoint: ["wpt"],
  };
  function applyVisibility() {
    const on = {};
    document.querySelectorAll(".layers input").forEach((i) => (on[i.dataset.group] = i.checked));
    for (const [g, ids] of Object.entries(GROUPS))
      for (const id of ids) map.setLayoutProperty(id, "visibility", on[g] ? "visible" : "none");
    const b = on["awy-H"] || on["awy-L"] ? "visible" : "none";
    map.setLayoutProperty("awy-B", "visibility", b);
    map.setLayoutProperty("awy-lbl-B", "visibility", b);
  }
  document.querySelectorAll(".layers input").forEach((i) => i.addEventListener("change", applyVisibility));

  // ---------- Formatage ----------
  const CLS = { waypoint: "Waypoint", vor: "VOR", vordme: "VOR/DME", vortac: "VORTAC", tacan: "TACAN", dme: "DME", ndb: "NDB" };
  const LVL = { H: "Haute altitude", L: "Basse altitude", B: "Haute et basse" };
  const SRC = { "faa-cifp": "FAA CIFP", openaip: "OpenAIP" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function dms(v, lat) {
    const h = lat ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W");
    v = Math.abs(v);
    const d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
    return `${h}${String(d).padStart(lat ? 2 : 3, "0")}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"`;
  }
  const freq = (p) => p.freq == null ? null : p.cls === "ndb" ? `${Math.round(p.freq)} kHz` : `${Number(p.freq).toFixed(2)} MHz`;
  const alt = (ft) => ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString("fr-FR")} ft`;
  function rows(pairs) {
    return "<dl>" + pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("") + "</dl>";
  }
  function fixHtml(p, lngLat) {
    return `<div class="pop"><h3>${esc(p.ident)} <small>${CLS[p.cls] || esc(p.cls)}</small></h3>` +
      rows([["Nom", p.name && p.name !== p.ident ? p.name : null], ["Fréquence", freq(p)], ["Canal", p.channel],
        ["Lat", dms(lngLat[1], true)], ["Lon", dms(lngLat[0], false)],
        ["Région", p.region || p.country]]) +
      `<div class="src">${esc(SRC[p.src] || p.src)}${p.cycle ? " · cycle " + esc(p.cycle) : ""}</div></div>`;
  }
  function legHtml(p) {
    const dir = p.dir === "F" ? `sens unique ${p.from} → ${p.to}` : p.dir === "B" ? `sens unique ${p.to} → ${p.from}` : null;
    return `<div class="pop"><h3>${esc(p.ident)} <small>${p.level === "H" ? "Haute" : p.level === "L" ? "Basse" : "H+B"}</small></h3>` +
      rows([["Tronçon", `${p.from} → ${p.to}`], ["Distance", `${p.dist_nm} NM`], ["Route vraie", `${String(p.trk_true).padStart(3, "0")}°`],
        ["MEA", p.mea ? alt(p.mea) : null], ["Alt. maxi", p.max_alt ? alt(p.max_alt) : null], ["Sens", dir], ["Niveau", LVL[p.level]]]) +
      `<div class="src">${esc(SRC[p.src] || p.src)}</div></div>`;
  }

  // ---------- Sélection / popups ----------
  let popup = null;
  function selectAirway(ident) {
    map.setFilter("awy-sel", ["==", ["get", "ident"], ident || ""]);
  }
  function selectPoint(lngLat) {
    map.getSource("sel").setData({ type: "FeatureCollection",
      features: lngLat ? [{ type: "Feature", geometry: { type: "Point", coordinates: lngLat }, properties: {} }] : [] });
  }
  function showPopup(lngLat, html) {
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: "300px", focusAfterOpen: false }).setLngLat(lngLat).setHTML(html).addTo(map);
    popup.on("close", () => { selectPoint(null); });
  }

  const CLICKABLE = ["nav", "nav-lbl", "wpt", "awy-H", "awy-L", "awy-B", "awy-lbl-H", "awy-lbl-L", "awy-lbl-B"];
  map.on("click", (e) => {
    const b = 6;
    const feats = map.queryRenderedFeatures([[e.point.x - b, e.point.y - b], [e.point.x + b, e.point.y + b]],
      { layers: CLICKABLE.filter((l) => map.getLayer(l)) });
    if (!feats.length) { selectAirway(null); selectPoint(null); if (popup) popup.remove(); return; }
    const pts = [], legs = [], seen = new Set();
    for (const f of feats) {
      const p = f.properties;
      const key = f.geometry.type === "Point" ? `p|${p.ident}|${p.cls}|${f.geometry.coordinates}` : `l|${p.ident}|${p.from}|${p.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (f.geometry.type === "Point" ? pts : legs).push(f);
    }
    if (pts.length) {
      const f = pts[0];
      selectPoint(f.geometry.coordinates);
      showPopup(f.geometry.coordinates, pts.slice(0, 3).map((x) => fixHtml(x.properties, x.geometry.coordinates)).join(""));
      selectAirway(null);
    } else {
      selectPoint(null);
      selectAirway(legs[0].properties.ident);
      showPopup(e.lngLat, legs.slice(0, 3).map((x) => legHtml(x.properties)).join(""));
    }
  });
  map.on("mousemove", (e) => {
    const f = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]],
      { layers: CLICKABLE.filter((l) => map.getLayer(l)) });
    map.getCanvas().style.cursor = f.length ? "pointer" : "";
    $("#cursor").textContent = `${dms(e.lngLat.lat, true)} ${dms(e.lngLat.wrap().lng, false)}`;
  });

  // ---------- Recherche d'ident ----------
  let index = null, indexP = null;
  function loadIndex() {
    indexP = indexP || fetch(CFG.search).then((r) => r.json()).then((j) => (index = j)).catch((e) => {
      console.error(e); indexP = null; return null;
    });
    return indexP;
  }
  const input = $("#q"), list = $("#results");
  let hits = [], active = -1;
  function search(q) {
    q = q.trim().toUpperCase();
    if (!q || !index) return [];
    const exact = [], prefix = [];
    for (const [ident, bb] of Object.entries(index.airways)) {
      if (ident === q) exact.push({ t: "awy", ident, bb }); else if (ident.startsWith(q)) prefix.push({ t: "awy", ident, bb });
    }
    for (const r of index.fixes) {
      const id = r[0];
      if (id === q) exact.push({ t: "fix", r }); else if (id.startsWith(q) && prefix.length < 200) prefix.push({ t: "fix", r });
    }
    prefix.sort((a, b) => (a.ident || a.r[0]).length - (b.ident || b.r[0]).length);
    return exact.concat(prefix).slice(0, 30);
  }
  function render() {
    list.innerHTML = "";
    if (!input.value.trim()) { list.hidden = true; return; }
    list.hidden = false;
    if (!index) { list.innerHTML = '<li class="empty">Chargement de l\'index…</li>'; return; }
    if (!hits.length) { list.innerHTML = '<li class="empty">Aucun résultat</li>'; return; }
    hits.forEach((h, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === active);
      li.innerHTML = h.t === "awy"
        ? `<span class="id">${esc(h.ident)}</span><span class="cls">Voie</span><span class="nm"></span>`
        : `<span class="id">${esc(h.r[0])}</span><span class="cls">${CLS[h.r[1]] || esc(h.r[1])}</span><span class="nm">${esc([h.r[4], h.r[5]].filter(Boolean).join(" · "))}</span>`;
      li.addEventListener("mousedown", (ev) => { ev.preventDefault(); choose(h); });
      list.appendChild(li);
    });
  }
  function choose(h) {
    list.hidden = true;
    input.blur();
    if (h.t === "awy") {
      input.value = h.ident;
      selectPoint(null);
      selectAirway(h.ident);
      if (popup) popup.remove();
      const [w, s, e, n] = h.bb;
      // voie traversant l'antiméridien : on centre simplement sur sa partie la plus large
      map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 8, duration: 900 });
    } else {
      const [ident, cls, lon, lat, name, region] = h.r;
      input.value = ident;
      selectAirway(null);
      selectPoint([lon, lat]);
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), cls === "waypoint" ? 8.5 : 7.5), duration: 900 });
      showPopup([lon, lat], fixHtml({ ident, cls, name, region, src: "", freq: null }, [lon, lat])
        .replace('<div class="src"></div>', ""));
      // remplace par la popup complète (fréquence, source…) une fois la tuile chargée
      map.once("moveend", () => {
        const pt = map.project([lon, lat]);
        const f = map.queryRenderedFeatures([[pt.x - 3, pt.y - 3], [pt.x + 3, pt.y + 3]], { layers: ["nav", "wpt"] })
          .find((x) => x.properties.ident === ident);
        if (f) showPopup([lon, lat], fixHtml(f.properties, [lon, lat]));
      });
    }
  }
  input.addEventListener("focus", loadIndex);
  input.addEventListener("input", async () => {
    render();
    await loadIndex();
    hits = search(input.value); active = hits.length ? 0 : -1;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      render();
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") { list.hidden = true; input.blur(); }
  });
  $("#search").addEventListener("submit", (e) => { e.preventDefault(); if (hits[active]) choose(hits[active]); });
  input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 100));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  });

  // ---------- Métadonnées, attribution ----------
  fetch(CFG.meta).then((r) => r.json()).then((meta) => {
    const ul = $("#sources");
    for (const s of meta.sources || []) {
      const li = document.createElement("li");
      li.innerHTML = `<b>${esc(s.name)}</b> — ${esc(s.coverage || "")}<br><small>Licence : ${esc(s.license || "?")}` +
        `${s.cycle ? " · cycle " + esc(s.cycle) : ""} · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></small>`;
      ul.appendChild(li);
    }
    const li = document.createElement("li");
    li.innerHTML = `<small>Génération : ${esc(meta.built)} · ${meta.counts.fixes.toLocaleString("fr-FR")} points, ${meta.counts.airways.toLocaleString("fr-FR")} voies</small>`;
    ul.appendChild(li);
    const cyc = (meta.sources || []).filter((s) => s.cycle).map((s) => `${s.name} ${s.cycle}`).join(" · ");
    $("#cycle").textContent = cyc;
  }).catch(() => { $("#sources").innerHTML = "<li>Métadonnées indisponibles.</li>"; });
  $("#about-btn").addEventListener("click", () => $("#about").showModal());

  map.on("load", () => {
    addLayers();
    applyVisibility();
    if (useGeojson) console.info("Mode GeoJSON (pas de PMTiles trouvées)");
  });
})();
