"use client";

import type { ReactNode } from "react";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import type { Size } from "@/hooks/useResizeObserver";

/**
 * Gives a canvas chart its measured box.
 *
 * Charts are rendered through a render-prop rather than by passing a ref down,
 * so a widget cannot accidentally paint before the size is known — the first
 * call always carries real numbers or the children are not called at all.
 */
export function ResizeObserverWrapper({
  children,
  className = "",
  placeholder = null,
}: {
  children: (size: Size) => ReactNode;
  className?: string;
  placeholder?: ReactNode;
}) {
  const { ref, size } = useResizeObserver<HTMLDivElement>();
  const ready = size.width > 8 && size.height > 8;

  return (
    <div ref={ref} className={`relative min-h-0 min-w-0 ${className}`}>
      {ready ? children(size) : placeholder}
    </div>
  );
}
