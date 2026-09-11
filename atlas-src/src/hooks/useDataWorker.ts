"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runTask } from "@/lib/compute";
import type {
  ResponseFor,
  WorkerErrorEnvelope,
  WorkerEnvelope,
  WorkerRequest,
  WorkerResponse,
} from "@/lib/computeTypes";

/**
 * Bridge between the UI thread and the data worker.
 *
 * A single worker is shared by every widget — spinning one up per chart would
 * cost more in structured-clone traffic than it saves. If the browser refuses
 * to construct a Worker (older Safari under file://, a strict CSP), the same
 * task runs inline instead: slower, but the dashboard still works.
 */

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;

  try {
    worker = new Worker(new URL("../workers/dataProcessor.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    workerFailed = true;
    return null;
  }

  worker.addEventListener(
    "message",
    (event: MessageEvent<WorkerEnvelope<WorkerResponse> | WorkerErrorEnvelope>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if ("error" in event.data) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.payload);
    },
  );

  worker.addEventListener("error", () => {
    workerFailed = true;
    for (const entry of pending.values()) entry.reject(new Error("worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  });

  return worker;
}

export function runOffThread<T extends WorkerRequest>(request: T): Promise<ResponseFor<T>> {
  const active = ensureWorker();
  if (!active) {
    return new Promise((resolve, reject) => {
      try {
        resolve(runTask(request) as ResponseFor<T>);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  const id = nextId++;
  return new Promise<ResponseFor<T>>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as ResponseFor<T>),
      reject,
    });
    active.postMessage({ id, payload: request } satisfies WorkerEnvelope<WorkerRequest>);
  });
}

export interface DataWorkerState {
  busy: boolean;
  error: string | null;
}

/**
 * Runs one task and tracks its state. Results from superseded calls are
 * dropped, so a fast sequence of filter changes cannot leave a stale fit on
 * screen.
 */
export function useDataWorker() {
  const [state, setState] = useState<DataWorkerState>({ busy: false, error: null });
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async <T extends WorkerRequest>(request: T): Promise<ResponseFor<T> | null> => {
      const ticket = ++generation.current;
      setState({ busy: true, error: null });
      try {
        const result = await runOffThread(request);
        if (ticket !== generation.current || !mounted.current) return null;
        setState({ busy: false, error: null });
        return result;
      } catch (error) {
        if (ticket !== generation.current || !mounted.current) return null;
        setState({ busy: false, error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    [],
  );

  return { ...state, run };
}
