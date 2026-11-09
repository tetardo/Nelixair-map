// Symbologie de carte en route dessinée sur canvas (pas d'assets externes).
// Une série d'icônes par thème : "<theme>-sym-<classe>", "<theme>-box-<type>".
(function () {
  const PR = 2; // pixel ratio des icônes

  function canvas(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size * PR;
    const ctx = c.getContext("2d");
    ctx.scale(PR, PR);
    ctx.lineJoin = "round";
    return ctx;
  }

  function hexagon(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      ctx[i ? "lineTo" : "moveTo"](cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
  }

  function dot(ctx, x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }

  function tacanBlocks(ctx, cx, r, color) {
    ctx.fillStyle = color;
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + k * 2 * Math.PI / 3;
      ctx.save(); ctx.translate(cx + Math.cos(a) * (r + 2.5), cx + Math.sin(a) * (r + 2.5)); ctx.rotate(a + Math.PI / 2);
      ctx.fillRect(-3.5, -2, 7, 4); ctx.restore();
    }
  }

  const draw = {
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

  // Cartouche étirable pour les idents (icon-text-fit)
  function labelBox(map, name, stroke, fill) {
    const w = 16;
    const ctx = canvas(w);
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(1, 1, w - 2, w - 2, 3); else ctx.rect(1, 1, w - 2, w - 2);
    ctx.fill(); ctx.stroke();
    map.addImage(name, ctx.getImageData(0, 0, w * PR, w * PR), {
      pixelRatio: PR,
      stretchX: [[4 * PR, 12 * PR]], stretchY: [[4 * PR, 12 * PR]],
      content: [3 * PR, 3 * PR, 13 * PR, 13 * PR],
    });
  }

  const SIZES = { waypoint: 12, vor: 20, vordme: 20, vortac: 26, tacan: 26, dme: 16, ndb: 22 };

  window.NelixairSymbols = {
    register(map, theme, T) {
      if (map.hasImage(`${theme}-box-nav`)) return;
      for (const [k, s] of Object.entries(SIZES)) {
        const ctx = canvas(s);
        draw[k](ctx, s, T);
        map.addImage(`${theme}-sym-${k}`, ctx.getImageData(0, 0, s * PR, s * PR), { pixelRatio: PR });
      }
      labelBox(map, `${theme}-box-H`, T.high, T.boxFill);
      labelBox(map, `${theme}-box-L`, T.low, T.boxFill);
      labelBox(map, `${theme}-box-B`, T.both, T.boxFill);
      labelBox(map, `${theme}-box-nav`, T.navaid, T.boxFill);
      labelBox(map, `${theme}-box-ndb`, T.ndb, T.boxFill);
    },
  };
})();
