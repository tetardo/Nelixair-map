// Survol carte → panneau : fait défiler le panneau jusqu'à la ligne allumée (classe .map-hot).
import { nextTick, onBeforeUnmount, watch } from "vue";
import { state } from "../store";

export function useMapHotScroll(root: () => HTMLElement | null | undefined) {
  const stop = watch(() => state.mapHover, async (k) => {
    if (!k) return;
    await nextTick();
    root()?.querySelector(".map-hot")?.scrollIntoView({ block: "nearest", behavior: state.anim ? "smooth" : "auto" });
  });
  onBeforeUnmount(stop);
}
