import type { ReactNode } from "react";

/**
 * Fixed-width numerals. Applied globally in `globals.css` too, but worth having
 * explicitly wherever a value is expected to change under a moving cursor —
 * it documents the intent as much as it sets the font feature.
 */
export function TabularNum({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${className}`}>{children}</span>
  );
}
