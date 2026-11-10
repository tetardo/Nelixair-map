// Captures d'écran du site construit (données réelles), publiées avec le site dans web/screenshots/.
// Le README les affiche depuis GitHub Pages : elles se mettent à jour à chaque déploiement.
//
//   node scripts/screenshots.mjs            (après scripts/build.sh ; nécessite playwright)
//
// Petit serveur statique intégré avec prise en charge des requêtes Range (indispensable à PMTiles).
import { createServer } from "node:http";
import { createReadStream, statSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("../web/", import.meta.url).pathname;
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

// [fichier, chemin, thème, onglet du panneau, filtres forcés, défilement du panneau en bas]
const WX = { hazards: true, pireps: true, sat: true, night: true };
const SHOTS = [
  ["carte.png", "#map=5.3/37.6/-99.5", "day", null],
  ["europe-nuit.png", "#map=7.2/48.9/2.4", "night", null],
  ["fiche-aeroport.png", "?sel=KSFO#map=10/37.62/-122.38", "day", "detail"],
  ["log-voie.png", "?sel=J80#map=5/39.5/-98", "night", "detail"],
  ["meteo.png", "#map=4.1/37.5/-97", "night", null, WX],
  ["fiche-soleil.png", "?sel=KDEN#map=8/39.86/-104.67", "day", "detail", WX, true],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const [name, path, theme, tab, filters, scroll] of SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([t, f]) => {
    localStorage.setItem("nelixair-theme", t);
    localStorage.setItem("nelixair-side", "1");
    if (f) localStorage.setItem("nelixair-filters", JSON.stringify(f));
  }, [theme, filters || null]);
  const page = await ctx.newPage();
  try {
    await page.goto(base + path, { waitUntil: "load" });
    if (tab === "detail") await page.waitForSelector("#tab-detail h2", { timeout: 20000 });
    // laisse le temps aux tuiles, à la météo et aux détails de se charger
    await page.waitForTimeout(8000);
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
