// Météo : METAR / TAF via l'API publique aviationweather.gov (NOAA, domaine public).
// Fonctions pures + petit cache ; l'affichage est géré par app.js.
(function () {
  const API = "https://aviationweather.gov/api/data";
  const cache = new Map(); // clé -> { t, data }
  const TTL = 5 * 60 * 1000;

  async function get(url) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < TTL) return hit.data;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    cache.set(url, { t: Date.now(), data });
    return data;
  }

  // Visibilité en milles terrestres (peut valoir "10+", "1/2", "P6SM"…)
  function visSm(v) {
    if (v == null) return null;
    if (typeof v === "number") return v;
    const s = String(v).replace("+", "").replace("P", "").replace("SM", "").trim();
    if (s.includes("/")) {
      const parts = s.split(" ");
      let tot = 0;
      for (const p of parts) {
        if (p.includes("/")) { const [a, b] = p.split("/").map(Number); tot += a / b; } else tot += Number(p);
      }
      return isNaN(tot) ? null : tot;
    }
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  // Plafond = base de la plus basse couche BKN/OVC/OVX, ou visibilité verticale
  function ceilingFt(m) {
    let c = null;
    for (const cl of m.clouds || []) {
      if (["BKN", "OVC", "OVX", "VV"].includes(cl.cover) && cl.base != null) c = c == null ? cl.base : Math.min(c, cl.base);
    }
    if (c == null && m.vertVis != null) c = m.vertVis;
    return c;
  }

  // Catégorie de vol FAA : VFR / MVFR / IFR / LIFR
  function flightCat(m) {
    if (m.fltCat) return m.fltCat;
    const v = visSm(m.visib), c = ceilingFt(m);
    if ((c != null && c < 500) || (v != null && v < 1)) return "LIFR";
    if ((c != null && c < 1000) || (v != null && v < 3)) return "IFR";
    if ((c != null && c <= 3000) || (v != null && v <= 5)) return "MVFR";
    if (v == null && c == null) return null;
    return "VFR";
  }

  function wind(m) {
    if (m.wspd == null) return null;
    if (m.wspd === 0) return "Calme";
    const dir = m.wdir === "VRB" ? "VRB" : String(m.wdir).padStart(3, "0") + "°";
    return `${dir} ${m.wspd} kt${m.wgst ? ` rafales ${m.wgst} kt` : ""}`;
  }

  async function metarsInBbox(w, s, e, n) {
    const url = `${API}/metar?bbox=${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)}&format=json`;
    return get(url);
  }
  async function metar(id) {
    const d = await get(`${API}/metar?ids=${encodeURIComponent(id)}&format=json`);
    return Array.isArray(d) ? d[0] || null : null;
  }
  async function taf(id) {
    const d = await get(`${API}/taf?ids=${encodeURIComponent(id)}&format=json`);
    return Array.isArray(d) ? d[0] || null : null;
  }

  window.NelixairWx = { metarsInBbox, metar, taf, flightCat, ceilingFt, visSm, wind,
    COLORS: { VFR: "#22a559", MVFR: "#2f6fe0", IFR: "#e0342f", LIFR: "#c235c2" } };
})();
