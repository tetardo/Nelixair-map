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
  const [hasNavPm, hasAspPm] = params.has("geojson") ? [false, false]
    : await Promise.all([exists(CFG.pmtiles), exists(CFG.airspacesPmtiles)]);
  const useGeojson = !hasNavPm;
  const abs = (u) => new URL(u, location.href).href;
  const attribution = CFG.attribution;
  const navSources = useGeojson
    ? {
        fixes: { type: "geojson", data: CFG.geojson.fixes, attribution },
        airways: { type: "geojson", data: CFG.geojson.airways },
        airports: { type: "geojson", data: CFG.geojson.airports },
      }
    : { nav: { type: "vector", url: "pmtiles://" + abs(CFG.pmtiles), attribution } };
  navSources.asp = hasAspPm
    ? { type: "vector", url: "pmtiles://" + abs(CFG.airspacesPmtiles) }
    : { type: "geojson", data: CFG.geojson.airspaces };
  navSources.mora = { type: "geojson", data: CFG.mora };
  navSources.wx = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  const src = (layer) => (useGeojson ? { source: layer } : { source: "nav", "source-layer": layer });
  const aspSrc = hasAspPm ? { source: "asp", "source-layer": "airspaces" } : { source: "asp" };

  // ---------- Thèmes jour / nuit ----------
  const THEMES = {
    day: {
      bg: "#eceee9", water: "#cfe0e8", waterLine: "#b5cfda", land: 0.18, border: "#9aa3ad",
      label: "#7d8590", waterLabel: "#6a8ea0", halo: "#eceee9",
      high: "#5b4bc4", low: "#13897b", both: "#2f6fa6", sel: "#e8590c",
      wpt: "#4b5563", navaid: "#1764c9", ndb: "#9b2f86", boxFill: "#ffffff", textHalo: "#ffffff",
      aptIfr: "#1764c9", aptVfr: "#9b2f86", aspCtl: "#2b74c7", aspSpecial: "#c2265a", aspFir: "#5b6472", aspOther: "#8a6fc0",
      mora: "#9a6b2f", moraLine: "rgba(154,107,47,.25)",
    },
    night: {
      bg: "#0e1626", water: "#0a1220", waterLine: "#14233a", land: 0.08, border: "#33435f",
      label: "#6f7f9e", waterLabel: "#3f5878", halo: "#0e1626",
      high: "#9d8cff", low: "#2fc7b1", both: "#5fb0ea", sel: "#ff8a3d",
      wpt: "#c3cde0", navaid: "#5aa8ff", ndb: "#e07ad0", boxFill: "#0e1626", textHalo: "#0e1626",
      aptIfr: "#5aa8ff", aptVfr: "#e07ad0", aspCtl: "#4f9bf0", aspSpecial: "#ff5c8a", aspFir: "#7d8aa5", aspOther: "#a993e6",
      mora: "#d1a865", moraLine: "rgba(209,168,101,.22)",
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
  const WX = window.NelixairWx;

  const ASP_LINES = [["asp-line", null, 1.1], ["asp-line-spc", [3, 2], 1.4], ["asp-line-fir", [6, 3, 1, 3], 1.6]];
  const ASP_LINE_BASE = {
    "asp-line": ["match", ["get", "group"], ["special", "fir"], false, true],
    "asp-line-spc": ["==", ["get", "group"], "special"],
    "asp-line-fir": ["==", ["get", "group"], "fir"],
  };
  const ASP_LINE_IDS = ASP_LINES.map((l) => l[0]);

  function addLayers() {
    for (const [id, s] of Object.entries(navSources)) if (!map.getSource(id)) map.addSource(id, s);
    map.addSource("sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    // Espaces aériens (sous les voies) : remplissage léger, contour, nom + limites le long du contour
    map.addLayer({ id: "asp-fill", type: "fill", ...aspSrc, minzoom: 4,
      filter: ["!=", ["get", "group"], "fir"], paint: { "fill-opacity": 0.05 } });
    // contours : un calque par style de trait (line-dasharray n'accepte pas d'expression par entité)
    for (const [id, dash, width] of ASP_LINES) {
      map.addLayer({ id, type: "line", ...aspSrc, filter: ASP_LINE_BASE[id],
        layout: { "line-join": "round" },
        paint: { "line-width": width, "line-opacity": 0.75, ...(dash ? { "line-dasharray": dash } : {}) } });
    }
    map.addLayer({ id: "asp-lbl", type: "symbol", ...aspSrc, minzoom: 6,
      layout: {
        "symbol-placement": "line", "symbol-spacing": 500, "text-max-angle": 30,
        "text-field": ["concat", ["get", "name"],
          ["case", ["has", "icao_class"], ["concat", " (", ["get", "icao_class"], ")"], ""],
          ["case", ["has", "lower"], ["concat", "  ", ["get", "lower"], " / ", ["coalesce", ["get", "upper"], ""]], ""]],
        "text-font": F, "text-size": 10, "text-offset": [0, -0.7],
      },
      paint: { "text-halo-width": 1.2 } });

    // Grid MORA : quadrillage 1° + valeur en milliers (centaines en exposant)
    map.addLayer({ id: "mora-line", type: "line", source: "mora", minzoom: 4, maxzoom: 11,
      filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-width": 0.6 } });
    map.addLayer({ id: "mora-lbl", type: "symbol", source: "mora", minzoom: 5, maxzoom: 11,
      filter: ["==", ["geometry-type"], "Point"],
      layout: { "text-field": ["format", ["get", "th"], {}, ["get", "hu"], { "font-scale": 0.62 }], "text-font": FB, "text-size": ["interpolate", ["linear"], ["zoom"], 5, 13, 9, 22],
        "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-opacity": 0.55 } });

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

    // METAR : anneau coloré par catégorie de vol autour de l'aéroport
    map.addLayer({ id: "wx", type: "circle", source: "wx", minzoom: 5,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 13], "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 10, 3.5],
        "circle-stroke-color": ["match", ["get", "cat"], "VFR", WX.COLORS.VFR, "MVFR", WX.COLORS.MVFR,
          "IFR", WX.COLORS.IFR, "LIFR", WX.COLORS.LIFR, "#888"] } });

    // Aéroports
    map.addLayer({ id: "apt", type: "symbol", ...src("airports"), minzoom: 3,
      layout: {
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 9, 1],
        "icon-allow-overlap": ["step", ["zoom"], false, 6, true],
        "symbol-sort-key": ["get", "rank"],
        "text-field": ["step", ["zoom"], ["case", ["==", ["get", "kind"], "large"], ["get", "ident"], ""],
          7, ["get", "ident"],
          10, ["format", ["get", "ident"], { "text-font": ["literal", FB] }, "\n", {}, ["coalesce", ["get", "name"], ""], { "font-scale": 0.8 }]],
        "text-font": FB, "text-size": 10.5, "text-anchor": "top", "text-offset": [0, 0.9], "text-optional": true,
        "text-max-width": 10,
      },
      paint: { "text-halo-width": 1.3 } });

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
    L("apt", "icon-image", ["concat", `${name}-apt-`, ["get", "kind"], ["case", ["==", ["get", "ifr"], true], "-ifr", "-vfr"]]);
    P("apt", "text-color", ["case", ["==", ["get", "ifr"], true], T.aptIfr, T.aptVfr]);
    P("apt", "text-halo-color", T.textHalo);
    const aspColor = ["match", ["get", "group"], "controlled", T.aspCtl, "special", T.aspSpecial, "fir", T.aspFir, T.aspOther];
    P("asp-fill", "fill-color", aspColor);
    for (const id of ASP_LINE_IDS) P(id, "line-color", aspColor);
    P("asp-lbl", "text-color", aspColor); P("asp-lbl", "text-halo-color", T.textHalo);
    P("mora-line", "line-color", T.moraLine); P("mora-lbl", "text-color", T.mora);
    L("nav-lbl", "icon-image", ["case", isNdb, `${name}-box-ndb`, `${name}-box-nav`]);
    P("nav-lbl", "text-color", ["case", isNdb, T.ndb, T.navaid]);
  }
  $("#theme-btn").addEventListener("click", () => applyTheme(theme === "night" ? "day" : "night"));

  // ---------- Filtres (sidebar) ----------
  const NAV_CLASSES = ["vor", "vordme", "vortac", "tacan", "dme", "ndb"];
  function filterState() {
    const on = {};
    document.querySelectorAll("#tab-filters input[data-f]").forEach((i) => (on[i.dataset.f] = i.checked));
    return on;
  }
  function applyFilters() {
    const on = filterState();
    const rnav = ["coalesce", ["get", "rnav"], false];
    const typeF = on.rnav && on.conv ? true : on.rnav ? ["==", rnav, true] : on.conv ? ["==", rnav, false] : false;
    const vis = { H: on.H, L: on.L, B: on.H || on.L };
    for (const lv of ["H", "L", "B"]) {
      const f = ["all", ["==", ["get", "level"], lv], typeF];
      for (const id of [`awy-${lv}`, `awy-lbl-${lv}`]) {
        map.setFilter(id, f);
        map.setLayoutProperty(id, "visibility", vis[lv] ? "visible" : "none");
      }
    }
    const classes = NAV_CLASSES.filter((c) => on[c]);
    const navF = ["in", ["get", "cls"], ["literal", classes]];
    map.setFilter("nav", navF);
    map.setFilter("nav-lbl", navF);
    map.setLayoutProperty("wpt", "visibility", on.waypoint ? "visible" : "none");
    const kinds = ["large", "medium", "small"].filter((k) => on[`apt_${k}`]).concat(on.apt_heli ? ["heliport", "seaplane"] : []);
    map.setFilter("apt", ["in", ["get", "kind"], ["literal", kinds]]);
    map.setLayoutProperty("apt", "visibility", kinds.length ? "visible" : "none");
    const groups = ["controlled", "special", "fir", "other"].filter((g) => on[`asp_${g}`]);
    const gF = ["in", ["get", "group"], ["literal", groups]];
    map.setFilter("asp-fill", ["all", ["!=", ["get", "group"], "fir"], gF]);
    for (const id of ASP_LINE_IDS) map.setFilter(id, ["all", ASP_LINE_BASE[id], gF]);
    map.setFilter("asp-lbl", gF);
    for (const id of ["asp-fill", "asp-lbl", ...ASP_LINE_IDS]) map.setLayoutProperty(id, "visibility", groups.length ? "visible" : "none");
    for (const id of ["mora-line", "mora-lbl"]) map.setLayoutProperty(id, "visibility", on.mora ? "visible" : "none");
    map.setLayoutProperty("wx", "visibility", on.wx ? "visible" : "none");
    wxEnabled = on.wx;
    if (on.wx) scheduleWx(); else $("#wx-status").hidden = true;
    try { localStorage.setItem("nelixair-filters", JSON.stringify(on)); } catch {}
    scheduleList();
  }
  try {
    const saved = JSON.parse(localStorage.getItem("nelixair-filters") || "null");
    if (saved) document.querySelectorAll("#tab-filters input[data-f]").forEach((i) => {
      if (i.dataset.f in saved) i.checked = !!saved[i.dataset.f];
    });
  } catch {}
  document.querySelectorAll("#tab-filters input[data-f]").forEach((i) => i.addEventListener("change", applyFilters));

  // ---------- METAR dans la vue ----------
  let wxEnabled = false, wxTimer = null, wxSeq = 0;
  function scheduleWx() {
    clearTimeout(wxTimer);
    wxTimer = setTimeout(loadWx, 400);
  }
  async function loadWx() {
    const st = $("#wx-status");
    const empty = { type: "FeatureCollection", features: [] };
    if (!wxEnabled || !map.getSource("wx")) return;
    if (map.getZoom() < 5) {
      map.getSource("wx").setData(empty);
      st.hidden = false; st.textContent = "METAR affichés à partir du zoom 5.";
      return;
    }
    const b = map.getBounds();
    const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast());
    const seq = ++wxSeq;
    try {
      const list = await WX.metarsInBbox(w, Math.max(-90, b.getSouth()), e, Math.min(90, b.getNorth()));
      if (seq !== wxSeq) return;
      const feats = (list || []).filter((m) => m.lat != null && m.lon != null).map((m) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [m.lon, m.lat] },
        properties: { id: m.icaoId, cat: WX.flightCat(m) || "", raw: m.rawOb || "" },
      }));
      map.getSource("wx").setData({ type: "FeatureCollection", features: feats });
      st.hidden = false;
      st.textContent = `${feats.length} METAR dans la vue · aviationweather.gov`;
    } catch (err) {
      if (seq !== wxSeq) return;
      console.warn("METAR indisponibles", err);
      st.hidden = false;
      st.textContent = "METAR indisponibles : aviationweather.gov ne répond pas depuis ce navigateur.";
    }
  }
  map.on("moveend", () => { if (wxEnabled) scheduleWx(); });

  // ---------- Sidebar : ouverture, onglets ----------
  const sidebar = $("#sidebar"), sideBtn = $("#side-btn");
  const isMobile = () => matchMedia("(max-width: 760px)").matches;
  function setSidebar(open, persist = true) {
    document.body.classList.toggle("side-open", open);
    sideBtn.setAttribute("aria-pressed", open);
    sidebar.setAttribute("aria-hidden", !open);
    if (persist && !isMobile()) { try { localStorage.setItem("nelixair-side", open ? "1" : "0"); } catch {} }
    setTimeout(() => map.resize(), 220);
    scheduleList();
  }
  const sideOpen = () => document.body.classList.contains("side-open");
  sideBtn.addEventListener("click", () => setSidebar(!sideOpen()));
  $("#side-close").addEventListener("click", () => setSidebar(false));
  let savedSide = null;
  try { savedSide = localStorage.getItem("nelixair-side"); } catch {}

  let tab = "filters";
  function setTab(name) {
    tab = name;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
    document.querySelectorAll(".tabpanel").forEach((p) => (p.hidden = p.id !== `tab-${name}`));
    if (name === "list") scheduleList();
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ---------- Formatage ----------
  const CLS = { waypoint: "Waypoint", vor: "VOR", vordme: "VOR/DME", vortac: "VORTAC", tacan: "TACAN", dme: "DME", ndb: "NDB", airport: "Aéroport" };
  const APT_KIND = { large: "Grand aéroport", medium: "Aéroport", small: "Petit terrain", heliport: "Héliport", seaplane: "Hydrobase" };
  const SURF = { hard: "revêtue", soft: "non revêtue", water: "plan d'eau" };
  const ASP_GROUP = { controlled: "Contrôlé", special: "Zone réglementée", fir: "Région d'information", other: "Autre" };
  const ft = (v) => v == null ? null : `${Number(v).toLocaleString("fr-FR")} ft`;
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
  function aptRows(p, lngLat) {
    return rows([["Nom", p.name], ["IATA", p.iata], ["Type", (APT_KIND[p.kind] || "") + (p.mil === true || p.mil === "true" ? " · militaire" : "")],
      ["Altitude", ft(p.elev_ft)], ["Piste la + longue", p.rwy_ft ? `${ft(p.rwy_ft)}${p.rwy_surface ? " · " + SURF[p.rwy_surface] : ""}` : null],
      ["IFR", p.ifr === true || p.ifr === "true" ? "Oui" : null],
      ["Latitude", dms(lngLat[1], true)], ["Longitude", dms(lngLat[0], false)], ["Pays", p.country || p.region]]);
  }
  function aspHtml(p) {
    return `<div class="pop"><h3>${esc(p.name)} <small>${esc(p.type)}</small></h3>` +
      rows([["Classe", p.icao_class], ["Plancher", p.lower], ["Plafond", p.upper], ["Catégorie", ASP_GROUP[p.group]], ["Pays", p.country]]) + "</div>";
  }
  function fixHtml(p, lngLat) {
    if (p.cls === "airport")
      return `<div class="pop"><h3>${esc(p.ident)} <small>${esc(APT_KIND[p.kind] || "Aéroport")}</small></h3>` + aptRows(p, lngLat) +
        `<div class="src">${esc(SRC[p.src] || p.src || "")}</div></div>`;
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

  // ---------- Géodésie (log de voie) ----------
  const RAD = Math.PI / 180;
  function distNm(a, b) {
    const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
    const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  const deg3 = (v) => String(Math.round(v) % 360).padStart(3, "0") + "°";

  // ---------- Index des voies (routes.json, chargé à la demande) ----------
  let routes = null, routesP = null, fixAirways = null;
  function loadRoutes() {
    routesP = routesP || fetch(CFG.routes).then((r) => r.json()).then((j) => {
      routes = j;
      fixAirways = new Map();
      for (const [awy, r] of Object.entries(j))
        for (const part of r.parts)
          for (const [id, , lon, lat] of part.pts) {
            const arr = fixAirways.get(id) || [];
            arr.push({ lon, lat, awy });
            fixAirways.set(id, arr);
          }
      return j;
    }).catch((e) => { console.error(e); routesP = null; return null; });
    return routesP;
  }
  function airwaysThrough(ident, lngLat) {
    const near = (fixAirways?.get(ident) || []).filter((x) => Math.abs(x.lon - lngLat[0]) < 0.02 && Math.abs(x.lat - lngLat[1]) < 0.02);
    return [...new Set(near.map((x) => x.awy))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  }

  // ---------- Panneau Détail ----------
  const detail = $("#tab-detail");
  const LVL_SHORT = { H: "Haute", L: "Basse", B: "H+B" };
  function catBadge(cat) {
    return cat ? `<span class="cat" style="background:${WX.COLORS[cat] || "#888"}">${cat}</span>` : "";
  }
  function showAirportDetail(p, lngLat) {
    detail.innerHTML = `<div class="d-head"><h2>${esc(p.ident)}</h2><span class="badge">${esc(APT_KIND[p.kind] || "Aéroport")}</span></div>` +
      aptRows(p, lngLat) + `<p class="muted small">Source : ${esc(SRC[p.src] || p.src || "")}${p.cycle ? " · " + esc(p.cycle) : ""}</p>` +
      `<h3>Météo</h3><div id="d-wx"><span class="muted">Chargement…</span></div>`;
    setTab("detail");
    const box = () => $("#d-wx");
    if (!/^[A-Z0-9]{4}$/.test(p.ident)) { box().innerHTML = '<span class="muted">Pas de code OACI : météo non disponible.</span>'; return; }
    Promise.allSettled([WX.metar(p.ident), WX.taf(p.ident)]).then(([m, t]) => {
      const el = box();
      if (!el) return;
      if (m.status === "rejected" && t.status === "rejected") {
        el.innerHTML = '<span class="muted">Météo indisponible : aviationweather.gov ne répond pas depuis ce navigateur.</span>';
        return;
      }
      const mt = m.value, tf = t.value;
      let html = "";
      if (mt) {
        const v = WX.visSm(mt.visib), c = WX.ceilingFt(mt);
        html += `<div class="d-head">${catBadge(WX.flightCat(mt))}<span class="muted small">${esc(mt.reportTime || "")}</span></div>` +
          rows([["Vent", WX.wind(mt)], ["Visibilité", v != null ? `${v >= 10 ? "≥ 10" : v} SM` : null],
            ["Plafond", c != null ? ft(c) : "Aucun"], ["Temp. / rosée", mt.temp != null ? `${mt.temp} / ${mt.dewp ?? "?"} °C` : null],
            ["QNH", mt.altim != null ? `${Math.round(mt.altim)} hPa` : null]]) +
          `<div class="wx-raw">${esc(mt.rawOb)}</div>`;
      } else html += '<p class="muted small">Pas de METAR récent.</p>';
      html += tf ? `<h3>TAF</h3><div class="wx-raw">${esc(tf.rawTAF || "")}</div>` : '<p class="muted small">Pas de TAF.</p>';
      el.innerHTML = html;
    });
  }
  function showAirspaceDetail(list) {
    list = list.slice().sort((a, b) => (a.lower_ft ?? 0) - (b.lower_ft ?? 0));
    detail.innerHTML = `<div class="d-head"><h2>Espaces</h2><span class="badge">${list.length}</span></div>` +
      `<p class="muted small">Espaces aériens à cet endroit, du plus bas au plus haut.</p>` +
      list.map((p) => `<h3>${esc(p.name)} · ${esc(p.type)}${p.icao_class ? " · classe " + esc(p.icao_class) : ""}</h3>` +
        rows([["Plancher", p.lower], ["Plafond", p.upper], ["Catégorie", ASP_GROUP[p.group]], ["Pays", p.country]])).join("");
    setTab("detail");
  }
  function showFixDetail(p, lngLat) {
    if (p.cls === "airport") return showAirportDetail(p, lngLat);
    detail.innerHTML = `<div class="d-head"><h2>${esc(p.ident)}</h2><span class="badge">${CLS[p.cls] || esc(p.cls)}</span></div>` +
      (p.name && p.name !== p.ident ? `<p class="d-sub">${esc(p.name)}</p>` : "") +
      rows([["Fréquence", freq(p)], ["Canal", p.channel], ["Latitude", dms(lngLat[1], true)], ["Longitude", dms(lngLat[0], false)],
        ["Région", p.region || p.country], ["Source", (SRC[p.src] || p.src || "") + (p.cycle ? " · " + p.cycle : "")]]) +
      `<h3>Voies passant par ce point</h3><div class="chips" id="d-awys"><span class="muted">Chargement…</span></div>`;
    loadRoutes().then(() => {
      const box = $("#d-awys");
      if (!box) return;
      const list = routes ? airwaysThrough(p.ident, lngLat) : [];
      box.innerHTML = list.length ? "" : '<span class="muted">Aucune</span>';
      for (const a of list) {
        const b = document.createElement("button");
        b.className = "chip"; b.textContent = a;
        b.addEventListener("click", () => openAirway(a, { fit: true }));
        box.appendChild(b);
      }
    });
    setTab("detail");
  }
  function showAirwayDetail(ident) {
    detail.innerHTML = `<div class="d-head"><h2>${esc(ident)}</h2></div><p class="muted">Chargement…</p>`;
    setTab("detail");
    loadRoutes().then(() => {
      const r = routes && routes[ident];
      if (!r) { detail.innerHTML = `<div class="d-head"><h2>${esc(ident)}</h2></div><p class="muted">Voie introuvable dans l'index.</p>`; return; }
      const levels = [...new Set(r.parts.map((p) => p.lv))].map((l) => LVL_SHORT[l]).join(", ");
      let total = 0, n = 0;
      const tables = r.parts.map((part, pi) => {
        let cum = 0;
        const trs = part.pts.map((pt, i) => {
          const [id, cls, lon, lat, , dir] = pt;
          let trk = "", d = "", mea = "";
          if (i > 0) {
            const prev = part.pts[i - 1];
            const dd = distNm([prev[2], prev[3]], [lon, lat]);
            cum += dd;
            trk = deg3(bearing([prev[2], prev[3]], [lon, lat]));
            d = dd.toFixed(0);
            mea = prev[4] ? alt(prev[4]) : "";
          }
          n++;
          return `<tr data-lon="${lon}" data-lat="${lat}" data-id="${esc(id)}" data-cls="${esc(cls)}">` +
            `<td><b>${esc(id)}</b><small>${cls === "waypoint" ? "" : esc(CLS[cls] || cls)}</small></td>` +
            `<td>${mea}</td><td>${trk}</td><td>${d}</td><td>${i ? cum.toFixed(0) : ""}</td></tr>` +
            (dir && i < part.pts.length - 1 ? `<tr class="note"><td colspan="5">Sens unique ${dir === "F" ? "→" : "←"}</td></tr>` : "");
        }).join("");
        total += cum;
        return (r.parts.length > 1 ? `<h3>Portion ${pi + 1} · ${LVL_SHORT[part.lv]}</h3>` : "") +
          `<table class="log"><thead><tr><th>Point</th><th>MEA</th><th>Rte</th><th>NM</th><th>Cumul</th></tr></thead><tbody>${trs}</tbody></table>`;
      }).join("");
      detail.innerHTML = `<div class="d-head"><h2>${esc(ident)}</h2><span class="badge">${r.rnav ? "RNAV" : "Conv."}</span></div>` +
        rows([["Niveau", levels], ["Longueur", `${total.toFixed(0)} NM`], ["Points", n], ["Portions", r.parts.length]]) +
        `<button class="ghost" id="d-fit">Afficher toute la voie</button>` + tables +
        `<p class="muted small">MEA et route vraie du tronçon arrivant sur le point.</p>`;
      $("#d-fit").addEventListener("click", () => fitAirway(ident));
      detail.querySelectorAll("tr[data-lon]").forEach((tr) => tr.addEventListener("click", () => {
        const ll = [+tr.dataset.lon, +tr.dataset.lat];
        selectPoint(ll);
        map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 8), duration: 700 });
      }));
    });
  }
  function fitAirway(ident) {
    if (!routes || !routes[ident]) return;
    const pts = routes[ident].parts.flatMap((p) => p.pts);
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of pts) { w = Math.min(w, p[2]); e = Math.max(e, p[2]); s = Math.min(s, p[3]); n = Math.max(n, p[3]); }
    map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 8, duration: 800 });
  }

  // Point d'entrée commun (clic carte, recherche, liste)
  function openFix(p, lngLat, { fly = false } = {}) {
    selectAirway(null);
    selectPoint(lngLat);
    if (fly) map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), p.cls === "waypoint" ? 8.5 : 7.5), duration: 800 });
    if (sideOpen()) { if (popup) popup.remove(); showFixDetail(p, lngLat); }
    else showPopup(lngLat, fixHtml(p, lngLat));
    if (isMobile() && sideOpen() && fly) setSidebar(false);
  }
  function openAirway(ident, { fit = false } = {}) {
    selectPoint(null);
    selectAirway(ident);
    if (popup) popup.remove();
    if (!sideOpen() && !isMobile()) setSidebar(true);
    if (sideOpen()) showAirwayDetail(ident);
    if (fit) loadRoutes().then(() => fitAirway(ident));
  }

  // ---------- Panneau Liste (éléments visibles) ----------
  let listMode = "pts", listTimer = null;
  const listEl = $("#vis-list"), countEl = $("#vis-count"), sortEl = $("#vis-sort"), filtEl = $("#vis-filter");
  function scheduleList() {
    clearTimeout(listTimer);
    listTimer = setTimeout(renderList, 150);
  }
  const TYPE_ORDER = { airport: -1, vortac: 0, vordme: 1, vor: 2, tacan: 3, dme: 4, ndb: 5, waypoint: 6 };
  function renderList() {
    if (!sideOpen() || tab !== "list" || !map.getLayer("nav")) return;
    const q = filtEl.value.trim().toUpperCase();
    const c = map.getCenter().toArray();
    let items = [];
    const seen = new Set();
    if (listMode === "pts") {
      for (const f of map.queryRenderedFeatures({ layers: ["apt", "nav", "wpt"].filter((l) => map.getLayoutProperty(l, "visibility") !== "none") })) {
        const p = f.properties, ll = f.geometry.coordinates;
        const k = `${p.ident}|${p.cls}|${ll[0].toFixed(3)}|${ll[1].toFixed(3)}`;
        if (seen.has(k) || (q && !p.ident.startsWith(q))) continue;
        seen.add(k);
        items.push({ p, ll, d: distNm(c, ll) });
      }
      const s = sortEl.value;
      items.sort((a, b) => s === "dist" ? a.d - b.d
        : s === "type" ? (TYPE_ORDER[a.p.cls] - TYPE_ORDER[b.p.cls]) || a.p.ident.localeCompare(b.p.ident)
        : a.p.ident.localeCompare(b.p.ident));
    } else {
      const lyr = ["awy-H", "awy-L", "awy-B"].filter((l) => map.getLayoutProperty(l, "visibility") !== "none");
      const by = new Map();
      for (const f of map.queryRenderedFeatures({ layers: lyr })) {
        const p = f.properties;
        if (q && !p.ident.startsWith(q)) continue;
        const it = by.get(p.ident) || { ident: p.ident, lv: new Set(), rnav: p.rnav === true || p.rnav === "true", n: 0 };
        it.lv.add(p.level); it.n++;
        by.set(p.ident, it);
      }
      items = [...by.values()];
      const s = sortEl.value;
      items.sort((a, b) => s === "dist" ? b.n - a.n
        : s === "type" ? ([...a.lv].join() + a.ident).localeCompare([...b.lv].join() + b.ident, "fr", { numeric: true })
        : a.ident.localeCompare(b.ident, "fr", { numeric: true }));
    }
    countEl.textContent = `${items.length.toLocaleString("fr-FR")} ${listMode === "pts" ? "point(s)" : "voie(s)"} à l'écran`;
    const MAX = 400;
    listEl.innerHTML = items.slice(0, MAX).map((it, i) => listMode === "pts"
      ? `<li data-i="${i}"><b>${esc(it.p.ident)}</b><span class="t">${it.p.cls === "airport" ? (APT_KIND[it.p.kind] || "Aéroport") : CLS[it.p.cls] || ""}</span><span class="r">${it.p.freq != null ? freq(it.p) : it.p.cls === "airport" && it.p.rwy_ft ? ft(it.p.rwy_ft) : ""}</span><span class="d">${it.d.toFixed(0)} NM</span></li>`
      : `<li data-i="${i}"><b>${esc(it.ident)}</b><span class="t">${[...it.lv].map((l) => LVL_SHORT[l]).join(", ")}</span><span class="r">${it.rnav ? "RNAV" : ""}</span><span class="d">${it.n} tr.</span></li>`
    ).join("") + (items.length > MAX ? `<li class="more">… et ${(items.length - MAX).toLocaleString("fr-FR")} autres, zoomer pour affiner</li>` : "");
    listEl.querySelectorAll("li[data-i]").forEach((li) => li.addEventListener("click", () => {
      const it = items[+li.dataset.i];
      if (listMode === "pts") openFix(it.p, it.ll, { fly: true });
      else openAirway(it.ident, { fit: true });
    }));
  }
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    listMode = b.dataset.mode;
    document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    sortEl.querySelector('option[value="dist"]').textContent = listMode === "pts" ? "Distance au centre" : "Tronçons visibles";
    renderList();
  }));
  sortEl.addEventListener("change", renderList);
  filtEl.addEventListener("input", scheduleList);
  map.on("moveend", scheduleList);
  map.on("idle", () => { if (tab === "list" && !listEl.children.length) scheduleList(); });

  const CLICKABLE = ["apt", "nav", "nav-lbl", "wpt", "awy-H", "awy-L", "awy-B", "awy-lbl-H", "awy-lbl-L", "awy-lbl-B"];
  function airspacesAt(point) {
    const b = 3;
    const layers = ["asp-fill", ...ASP_LINE_IDS].filter((l) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none");
    const seen = new Set(), out = [];
    for (const f of map.queryRenderedFeatures([[point.x - b, point.y - b], [point.x + b, point.y + b]], { layers })) {
      const p = f.properties, k = `${p.name}|${p.type}|${p.lower}|${p.upper}`;
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
    return out;
  }
  map.on("click", (e) => {
    const b = 6;
    const feats = map.queryRenderedFeatures([[e.point.x - b, e.point.y - b], [e.point.x + b, e.point.y + b]],
      { layers: CLICKABLE.filter((l) => map.getLayer(l)) });
    if (!feats.length) {
      selectAirway(null); selectPoint(null); if (popup) popup.remove();
      const asp = airspacesAt(e.point);
      if (asp.length) {
        if (sideOpen()) showAirspaceDetail(asp);
        else showPopup(e.lngLat, asp.slice(0, 4).map(aspHtml).join(""));
      }
      return;
    }
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
      if (sideOpen()) return openFix(f.properties, f.geometry.coordinates);
      selectPoint(f.geometry.coordinates);
      showPopup(f.geometry.coordinates, pts.slice(0, 3).map((x) => fixHtml(x.properties, x.geometry.coordinates)).join(""));
      selectAirway(null);
    } else {
      if (sideOpen()) return openAirway(legs[0].properties.ident);
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
      if (sideOpen()) showAirwayDetail(h.ident);
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
      const basic = { ident, cls, name, region, src: "", freq: null };
      if (sideOpen()) showFixDetail(basic, [lon, lat]);
      else showPopup([lon, lat], fixHtml(basic, [lon, lat]).replace('<div class="src"></div>', ""));
      // complète (fréquence, source…) une fois la tuile chargée
      map.once("idle", () => {
        // recherche dans la source (et pas seulement dans ce qui est dessiné : l'étiquette peut être masquée)
        const layer = cls === "airport" ? "airports" : "fixes";
        const f = map.querySourceFeatures(useGeojson ? layer : "nav", {
          ...(useGeojson ? {} : { sourceLayer: layer }), filter: ["==", ["get", "ident"], ident],
        }).find((x) => Math.abs(x.geometry.coordinates[0] - lon) < 0.01 && Math.abs(x.geometry.coordinates[1] - lat) < 0.01);
        if (!f) return;
        if (sideOpen()) showFixDetail(f.properties, [lon, lat]);
        else showPopup([lon, lat], fixHtml(f.properties, [lon, lat]));
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
    applyFilters();
    setSidebar(!isMobile() && savedSide !== "0", false);
    if (useGeojson) console.info("Mode GeoJSON (pas de PMTiles trouvées)");
  });
})();
