// Symbologie inspirée des cartes en route OACI/FAA, dessinée sur canvas (pas d'assets externes).
(function () {
  const PR = 2; // pixel ratio des icônes
  const C = {
    ink: "#1d2433", navaid: "#1f5fa8", ndb: "#8a3d74", paper: "#ffffff",
  };

  function canvas(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size * PR;
    const ctx = c.getContext("2d");
    ctx.scale(PR, PR);
    ctx.lineJoin = "round";
    return [c, ctx];
  }

  function hexagon(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      ctx[i ? "lineTo" : "moveTo"](cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
  }

  const draw = {
    waypoint(ctx, s) {          // triangle ouvert (fix RNAV / intersection)
      ctx.strokeStyle = C.ink; ctx.fillStyle = C.paper; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(s / 2, 2); ctx.lineTo(s - 2, s - 3); ctx.lineTo(2, s - 3); ctx.closePath();
      ctx.fill(); ctx.stroke();
    },
    vor(ctx, s) {               // hexagone + point central
      ctx.strokeStyle = C.navaid; ctx.fillStyle = C.paper; ctx.lineWidth = 1.6;
      hexagon(ctx, s / 2, s / 2, s / 2 - 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.navaid; ctx.beginPath(); ctx.arc(s / 2, s / 2, 1.6, 0, 7); ctx.fill();
    },
    vordme(ctx, s) {            // hexagone inscrit dans un carré
      ctx.strokeStyle = C.navaid; ctx.fillStyle = C.paper; ctx.lineWidth = 1.4;
      ctx.fillRect(2, 2, s - 4, s - 4); ctx.strokeRect(2, 2, s - 4, s - 4);
      hexagon(ctx, s / 2, s / 2, s / 2 - 5); ctx.stroke();
      ctx.fillStyle = C.navaid; ctx.beginPath(); ctx.arc(s / 2, s / 2, 1.4, 0, 7); ctx.fill();
    },
    vortac(ctx, s) {            // hexagone + trois blocs
      const r = s / 2 - 6, cx = s / 2, cy = s / 2;
      ctx.fillStyle = C.navaid;
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + k * 2 * Math.PI / 3;
        ctx.save(); ctx.translate(cx + Math.cos(a) * (r + 2.5), cy + Math.sin(a) * (r + 2.5)); ctx.rotate(a + Math.PI / 2);
        ctx.fillRect(-3.5, -2, 7, 4); ctx.restore();
      }
      ctx.strokeStyle = C.navaid; ctx.fillStyle = C.paper; ctx.lineWidth = 1.4;
      hexagon(ctx, cx, cy, r); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.navaid; ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, 7); ctx.fill();
    },
    dme(ctx, s) {               // carré
      ctx.strokeStyle = C.navaid; ctx.fillStyle = C.paper; ctx.lineWidth = 1.6;
      ctx.fillRect(4, 4, s - 8, s - 8); ctx.strokeRect(4, 4, s - 8, s - 8);
      ctx.fillStyle = C.navaid; ctx.beginPath(); ctx.arc(s / 2, s / 2, 1.4, 0, 7); ctx.fill();
    },
    ndb(ctx, s) {               // cercles pointillés concentriques
      const cx = s / 2;
      ctx.fillStyle = C.ndb;
      for (const [r, n, d] of [[s / 2 - 2, 18, 1.1], [s / 2 - 5.5, 12, 1.0]]) {
        for (let i = 0; i < n; i++) {
          const a = 2 * Math.PI * i / n;
          ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cx + r * Math.sin(a), d, 0, 7); ctx.fill();
        }
      }
      ctx.beginPath(); ctx.arc(cx, cx, 2, 0, 7); ctx.fill();
    },
  };
  // TACAN : trois blocs + hexagone pointillé (distinct du VORTAC)
  draw.tacan = function (ctx, s) {
    const r = s / 2 - 6, cx = s / 2;
    ctx.fillStyle = C.navaid;
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + k * 2 * Math.PI / 3;
      ctx.save(); ctx.translate(cx + Math.cos(a) * (r + 2.5), cx + Math.sin(a) * (r + 2.5)); ctx.rotate(a + Math.PI / 2);
      ctx.fillRect(-3.5, -2, 7, 4); ctx.restore();
    }
    ctx.strokeStyle = C.navaid; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    hexagon(ctx, cx, cx, r); ctx.stroke();
  };

  // Cartouche étirable pour les idents de voies (icon-text-fit)
  function labelBox(map, name, stroke, fill) {
    const w = 16, h = 16;
    const [c, ctx] = canvas(w);
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(1, 1, w - 2, h - 2, 2); else ctx.rect(1, 1, w - 2, h - 2);
    ctx.fill(); ctx.stroke();
    const img = ctx.getImageData(0, 0, w * PR, h * PR);
    map.addImage(name, img, {
      pixelRatio: PR,
      stretchX: [[4 * PR, 12 * PR]], stretchY: [[4 * PR, 12 * PR]],
      content: [3 * PR, 3 * PR, 13 * PR, 13 * PR],
    });
  }

  window.NelixairSymbols = {
    colors: C,
    register(map) {
      const sizes = { waypoint: 14, vor: 20, vordme: 20, vortac: 26, tacan: 26, dme: 16, ndb: 22 };
      for (const [k, s] of Object.entries(sizes)) {
        if (map.hasImage("sym-" + k)) continue;
        const [c, ctx] = canvas(s);
        draw[k](ctx, s);
        map.addImage("sym-" + k, ctx.getImageData(0, 0, s * PR, s * PR), { pixelRatio: PR });
      }
      if (!map.hasImage("box-H")) labelBox(map, "box-H", "#24365f", "#ffffff");
      if (!map.hasImage("box-L")) labelBox(map, "box-L", "#2f6b4f", "#ffffff");
      if (!map.hasImage("box-nav")) labelBox(map, "box-nav", "#1f5fa8", "#ffffff");
      if (!map.hasImage("box-ndb")) labelBox(map, "box-ndb", "#8a3d74", "#ffffff");
    },
  };
})();
