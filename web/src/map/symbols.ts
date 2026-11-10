// Symbologie de carte en route dessinée sur canvas (pas d'assets externes).
// Une série d'icônes par thème : "<theme>-sym-<classe>", "<theme>-box-<type>", "<theme>-apt-<kind>-<ifr|vfr>".
import type { Map as MlMap } from "maplibre-gl";
import type { Theme } from "./themes";

type Ctx = CanvasRenderingContext2D;
const PR = 2; // pixel ratio des icônes

function canvas(size: number): Ctx {
  const c = document.createElement("canvas");
  c.width = c.height = size * PR;
  const ctx = c.getContext("2d")!;
  ctx.scale(PR, PR);
  ctx.lineJoin = "round";
  return ctx;
}

function hexagon(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i;
    ctx[i ? "lineTo" : "moveTo"](cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}

function tacanBlocks(ctx: Ctx, cx: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + k * 2 * Math.PI / 3;
    ctx.save(); ctx.translate(cx + Math.cos(a) * (r + 2.5), cx + Math.sin(a) * (r + 2.5)); ctx.rotate(a + Math.PI / 2);
    ctx.fillRect(-3.5, -2, 7, 4); ctx.restore();
  }
}

const draw: Record<string, (ctx: Ctx, s: number, T: Theme) => void> = {
  waypoint(ctx, s, T) {       // cercle ouvert
    ctx.strokeStyle = T.wpt; ctx.fillStyle = T.boxFill; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2.5, 0, 7); ctx.fill(); ctx.stroke();
  },
  vor(ctx, s, T) {            // hexagone + point central
    ctx.strokeStyle = T.navaid; ctx.fillStyle = T.boxFill; ctx.lineWidth = 1.6;
    hexagon(ctx, s / 2, s / 2, s / 2 - 3); ctx.fill(); ctx.stroke();
    dot(ctx, s / 2, s / 2, 1.6, T.navaid);
  },
  vordme(ctx, s, T) {         // hexagone inscrit dans un carré
    ctx.strokeStyle = T.navaid; ctx.fillStyle = T.boxFill; ctx.lineWidth = 1.4;
    ctx.fillRect(2, 2, s - 4, s - 4); ctx.strokeRect(2, 2, s - 4, s - 4);
    hexagon(ctx, s / 2, s / 2, s / 2 - 5); ctx.stroke();
    dot(ctx, s / 2, s / 2, 1.4, T.navaid);
  },
  vortac(ctx, s, T) {         // hexagone + trois blocs
    const r = s / 2 - 6, cx = s / 2;
    tacanBlocks(ctx, cx, r, T.navaid);
    ctx.strokeStyle = T.navaid; ctx.fillStyle = T.boxFill; ctx.lineWidth = 1.4;
    hexagon(ctx, cx, cx, r); ctx.fill(); ctx.stroke();
    dot(ctx, cx, cx, 1.4, T.navaid);
  },
  tacan(ctx, s, T) {          // trois blocs + hexagone pointillé
    const r = s / 2 - 6, cx = s / 2;
    tacanBlocks(ctx, cx, r, T.navaid);
    ctx.strokeStyle = T.navaid; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    hexagon(ctx, cx, cx, r); ctx.stroke();
  },
  dme(ctx, s, T) {            // carré
    ctx.strokeStyle = T.navaid; ctx.fillStyle = T.boxFill; ctx.lineWidth = 1.6;
    ctx.fillRect(4, 4, s - 8, s - 8); ctx.strokeRect(4, 4, s - 8, s - 8);
    dot(ctx, s / 2, s / 2, 1.4, T.navaid);
  },
  ndb(ctx, s, T) {            // cercles pointillés concentriques
    const cx = s / 2;
    for (const [r, n, d] of [[s / 2 - 2, 18, 1.1], [s / 2 - 5.5, 12, 1.0]]) {
      for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n;
        dot(ctx, cx + r * Math.cos(a), cx + r * Math.sin(a), d, T.ndb);
      }
    }
    dot(ctx, cx, cx, 2, T.ndb);
  },
};

// Aéroports : couleur IFR (bleu) / VFR (magenta), forme selon la catégorie
type AptDraw = (ctx: Ctx, s: number, c: string, bg: string) => void;
const APT: Record<string, [number, AptDraw]> = {
  large: [18, (ctx, s, c, bg) => {
    dot(ctx, s / 2, s / 2, s / 2 - 2, c);
    ctx.strokeStyle = bg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(5, s - 5); ctx.lineTo(s - 5, 5); ctx.stroke();
  }],
  medium: [18, (ctx, s, c, bg) => {
    ctx.strokeStyle = c; ctx.lineWidth = 2.2; ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, 5.5, 0, 7); ctx.fill(); ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(s / 2 + Math.cos(a) * 6.5, s / 2 + Math.sin(a) * 6.5);
      ctx.lineTo(s / 2 + Math.cos(a) * 8.5, s / 2 + Math.sin(a) * 8.5); ctx.stroke();
    }
  }],
  small: [12, (ctx, s, c, bg) => {
    ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, 7); ctx.fill(); ctx.stroke();
  }],
  heliport: [16, (ctx, s, c, bg) => {
    ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 1.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.8; ctx.beginPath();
    ctx.moveTo(5.5, 4.5); ctx.lineTo(5.5, s - 4.5); ctx.moveTo(s - 5.5, 4.5); ctx.lineTo(s - 5.5, s - 4.5);
    ctx.moveTo(5.5, s / 2); ctx.lineTo(s - 5.5, s / 2); ctx.stroke();
  }],
  seaplane: [16, (ctx, s, c, bg) => {
    ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 1.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, s / 2 + 1);
    ctx.quadraticCurveTo(6, s / 2 - 2, 8, s / 2 + 1); ctx.quadraticCurveTo(10, s / 2 + 4, 12, s / 2 + 1); ctx.stroke();
  }],
};

// Cartouche étirable pour les idents (icon-text-fit)
function labelBox(map: MlMap, name: string, stroke: string, fill: string, radius = 3) {
  const w = 16;
  const ctx = canvas(w);
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(1, 1, w - 2, w - 2, radius); else ctx.rect(1, 1, w - 2, w - 2);
  ctx.fill(); ctx.stroke();
  map.addImage(name, ctx.getImageData(0, 0, w * PR, w * PR), {
    pixelRatio: PR,
    stretchX: [[4 * PR, 12 * PR]], stretchY: [[4 * PR, 12 * PR]],
    content: [3 * PR, 3 * PR, 13 * PR, 13 * PR],
  });
}

const SIZES: Record<string, number> = { waypoint: 12, vor: 20, vordme: 20, vortac: 26, tacan: 26, dme: 16, ndb: 22 };

/** Enregistre les icônes du thème (une seule fois par thème). */
export function registerSymbols(map: MlMap, theme: string, T: Theme): void {
  if (map.hasImage(`${theme}-box-nav`)) return;
  for (const [k, s] of Object.entries(SIZES)) {
    const ctx = canvas(s);
    draw[k](ctx, s, T);
    map.addImage(`${theme}-sym-${k}`, ctx.getImageData(0, 0, s * PR, s * PR), { pixelRatio: PR });
  }
  for (const [kind, [sz, fn]] of Object.entries(APT)) {
    for (const [rule, color] of [["ifr", T.aptIfr], ["vfr", T.aptVfr]]) {
      const ctx = canvas(sz);
      fn(ctx, sz, color, T.boxFill);
      map.addImage(`${theme}-apt-${kind}-${rule}`, ctx.getImageData(0, 0, sz * PR, sz * PR), { pixelRatio: PR });
    }
  }
  labelBox(map, `${theme}-box-H`, T.high, T.boxFill);
  labelBox(map, `${theme}-box-L`, T.low, T.boxFill);
  labelBox(map, `${theme}-box-B`, T.both, T.boxFill);
  labelBox(map, `${theme}-box-nav`, T.navaid, T.boxFill);
  labelBox(map, `${theme}-box-ndb`, T.ndb, T.boxFill);
  // Carte d'aéroport : cartouches taxiway (fond jaune, convention des cartes sol), piste, poste de stationnement
  labelBox(map, `${theme}-box-twy`, T.g.twyLblLine, T.g.twyLblBg, 2);
  labelBox(map, `${theme}-box-rwy`, T.g.rwyLblBg, T.g.rwyLblBg, 2);
}
