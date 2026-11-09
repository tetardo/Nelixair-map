"""Outils géographiques : distances, densification grand cercle, antiméridien."""
from __future__ import annotations

import math

R_NM = 3440.065  # rayon terrestre moyen en milles nautiques


def haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_NM * math.asin(min(1.0, math.sqrt(a)))


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _to_vec(lat: float, lon: float):
    p, l = math.radians(lat), math.radians(lon)
    return (math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p))


def _from_vec(v):
    x, y, z = v
    return (math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x)))


def great_circle(lat1, lon1, lat2, lon2, step_nm: float = 60.0) -> list[tuple[float, float]]:
    """Points (lon, lat) le long du grand cercle, pas maxi `step_nm`. Extrémités incluses."""
    d = haversine_nm(lat1, lon1, lat2, lon2)
    n = max(1, math.ceil(d / step_nm))
    if n == 1:
        return [(lon1, lat1), (lon2, lat2)]
    a, b = _to_vec(lat1, lon1), _to_vec(lat2, lon2)
    omega = d / R_NM
    so = math.sin(omega)
    out = []
    for i in range(n + 1):
        t = i / n
        if so < 1e-12:
            lat, lon = lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t
        else:
            k1 = math.sin((1 - t) * omega) / so
            k2 = math.sin(t * omega) / so
            lat, lon = _from_vec(tuple(k1 * a[j] + k2 * b[j] for j in range(3)))
        out.append((lon, lat))
    out[0], out[-1] = (lon1, lat1), (lon2, lat2)
    return out


def split_antimeridian(coords: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Coupe une polyligne (lon, lat) qui traverse ±180° en plusieurs morceaux."""
    parts: list[list[tuple[float, float]]] = [[coords[0]]]
    for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
        if abs(lon2 - lon1) > 180:
            # traverse l'antiméridien : interpole la latitude au croisement
            lon2u = lon2 + 360 if lon2 < lon1 else lon2 - 360
            edge = 180 if lon2u > lon1 else -180
            t = (edge - lon1) / (lon2u - lon1)
            lat_x = lat1 + (lat2 - lat1) * t
            parts[-1].append((edge, lat_x))
            parts.append([(-edge, lat_x)])
        parts[-1].append((lon2, lat2))
    return [p for p in parts if len(p) >= 2]


def dms(value: float, is_lat: bool) -> str:
    """Format DMS lisible : N45°12'34.5\"."""
    hemi = ("N" if value >= 0 else "S") if is_lat else ("E" if value >= 0 else "W")
    v = abs(value)
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    width = 2 if is_lat else 3
    return f"{hemi}{d:0{width}d}°{m:02d}'{s:04.1f}\""
