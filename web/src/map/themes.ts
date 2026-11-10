// Thèmes jour / nuit de la carte (fond, couches aéro, carte d'aéroport).

export interface GroundTheme {
  boundary: string; apron: string; apronLine: string; building: string; terminal: string;
  taxi: string; taxiEdge: string; taxiCenter: string; runway: string; runwayEdge: string; rwyAxis: string; stopway: string;
  holding: string; stand: string; standText: string; text: string; halo: string;
  twyLblBg: string; twyLblLine: string; twyLblText: string; rwyLblBg: string; rwyLblText: string;
}

export interface Theme {
  bg: string; water: string; waterLine: string; land: number; border: string;
  label: string; waterLabel: string; halo: string; road: string; roadCase: string; bldg: string; landuse: string;
  high: string; low: string; both: string; sel: string;
  wpt: string; navaid: string; ndb: string; boxFill: string; textHalo: string;
  aptIfr: string; aptVfr: string; aspCtl: string; aspSpecial: string; aspFir: string; aspOther: string;
  mora: string; moraLine: string;
  g: GroundTheme;
}

export type ThemeName = "day" | "night";

export const THEMES: Record<ThemeName, Theme> = {
  day: {
    bg: "#eceee9", water: "#cfe0e8", waterLine: "#b5cfda", land: 0.18, border: "#9aa3ad",
    label: "#7d8590", waterLabel: "#6a8ea0", halo: "#eceee9",
    road: "#ffffff", roadCase: "#d3d7dd", bldg: "#d9dbe0", landuse: "#dfe6d6",
    high: "#5b4bc4", low: "#13897b", both: "#2f6fa6", sel: "#e8590c",
    wpt: "#4b5563", navaid: "#1764c9", ndb: "#9b2f86", boxFill: "#ffffff", textHalo: "#ffffff",
    aptIfr: "#1764c9", aptVfr: "#9b2f86", aspCtl: "#2b74c7", aspSpecial: "#c2265a", aspFir: "#5b6472", aspOther: "#8a6fc0",
    mora: "#9a6b2f", moraLine: "rgba(154,107,47,.25)",
    g: {
      boundary: "#f6f4ee", apron: "#d6dae1", apronLine: "#b9bfca", building: "#9aa2b0", terminal: "#6f788a",
      taxi: "#b3bac6", taxiEdge: "#98a0ae", taxiCenter: "#d9a400", runway: "#3a4252", runwayEdge: "#232936", rwyAxis: "#ffffff",
      stopway: "#8d95a4", holding: "#d7262b", stand: "#1764c9", standText: "#0f3f86", text: "#2b3240", halo: "#ffffff",
      twyLblBg: "#ffd21f", twyLblLine: "#1b1f27", twyLblText: "#111111", rwyLblBg: "#1b1f27", rwyLblText: "#ffffff",
    },
  },
  night: {
    bg: "#0e1626", water: "#0a1220", waterLine: "#14233a", land: 0.08, border: "#33435f",
    label: "#6f7f9e", waterLabel: "#3f5878", halo: "#0e1626",
    road: "#26334a", roadCase: "#1a2538", bldg: "#1c2638", landuse: "#132033",
    high: "#9d8cff", low: "#2fc7b1", both: "#5fb0ea", sel: "#ff8a3d",
    wpt: "#c3cde0", navaid: "#5aa8ff", ndb: "#e07ad0", boxFill: "#0e1626", textHalo: "#0e1626",
    aptIfr: "#5aa8ff", aptVfr: "#e07ad0", aspCtl: "#4f9bf0", aspSpecial: "#ff5c8a", aspFir: "#7d8aa5", aspOther: "#a993e6",
    mora: "#d1a865", moraLine: "rgba(209,168,101,.22)",
    g: {
      boundary: "#121c2e", apron: "#1d283b", apronLine: "#2b3953", building: "#2c3850", terminal: "#3b4966",
      taxi: "#34415a", taxiEdge: "#45536f", taxiCenter: "#c9a227", runway: "#8792a8", runwayEdge: "#a7b1c4", rwyAxis: "#0e1626",
      stopway: "#56627a", holding: "#ff5c5c", stand: "#5aa8ff", standText: "#a8cbff", text: "#c7d0e0", halo: "#0e1626",
      twyLblBg: "#e3bb1c", twyLblLine: "#0e1626", twyLblText: "#0b0f18", rwyLblBg: "#e6ebf5", rwyLblText: "#0e1626",
    },
  },
};
