// tooltip.js
// Pure positioning helper for the pressure/takers scatter chart's hover
// tooltip, kept separate from app.js so it's unit-testable without a DOM.
// Laget av Mohibb Malik, 2025

// Anchors a tooltip above a point at (x, y) with radius r, flipping below
// the point if there's no room above, and clamping to stay fully inside
// [0, viewportW] x [0, viewportH].
export function clampTooltipPos(x, y, r, tooltipW, tooltipH, viewportW, viewportH, gap = 6) {
  let left = x - tooltipW / 2;
  let top = y - r - gap - tooltipH;

  if (top < 0) top = y + r + gap; // flip below the point if it'd go off the top

  left = Math.max(0, Math.min(left, viewportW - tooltipW));
  top = Math.max(0, Math.min(top, viewportH - tooltipH));

  return { left, top };
}
