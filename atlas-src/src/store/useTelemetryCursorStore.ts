"use client";

import { create } from "zustand";

/**
 * The synchronised scrub position, in metres around the lap.
 *
 * Deliberately tiny and deliberately *not* persisted. Every strip in the
 * telemetry stack writes to it on pointer move, so anything that subscribes to
 * `distance` re-renders at pointer rate — components that only need the value
 * for a readout should read it through `subscribe` and write to the DOM
 * directly instead of selecting it.
 */
interface CursorState {
  /** Metres from the start line, or null when the pointer is away. */
  distance: number | null;
  /** When pinned, pointer movement no longer moves the cursor. */
  pinned: boolean;
  setDistance: (distance: number | null) => void;
  togglePinned: () => void;
}

export const useTelemetryCursorStore = create<CursorState>()((set, get) => ({
  distance: null,
  pinned: false,
  setDistance(distance) {
    if (get().pinned) return;
    if (get().distance === distance) return;
    set({ distance });
  },
  togglePinned() {
    set((state) => ({ pinned: !state.pinned }));
  },
}));
