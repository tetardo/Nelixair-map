// Liste + fiche côte à côte (Aéroports, Mes vols) : détection de la largeur et élargissement automatique du panneau.
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { resizeMap } from "../map/mapView";

const AUTO_W = 700, WIDE = 620;
const sideW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue("--side")) || 340;

/** `wide` : le panneau est assez large pour la liste et la fiche côte à côte (sinon la fiche passe par-dessus).
 *  Quand `open()` devient vrai, le panneau s'élargit tout seul, puis reprend sa largeur (sauf si elle a été changée à la main). */
export function useSplitPane(root: Ref<HTMLElement | null>, open: () => boolean) {
  const wide = ref(false);
  let ro: ResizeObserver | null = null;
  onMounted(() => { ro = new ResizeObserver(([e]) => (wide.value = e.contentRect.width >= WIDE)); if (root.value) ro.observe(root.value); });
  onBeforeUnmount(() => ro?.disconnect());
  let savedW = 0, autoW = 0;
  function autoWiden(on: boolean) {
    const el = document.documentElement;
    if (on) {
      const max = Math.min(820, window.innerWidth * 0.6);
      if (savedW || sideW() >= WIDE || max < WIDE) return; // déjà large, ou écran trop étroit
      savedW = sideW();
      autoW = Math.round(Math.min(AUTO_W, max));
      el.style.setProperty("--side", `${autoW}px`);
    } else if (savedW) {
      if (sideW() === autoW) el.style.setProperty("--side", `${savedW}px`);
      savedW = 0;
    } else return;
    setTimeout(resizeMap, 50);
  }
  watch(open, (on) => autoWiden(on));
  return { wide };
}
