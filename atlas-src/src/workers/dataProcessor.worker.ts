/// <reference lib="webworker" />

import { runTask } from "@/lib/compute";
import type { WorkerEnvelope, WorkerRequest } from "@/lib/computeTypes";

/**
 * Interpolation, regression and corner detection all run here so that a
 * 5 000-point-per-channel resample never blocks a cursor scrub on the main
 * thread. The maths itself lives in `@/lib/compute`.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener("message", (event: MessageEvent<WorkerEnvelope<WorkerRequest>>) => {
  const { id, payload } = event.data;
  try {
    scope.postMessage({ id, payload: runTask(payload) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
