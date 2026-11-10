"""Graphe de roulage d'un aérodrome à partir des voies OSM (taxiway, taxilane, axe de piste).

Les voies OSM qui se croisent partagent leurs nœuds : deux sommets aux mêmes coordonnées sont un même nœud.
Sortie compacte (lue par le navigateur, calcul d'itinéraire côté client) :
  n      [[lon, lat], ...]                 nœuds
  e      [[i, j, refIdx, longueur_m, piste], ...]   arêtes (piste = 1 si axe de piste)
  refs   ["A", "A1", ...]                  noms des voies (index 0 = sans nom)
  stands [[ref, lon, lat, nœud], ...]      postes reliés au nœud de roulage le plus proche
  holds  [[ref, nœud], ...]                points d'attente situés sur le graphe
  rwys   {"13L": {"thr": [lon, lat], "hdg": cap, "entries": [[nœud, distance_au_seuil_m], ...]}}
Données OSM communautaires : itinéraire indicatif, à confronter à la clairance (ATC / VATSIM / IVAO).
"""
from __future__ import annotations

import math

R_M = 6371008.8


def _d(a, b) -> float:
    la = math.radians((a[1] + b[1]) / 2)
    return R_M * math.hypot(math.radians(b[0] - a[0]) * math.cos(la), math.radians(b[1] - a[1]))


def build_graph(elements: list[dict], runway_ends) -> dict | None:
    key = lambda p: (round(p[0], 7), round(p[1], 7))  # noqa: E731
    idx: dict[tuple, int] = {}
    nodes: list[list[float]] = []
    refs = [""]
    edges: list[list] = []
    rwy_lines = []

    def node(p) -> int:
        k = key(p)
        if k not in idx:
            idx[k] = len(nodes)
            nodes.append([k[0], k[1]])
        return idx[k]

    def ref_i(r: str) -> int:
        if r not in refs:
            refs.append(r)
        return refs.index(r)

    stands_raw, holds_raw = [], []
    for el in elements:
        tags = el.get("tags", {})
        aw = tags.get("aeroway", "")
        ref = (tags.get("ref") or "").strip()
        if el["type"] == "node":
            if aw in ("parking_position", "gate"):
                stands_raw.append((ref, (el["lon"], el["lat"])))
            elif aw == "holding_position":
                holds_raw.append((ref, (el["lon"], el["lat"])))
            continue
        if el["type"] != "way":
            continue
        pts = [(g["lon"], g["lat"]) for g in el.get("geometry", [])]
        if len(pts) < 2:
            continue
        closed = len(pts) >= 4 and pts[0] == pts[-1]
        if aw in ("taxiway", "taxilane") or (aw == "runway" and not (closed and tags.get("area") == "yes")):
            is_rwy = 1 if aw == "runway" else 0
            ri = ref_i(ref) if not is_rwy else 0
            ids = [node(p) for p in pts]
            for a, b, pa, pb in zip(ids, ids[1:], pts, pts[1:]):
                if a != b:
                    edges.append([a, b, ri, round(_d(pa, pb), 1), is_rwy])
            if is_rwy:
                rwy_lines.append((ref, pts, set(ids)))
        elif aw in ("parking_position", "gate"):
            c = pts[0] if not closed else (sum(p[0] for p in pts[:-1]) / (len(pts) - 1), sum(p[1] for p in pts[:-1]) / (len(pts) - 1))
            stands_raw.append((ref, c))
        elif aw == "holding_position":
            holds_raw.append((ref, pts[len(pts) // 2]))
    if not edges:
        return None

    def project(p, a, b):
        """Projection de p sur le segment [a, b] en mètres locaux -> (distance, t)."""
        la = math.radians(p[1])
        kx, ky = 111320.0 * math.cos(la), 110540.0
        ax, ay, bx, by = (a[0] - p[0]) * kx, (a[1] - p[1]) * ky, (b[0] - p[0]) * kx, (b[1] - p[1]) * ky
        L2 = (bx - ax) ** 2 + (by - ay) ** 2
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * (bx - ax) + ay * (by - ay)) / L2))
        return math.hypot(ax + t * (bx - ax), ay + t * (by - ay)), t

    def attach(p, max_m, taxi_only=True, skip=None):
        """Relie p au point le plus proche d'une arête (coupée en deux si besoin) ; renvoie le nœud ou None."""
        best = None
        for k, e in enumerate(edges):
            if (taxi_only and e[4]) or (skip is not None and skip in e[:2]):
                continue
            d, t = project(p, nodes[e[0]], nodes[e[1]])
            if d <= max_m and (best is None or d < best[0]):
                best = (d, k, t)
        if best is None:
            return None
        d, k, t = best
        e = edges[k]
        if t < 0.02 or t > 0.98 or e[3] < 2:
            return e[0] if t < 0.5 else e[1]
        a, b = nodes[e[0]], nodes[e[1]]
        q = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        m = node(q)
        edges[k] = [e[0], m, e[2], max(0.1, round(e[3] * t, 1)), e[4]]
        edges.append([m, e[1], e[2], max(0.1, round(e[3] * (1 - t), 1)), e[4]])
        if e[4]:
            for _r, _pts, ids in rwy_lines:
                if e[0] in ids:
                    ids.add(m)
        return m

    # OSM imparfait : extrémités de voie « en l'air » à quelques mètres d'une autre voie -> raccordées
    deg: dict[int, int] = {}
    for e in edges:
        for i in e[:2]:
            deg[i] = deg.get(i, 0) + 1
    for i in [i for i, k in deg.items() if k == 1]:
        m = attach(nodes[i], 12.0, taxi_only=False, skip=i)
        if m is not None and m != i:
            edges.append([i, m, 0, max(0.1, round(_d(nodes[i], nodes[m]), 1)), 0])

    stands = []
    for ref, p in stands_raw:
        m = attach(p, 250.0)
        if m is not None:
            stands.append([ref, round(p[0], 7), round(p[1], 7), m])
    holds = []
    for ref, p in holds_raw:
        m = attach(p, 30.0)
        if m is not None:
            holds.append([ref, m])

    taxi_nodes = sorted({i for e in edges if not e[4] for i in e[:2]})
    # Entrées de piste : nœuds de l'axe partagés avec une voie de circulation
    rwys = {}
    taxi_set = set(taxi_nodes)
    for ref, pts, ids in rwy_lines:
        entries = sorted(ids & taxi_set)
        for des, thr, hdg in runway_ends(ref, pts):
            rwys[des] = {"thr": [round(thr[0], 7), round(thr[1], 7)], "hdg": round(hdg, 1),
                         "entries": sorted(([i, round(_d(thr, nodes[i]))] for i in entries), key=lambda x: x[1])}
    return {"n": nodes, "e": edges, "refs": refs, "stands": stands, "holds": holds, "rwys": rwys}
