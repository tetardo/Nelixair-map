// Géodésie simple (log de voie, distances de la liste).
import type { LngLat } from "./format";

const RAD = Math.PI / 180;

export function distNm(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Point atteint depuis `a` au cap vrai `brg` sur `nm` milles nautiques (sphère). */
export function destination(a: LngLat, brg: number, nm: number): LngLat {
  const d = nm / 3440.065, t = brg * RAD, f1 = a[1] * RAD, l1 = a[0] * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [((l2 / RAD + 540) % 360) - 180, f2 / RAD];
}
