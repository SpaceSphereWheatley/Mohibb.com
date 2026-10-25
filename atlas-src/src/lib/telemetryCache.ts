import type { LapTelemetry } from "@/types/telemetry";

/**
 * IndexedDB cache for resampled laps.
 *
 * A lap of car data is one network round trip plus an interpolation pass, and
 * an engineer flicks between the same handful of laps constantly. IndexedDB
 * stores structured clones, so the Float32Arrays survive verbatim — no
 * serialisation cost on the way in or out.
 *
 * Every call degrades to a no-op if IndexedDB is unavailable (private windows,
 * blocked site data), because a missing cache must never break the dashboard.
 */

const DB_NAME = "atlas-telemetry";
const DB_VERSION = 1;
const STORE = "laps";

let handle: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (handle) return handle;
  handle = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return handle;
}

function key(sessionKey: string, driverId: string, lap: number): string {
  return `${sessionKey}:${driverId}:${lap}`;
}

export async function readLap(
  sessionKey: string,
  driverId: string,
  lap: number,
): Promise<LapTelemetry | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(key(sessionKey, driverId, lap));
      request.onsuccess = () => resolve((request.result as LapTelemetry | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeLap(
  sessionKey: string,
  telemetry: LapTelemetry,
): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(telemetry, key(sessionKey, telemetry.driverId, telemetry.lap));
  } catch {
    /* cache writes are best-effort */
  }
}

export async function clearCache(): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {
    /* nothing to do */
  }
}
