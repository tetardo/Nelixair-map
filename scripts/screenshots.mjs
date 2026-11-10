// Captures d'écran du site construit (données réelles), publiées avec le site dans dist/screenshots/.
// Le README les affiche depuis GitHub Pages : elles se mettent à jour à chaque déploiement.
//
//   node scripts/screenshots.mjs            (après scripts/build.sh puis npm run build ; nécessite playwright)
//
// Petit serveur statique intégré avec prise en charge des requêtes Range (indispensable à PMTiles).
import { createServer } from "node:http";
import { createReadStream, statSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("../dist/", import.meta.url).pathname;
const OUT = join(ROOT, "screenshots");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".geojson": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.endsWith("/")) path += "index.html";
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end(); return; }
  const headers = { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Accept-Ranges": "bytes" };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    const start = m[1] ? +m[1] : st.size - +m[2];
    const end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": st.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// [fichier, chemin, thème, onglet du panneau, filtres forcés, défilement du panneau en bas, actions]
// actions : side (panneau ouvert, défaut oui), click / hover [x, y] en px CSS, open (sections de fiche à ouvrir), demo (vol de démo SimBrief),
//   splash (garder l'écran d'accueil), steps (suite de { click | fill | scroll : sélecteur, wait : ms })
const WX = { hazards: true, pireps: true, sat: true, night: true };
const SHOTS = [
  ["accueil-france.png", "", "day", "filters"],
  // Panneau Aéroports : cartes au sol disponibles
  ["aeroports.png", "#map=6/46.6/2.5", "night", "airports"],
  // Plan de vol : vol de démo SimBrief (LFML -> LFPG) tracé, nav log dans le panneau
  ["plan-de-vol.png", "", "night", "flight", null, false, { demo: true }],
  ["carte.png", "#map=5.3/37.6/-99.5", "day", null],
  ["europe-nuit.png", "#map=7.2/48.9/2.4", "night", null],
  ["fiche-aeroport.png", "?sel=KSFO#map=10/37.62/-122.38", "day", "detail"],
  ["log-voie.png", "?sel=J80#map=5/39.5/-98", "night", "detail"],
  ["meteo.png", "#map=4.1/37.5/-97", "night", null, WX],
  ["fiche-soleil.png", "?sel=KDEN#map=8/39.86/-104.67", "day", "detail", WX, true, { open: ["site"] }],
  ["carte-aeroport-lfml.png", "?sel=LFML#map=14.4/43.4364/5.2153", "day", "detail"],
  ["carte-aeroport-lfml-nuit.png", "#map=16/43.4405/5.2120", "night", null],
  // Popup d'une piste : composantes de vent par QFU (panneau fermé, clic au centre sur la piste 13L/31R)
  ["piste-vent-lfml.png", "#map=15.5/43.4372/5.2204", "night", null, null, false, { side: false, click: [748, 476] }],
  // Bulle de survol d'une piste (dimensions + vent) et surbrillance
  // Menu Affichage ouvert, vue satellite Esri avec routes, sous le plan au sol
  ["satellite-lfml.png", "#map=14.6/43.4372/5.2204", "day", null, null, false,
    { side: false, view: { base: "sat", roads: true, buildings: false, landuse: false, places: true, relief: false }, click: null, menu: true }],
  ["survol-lfml.png", "#map=15.5/43.4372/5.2204", "day", null, null, false, { side: false, hover: [748, 476] }],
  // Écran d'accueil (code d'accès)
  ["accueil-code.png", "", "day", null, null, false, { splash: true }],
  // Aéroports : fiche ouverte à côté de la liste (panneau élargi)
  ["aeroport-volet.png", "", "day", "airports", null, false, { steps: [{ fill: ["#tab-airports input[type=search]", "LFML"] }, { click: "#tab-airports .apt-cards button" }, { wait: 4000 }] }],
  // Mes vols : carnet du pilote, vol ouvert dans le volet
  ["mes-vols.png", "", "day", "flights", null, false, { steps: [{ click: "#tab-flights .lb-list li:nth-child(2) .lb-row" }, { wait: 5000 }] }],
  // Plan de vol : contrôles (semi-circulaire, relief, carburant, nuit), espaces traversés, profil vertical
  ["controles-espaces.png", "", "night", "flight", null, false, { demo: true, steps: [
    { click: "#tab-flight button:has-text('Profil vertical')" }, { wait: 5000 }, { scroll: "#tab-flight .chk-list" }] }],
  // Relecture animée du vol de démo
  ["relecture.png", "", "day", "flight", null, false, { demo: true, steps: [{ click: "#tab-flight button:has-text('Rejouer')" }, { wait: 6000 }] }],
  // Trafic VATSIM / IVAO en direct (traînées et vecteurs vitesse)
  ["trafic.png", "#map=6/48.6/4", "night", null, { vatsim: true, ivao: true }],
  // Dégagements en route du vol de démo (filtres, catégorie météo, trous de couverture, cercles sur la carte)
  ["degagements.png", "", "night", "flight", null, false, { demo: true, steps: [
    { click: "#tab-flight button:has-text('Dégagements en route')" }, { wait: 5000 }, { scroll: "#tab-flight .altn-filters" }] }],
  // « Ce qu'il faut ici » : clic dans la région parisienne, espace et exigences à l'altitude choisie
  ["ce-qu-il-faut-ici.png", "#map=8.5/48.75/2.35", "day", "detail", null, false, { click: [900, 430] }],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const [name, path, theme, tab, filters, scroll, act = {}] of SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([t, f, side, open, view, splash]) => {
    if (!splash) localStorage.setItem("tropo-access", String(Date.now())); // passe l'écran d'accueil
    if (view) localStorage.setItem("nelixair-view", JSON.stringify(view));
    localStorage.setItem("nelixair-theme", t);
    localStorage.setItem("nelixair-side", side ? "1" : "0");
    if (f) localStorage.setItem("nelixair-filters", JSON.stringify(f));
    for (const id of open) localStorage.setItem("nelixair-sec-" + id, "1");
  }, [theme, filters || null, act.side !== false, act.open || [], act.view || null, !!act.splash]);
  const page = await ctx.newPage();
  try {
    await page.goto(base + path, { waitUntil: "load" });
    if (tab === "detail") await page.waitForSelector("#tab-detail h2", { timeout: 20000 });
    // laisse le temps aux tuiles, à la météo et aux détails de se charger
    await page.waitForTimeout(8000);
    if (tab && tab !== "detail") await page.evaluate((t) => { const b = document.querySelector(`.rail-btn[data-tab="${t}"]`); if (b && b.getAttribute("aria-pressed") !== "true") b.click(); }, tab);
    if (act.demo) { await page.click(".sb-demo"); await page.waitForTimeout(3000); }
    for (const st of act.steps || []) {
      if (st.click) await page.locator(st.click).first().click();
      if (st.fill) await page.locator(st.fill[0]).first().fill(st.fill[1]);
      if (st.scroll) await page.locator(st.scroll).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(st.wait || 600);
    }
    if (act.hover) { await page.mouse.move(act.hover[0] - 4, act.hover[1]); await page.mouse.move(...act.hover); await page.waitForTimeout(1500); }
    if (act.menu) { await page.click("#view-btn"); await page.waitForTimeout(800); }
    if (act.click) { await page.mouse.click(...act.click); await page.waitForTimeout(1500); }
    if (scroll) await page.evaluate(() => { const d = document.querySelector("#tab-detail"); d.scrollTop = d.scrollHeight; });
    await page.screenshot({ path: join(OUT, name) });
    console.log("ok", name);
  } catch (e) {
    failed++;
    console.error("échec", name, e.message);
  }
  await ctx.close();
}
await browser.close();
server.close();
process.exit(failed === SHOTS.length ? 1 : 0);
