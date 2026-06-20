// mergePenalties.js
// Pure merge/dedupe logic shared (ported) into AggregatePenalties.gs and
// StatsBombRebuild.gs, which can't import ES modules. Keep in sync if this
// file changes.
// Laget av Mohibb Malik, 2025

export function normalizeName(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Two penalties are the "same" event if they share matchId + taker + minute.
export function penaltyKey(p) {
  return [p.matchId, normalizeName(p.taker), p.minute].join('|');
}

const CONFIDENCE_RANK = { full: 3, partial: 2, minimal: 1 };

function confidenceRank(c) {
  return CONFIDENCE_RANK[c] || 0;
}

// Merges `incoming` into `existing`, keyed by penaltyKey. On a collision,
// the record with the higher confidence tier wins (full > partial > minimal)
// so a richer re-fetch (e.g. a StatsBomb rebuild filling in a placement that
// Understat couldn't) overwrites a lower-quality existing record instead of
// being silently discarded.
export function mergePenalties(existing, incoming) {
  const byKey = new Map();
  for (const p of existing) byKey.set(penaltyKey(p), p);

  for (const p of incoming) {
    const key = penaltyKey(p);
    const current = byKey.get(key);
    if (!current || confidenceRank(p.confidence) > confidenceRank(current.confidence)) {
      byKey.set(key, p);
    }
  }
  return Array.from(byKey.values());
}
