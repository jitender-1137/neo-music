/**
 * State machine for the mobile player sheet (the mini-player and the full player are two states of
 * one persistent surface). Pure reducer: every gesture/tap/route event goes through `transition`,
 * so a cancelled or interrupted gesture can never leave the sheet half-open.
 *
 *   collapsed ──drag up──▶ expanding ──release(commit)──▶ expanded
 *       ▲          │                └─release(cancel)/cancel──▶ collapsed
 *       │          └──────────────tap / open────────────────────▶ expanded
 *   expanded ──drag down──▶ minimizing ──release(commit)──▶ collapsed
 *                                     └─release(cancel)/cancel──▶ expanded
 *   expanded: panel open/close/switch (Up next · Lyrics · Related) without leaving "expanded".
 *     The panel rests at two heights: "half" (peek at the list, song view still visible above) and
 *     "full". Swipe up on the song view → half; up again → full; down steps back full → half → closed.
 *   any state ──close / route change / track gone──▶ collapsed (panel closed)
 */
export type SheetMode = "collapsed" | "expanding" | "expanded" | "minimizing";
export type PanelTab = "next" | "lyrics" | "related";
export type Detent = "half" | "full";
export const PANEL_TABS: readonly PanelTab[] = ["next", "lyrics", "related"];

export interface SheetState {
  mode: SheetMode;
  /** Secondary sheet over the expanded player; null = the song view. */
  panel: PanelTab | null;
  /** Height of the open panel (ignored while `panel` is null). */
  detent: Detent;
}

export type SheetEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "dragStart" }
  | { type: "dragEnd"; commit: boolean }
  | { type: "dragCancel" }
  | { type: "openPanel"; tab: PanelTab; detent?: Detent }
  | { type: "panelUp" }
  | { type: "panelDown" }
  | { type: "closePanel" }
  | { type: "swipePanel"; dir: 1 | -1 };

export const initialSheet: SheetState = { mode: "collapsed", panel: null, detent: "full" };
const expanded = (panel: PanelTab | null = null, detent: Detent = "full"): SheetState => ({ mode: "expanded", panel, detent });

export function transition(s: SheetState, e: SheetEvent): SheetState {
  switch (e.type) {
    case "open":
      return s.mode === "expanded" ? s : expanded();
    case "close":
      return s.mode === "collapsed" && !s.panel ? s : initialSheet;
    case "toggle":
      return s.mode === "collapsed" ? expanded() : initialSheet;
    case "dragStart":
      if (s.mode === "collapsed") return { ...initialSheet, mode: "expanding" };
      if (s.mode === "expanded" && !s.panel) return { ...s, mode: "minimizing" };
      return s; // already dragging, or a panel is open (the panel handles its own drag)
    case "dragEnd":
      if (s.mode === "expanding") return e.commit ? expanded() : initialSheet;
      if (s.mode === "minimizing") return e.commit ? initialSheet : expanded();
      return s;
    case "dragCancel":
      if (s.mode === "expanding") return initialSheet;
      if (s.mode === "minimizing") return expanded();
      return s;
    case "openPanel":
      return s.mode === "expanded" ? expanded(e.tab, e.detent ?? "full") : s;
    case "panelUp":
      if (s.mode !== "expanded") return s;
      if (!s.panel) return expanded("next", "half");
      return s.detent === "half" ? { ...s, detent: "full" } : s;
    case "panelDown":
      if (!s.panel) return s;
      return s.detent === "full" ? { ...s, detent: "half" } : { ...s, panel: null, detent: "full" };
    case "closePanel":
      return s.panel ? { ...s, panel: null, detent: "full" } : s;
    case "swipePanel": {
      if (!s.panel) return s;
      const i = PANEL_TABS.indexOf(s.panel) + e.dir;
      return i < 0 || i >= PANEL_TABS.length ? s : { ...s, panel: PANEL_TABS[i]! };
    }
  }
}

export const isOpen = (s: SheetState) => s.mode === "expanded" || s.mode === "minimizing";
