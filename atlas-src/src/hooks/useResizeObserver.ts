"use client";

import { useEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * Observes an element's content box. Canvas-backed charts have to be told
 * their new size explicitly — neither uPlot nor ECharts reflows on its own —
 * so every chart panel hangs off one of these.
 */
export function useResizeObserver<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Coalesce to one update per frame: react-grid-layout fires a resize on
      // every pointermove while a panel handle is being dragged.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = entry.contentRect;
        setSize((previous) =>
          Math.round(previous.width) === Math.round(box.width) &&
          Math.round(previous.height) === Math.round(box.height)
            ? previous
            : { width: box.width, height: box.height },
        );
      });
    });

    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return { ref, size };
}
