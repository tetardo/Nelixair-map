// Météo : METAR / TAF de la NOAA (domaine public).
// L'API aviationweather.gov refuse les appels navigateur (pas de CORS) : on lit un relais
// statique (pipeline/wx.py, publié toutes les 10 min par .github/workflows/wx.yml).
(function () {
  const CFG = window.NELIXAIR_CONFIG || {};
  const TTL = 5 * 60 * 1000;
  const cache = new Map(); // url -> { t, p }

  function load(url) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < TTL) return hit.p;
    const p = fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    cache.set(url, { t: Date.now(), p });
    p.catch(() => cache.delete(url));
    return p;
  }

  // metars.json -> { time, list, byId }
  let metarsP = null, metarsT = 0;
  function metars() {
    if (!metarsP || Date.now() - metarsT > TTL) {
      metarsT = Date.now();
      metarsP = load(CFG.wxMetars).then((j) => {
        const list = j.d.map((r) => {
          const o = {};
          j.f.forEach((k, i) => (o[k] = r[i]));
          o.clouds = (o.clouds || []).map(([cover, base]) => ({ cover, base }));
          return o;
        });
        return { time: j.t, list, byId: new Map(list.map((m) => [m.icaoId, m])) };
      });
      metarsP.catch(() => (metarsP = null));
    }
    return metarsP;
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
    const { list } = await metars();
    return list.filter((m) => m.lat >= s && m.lat <= n && m.lon >= w && m.lon <= e);
  }
  async function metar(id) {
    return (await metars()).byId.get(id) || null;
  }
  async function taf(id) {
    const j = await load(CFG.wxTafs);
    return j.d[id] ? { rawTAF: j.d[id] } : null;
  }
  // Âge des données en minutes (null si inconnu)
  async function age() {
    const { time } = await metars();
    const t = Date.parse(time);
    return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000));
  }

  window.NelixairWx = { metarsInBbox, metar, taf, age, flightCat, ceilingFt, visSm, wind,
    COLORS: { VFR: "#22a559", MVFR: "#2f6fe0", IFR: "#e0342f", LIFR: "#c235c2" } };
})();
