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

  // ---------- Thèmes jour / nuit ----------
  const THEMES = {
    day: {
      bg: "#eceee9", water: "#cfe0e8", waterLine: "#b5cfda", land: 0.18, border: "#9aa3ad",
      label: "#7d8590", waterLabel: "#6a8ea0", halo: "#eceee9",
      high: "#5b4bc4", low: "#13897b", both: "#2f6fa6", sel: "#e8590c",
      wpt: "#4b5563", navaid: "#1764c9", ndb: "#9b2f86", boxFill: "#ffffff", textHalo: "#ffffff",
    },
    night: {
      bg: "#0e1626", water: "#0a1220", waterLine: "#14233a", land: 0.08, border: "#33435f",
      label: "#6f7f9e", waterLabel: "#3f5878", halo: "#0e1626",
      high: "#9d8cff", low: "#2fc7b1", both: "#5fb0ea", sel: "#ff8a3d",
      wpt: "#c3cde0", navaid: "#5aa8ff", ndb: "#e07ad0", boxFill: "#0e1626", textHalo: "#0e1626",
    },
  };
  function initialTheme() {
    try { const t = localStorage.getItem("nelixair-theme"); if (THEMES[t]) return t; } catch {}
    return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
  }
  let theme = initialTheme();
  document.documentElement.dataset.theme = theme;

  // ---------- Fond de carte : style libre, épuré façon carte en route ----------
  const DROP = /road|highway|bridge|tunnel|rail|building|poi|aeroway|transit|housenumber|landuse|park|ferry|aerialway|motorway|path|pier|mountain_peak/i;
  let baseLayers = [];
  async function basemap() {
    try {
      const r = await fetch(CFG.basemapStyle);
      if (!r.ok) throw new Error(r.status);
      const st = await r.json();
      st.layers = st.layers.filter((l) => !DROP.test(l.id));
      st.glyphs = st.glyphs || CFG.glyphs;
      return st;
    } catch (e) {
      console.warn("Fond de carte indisponible, fond uni utilisé", e);
      return { version: 8, glyphs: CFG.glyphs, sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": THEMES.day.bg } }] };
    }
  }
  function paintBasemap(T) {
    for (const l of baseLayers) {
      const set = (k, v) => { try { map.setPaintProperty(l.id, k, v); } catch {} };
      if (l.type === "background") set("background-color", T.bg);
      else if (l.type === "fill" && /water/i.test(l.id)) set("fill-color", T.water);
      else if (l.type === "fill") set("fill-opacity", T.land);
      else if (l.type === "line" && /water|river/i.test(l.id)) set("line-color", T.waterLine);
      else if (l.type === "line" && /boundary|admin/i.test(l.id)) set("line-color", T.border);
      else if (l.type === "symbol") {
        set("text-color", /water|ocean|sea|lake/i.test(l.id) ? T.waterLabel : T.label);
        set("text-halo-color", T.halo);
      }
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
  const F = CFG.font, FB = CFG.fontBold;
  const freqText = ["case", ["has", "freq"],
    ["case", ["==", ["get", "cls"], "ndb"],
      ["number-format", ["get", "freq"], { "max-fraction-digits": 0 }],
      ["number-format", ["get", "freq"], { "min-fraction-digits": 2, "max-fraction-digits": 2 }]],
    ""];
  const lineWidth = ["interpolate", ["linear"], ["zoom"], 2, 0.6, 6, 1.2, 10, 2.2];
  // MEA : niveau de vol au-dessus de 18 000 ft (altitude de transition US), pieds sinon
  const meaText = ["case", [">=", ["get", "mea"], 18000],
    ["concat", "FL", ["to-string", ["round", ["/", ["get", "mea"], 100]]]],
    ["to-string", ["get", "mea"]]];
  const isNdb = ["==", ["get", "cls"], "ndb"];

  function addLayers() {
    for (const [id, s] of Object.entries(navSources)) if (!map.getSource(id)) map.addSource(id, s);
    map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    for (const [lv, minzoom] of [["L", 4], ["B", 3], ["H", 2]]) {
      map.addLayer({ id: `awy-${lv}`, type: "line", ...src("airways"), minzoom,
        filter: ["==", ["get", "level"], lv],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": lineWidth, "line-opacity": 0.9 } });
    }
    map.addLayer({ id: "awy-sel", type: "line", ...src("airways"),
      filter: ["==", ["get", "ident"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2.5, 10, 5], "line-opacity": 0.95 } });

    // Idents de voies en cartouche + MEA au-dessous aux zooms élevés
    for (const lv of ["L", "B", "H"]) {
      map.addLayer({ id: `awy-lbl-${lv}`, type: "symbol", ...src("airways"), minzoom: lv === "H" ? 5 : 6,
        filter: ["==", ["get", "level"], lv],
        layout: {
          "symbol-placement": "line-center",
          "text-field": ["step", ["zoom"], ["get", "ident"],
            8, ["format", ["get", "ident"], {}, ["case", ["has", "mea"], ["concat", "\n", meaText], ""], { "font-scale": 0.8 }]],
          "text-font": FB, "text-size": 10.5, "text-rotation-alignment": "viewport", "text-keep-upright": true,
          "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3],
          "icon-rotation-alignment": "viewport", "symbol-sort-key": lv === "H" ? 0 : 1,
        } });
    }

    // Waypoints : petit cercle ouvert, ident aux zooms moyens
    map.addLayer({ id: "wpt", type: "symbol", ...src("fixes"), minzoom: 6,
      filter: ["==", ["get", "cls"], "waypoint"],
      layout: {
        "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1],
        "icon-allow-overlap": true,
        "text-field": ["step", ["zoom"], "", 7, ["get", "ident"]],
        "text-font": F, "text-size": 10, "text-offset": [0, 0.8], "text-anchor": "top", "text-optional": true,
      },
      paint: { "text-halo-width": 1.2 } });

    // Navaids : symbole + cartouche ident/fréquence
    map.addLayer({ id: "nav", type: "symbol", ...src("fixes"), minzoom: 3,
      filter: ["!=", ["get", "cls"], "waypoint"],
      layout: {
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 1],
        "icon-allow-overlap": true,
        "symbol-sort-key": ["match", ["get", "cls"], ["vortac", "vordme", "vor"], 0, 1],
      } });
    map.addLayer({ id: "nav-lbl", type: "symbol", ...src("fixes"), minzoom: 5,
      filter: ["!=", ["get", "cls"], "waypoint"],
      layout: {
        "text-field": ["step", ["zoom"], ["get", "ident"],
          7, ["format", ["get", "ident"], { "text-font": ["literal", FB] }, "\n", {}, freqText, { "font-scale": 0.85 }]],
        "text-font": F, "text-size": 10.5, "text-anchor": "left", "text-offset": [1.3, 0], "text-justify": "left",
        "icon-text-fit": "both", "icon-text-fit-padding": [2, 4, 2, 4],
        "text-optional": false,
      } });

    map.addLayer({ id: "sel-pt", type: "circle", source: "sel",
      paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5 } });
  }

  // Applique couleurs et icônes du thème courant (fond + couches aéro).
  function applyTheme(name) {
    theme = name;
    const T = THEMES[name];
    document.documentElement.dataset.theme = name;
    try { localStorage.setItem("nelixair-theme", name); } catch {}
    $("#theme-btn").setAttribute("aria-pressed", name === "night");
    $("#theme-btn").title = name === "night" ? "Passer en mode jour" : "Passer en mode nuit";
    paintBasemap(T);
    window.NelixairSymbols.register(map, name, T);
    const P = (id, k, v) => map.setPaintProperty(id, k, v);
    const L = (id, k, v) => map.setLayoutProperty(id, k, v);
    P("awy-H", "line-color", T.high); P("awy-L", "line-color", T.low); P("awy-B", "line-color", T.both);
    P("awy-sel", "line-color", T.sel); P("sel-pt", "circle-stroke-color", T.sel);
    for (const lv of ["L", "B", "H"]) {
      L(`awy-lbl-${lv}`, "icon-image", `${name}-box-${lv}`);
      P(`awy-lbl-${lv}`, "text-color", lv === "L" ? T.low : lv === "H" ? T.high : T.both);
    }
    L("wpt", "icon-image", `${name}-sym-waypoint`);
    P("wpt", "text-color", T.wpt); P("wpt", "text-halo-color", T.textHalo);
    L("nav", "icon-image", ["concat", `${name}-sym-`, ["get", "cls"]]);
    L("nav-lbl", "icon-image", ["case", isNdb, `${name}-box-ndb`, `${name}-box-nav`]);
    P("nav-lbl", "text-color", ["case", isNdb, T.ndb, T.navaid]);
  }
  $("#theme-btn").addEventListener("click", () => applyTheme(theme === "night" ? "day" : "night"));

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
  const layersBtn = $("#layers-btn"), layersPop = $("#layers");
  function toggleLayers(open) {
    layersPop.hidden = !open;
    layersBtn.setAttribute("aria-expanded", open);
  }
  layersBtn.addEventListener("click", () => toggleLayers(layersPop.hidden));
  document.addEventListener("click", (e) => {
    if (!layersPop.hidden && !e.target.closest(".menu")) toggleLayers(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleLayers(false); });

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
    baseLayers = map.getStyle().layers.slice();
    addLayers();
    applyTheme(theme);
    applyVisibility();
    if (useGeojson) console.info("Mode GeoJSON (pas de PMTiles trouvées)");
  });
})();
