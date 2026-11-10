// Exigences simplifiées par classe d'espace et type de zone (SERA / France). Aide-mémoire, pas une référence réglementaire.
export type Need = { label: string; tone: "stop" | "warn" | "info" };
export function needsFor(cls: string, type: string, vfr: boolean, altFt: number): { note: string; needs: Need[] } {
  const n: Need[] = [];
  let note = "";
  const c = cls.toUpperCase();
  if (type === "P") return { note: "Zone interdite : pénétration interdite.", needs: [{ label: "Interdit", tone: "stop" }] };
  if (type === "R") { note = "Zone réglementée : pénétration soumise aux conditions publiées (horaires, autorisation)."; n.push({ label: "Vérifier activation", tone: "stop" }); }
  if (type === "D") { note = "Zone dangereuse : activité possible, pénétration non interdite mais à éviter si active."; n.push({ label: "Vérifier activation", tone: "warn" }); }
  if (type === "TRA" || type === "TSA") { note = "Zone réservée temporairement : interdite quand elle est active."; n.push({ label: "Vérifier activation", tone: "stop" }); }
  if (type === "RMZ") { note = "Zone à radio obligatoire."; n.push({ label: "Contact radio", tone: "warn" }); }
  if (type === "TMZ") { note = "Zone à transpondeur obligatoire."; n.push({ label: "Transpondeur mode S", tone: "warn" }); }
  if (c === "A") { note ||= "IFR seulement. VFR interdit sauf dérogation."; if (vfr) n.push({ label: "VFR interdit", tone: "stop" }); }
  if (["A", "B", "C", "D"].includes(c) || (c === "E" && !vfr)) n.push({ label: "Clairance obligatoire", tone: "stop" });
  if (["A", "B", "C", "D"].includes(c) || (c === "E" && !vfr)) n.push({ label: "Contact radio", tone: "warn" });
  if (["A", "B", "C"].includes(c)) n.push({ label: "Transpondeur", tone: "warn" });
  if (["C", "D", "E", "F", "G"].includes(c) && altFt < 10000) n.push({ label: "Vitesse ≤ 250 kt sous FL100", tone: "info" });
  if (!note && c) note = ["F", "G"].includes(c) ? "Espace non contrôlé : information de vol disponible." : `Espace contrôlé de classe ${c}.`;
  const seen = new Set<string>();
  return { note, needs: n.filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true))) };
}
