// Altitude du relief, lue dans les tuiles « terrarium » (AWS Terrain Tiles, les mêmes que l'ombrage du relief).
// Résolution de quelques centaines de mètres : relief indicatif, pas une altitude minimale de sécurité.
import type { LngLat } from "./format";

const URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const tiles = new Map<string, Promise<Uint8ClampedArray | null>>();

function tile(z: number, x: number, y: number): Promise<Uint8ClampedArray | null> {
  const k = `${z}/${x}/${y}`;
  let p = tiles.get(k);
  if (!p) {
    p = fetch(URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => createImageBitmap(b))
      .then((img) => {
        const c = new OffscreenCanvas(256, 256);
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, 256, 256).data;
      })
      .catch(() => null);
    tiles.set(k, p);
  }
  return p;
}

/** Altitude en pieds de chaque point (null si la tuile est indisponible). */
export async function elevationsFt(pts: LngLat[], z: number): Promise<(number | null)[]> {
  const n = 2 ** z;
  const px = pts.map(([lon, lat]) => {
    const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    const wx = (((lon + 180) / 360) % 1 + 1) % 1 * n * 256;
    const wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256;
    return [wx, wy];
  });
  return Promise.all(px.map(async ([wx, wy]) => {
    const tx = Math.floor(wx / 256), ty = Math.min(n - 1, Math.max(0, Math.floor(wy / 256)));
    const d = await tile(z, tx, ty);
    if (!d) return null;
    const i = (Math.floor(wy - ty * 256) * 256 + Math.floor(wx - tx * 256)) * 4;
    const m = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
    return Math.max(0, m) * 3.28084; // la mer reste à 0
  }));
}
