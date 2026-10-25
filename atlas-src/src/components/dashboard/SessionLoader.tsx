"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, FileUp, Loader2, X } from "lucide-react";
import { AVAILABLE_YEARS, listSessions } from "@/lib/openf1";
import { parseSessionFile } from "@/lib/importSession";
import { BASE_PATH } from "@/lib/basePath";
import { useSessionStore } from "@/store/useSessionStore";
import type { SessionSummary } from "@/types/session";

type Tab = "openf1" | "import";

/**
 * Session picker.
 *
 * OpenF1 is the default source — it covers every session from 2023 on and needs
 * no credentials — with a file drop as the escape hatch for data the API does
 * not carry (a real stationary time, a steering trace, a private test).
 */
export function SessionLoader({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("openf1");
  const [year, setYear] = useState(AVAILABLE_YEARS[0]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadFromOpenF1 = useSessionStore((state) => state.loadFromOpenF1);
  const loadSample = useSessionStore((state) => state.loadSample);
  const applyImport = useSessionStore((state) => state.applyImport);

  useEffect(() => {
    if (tab !== "openf1") return;
    const controller = new AbortController();
    setListing(true);
    setListError(null);
    listSessions(year, controller.signal)
      .then((rows) => setSessions(rows))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListing(false);
      });
    return () => controller.abort();
  }, [tab, year]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      `${session.circuit} ${session.country} ${session.name}`.toLowerCase().includes(needle),
    );
  }, [sessions, filter]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      setImporting(true);
      setImportError(null);
      try {
        const result = await parseSessionFile(file);
        await applyImport(result);
        onClose();
      } catch (error) {
        setImportError(error instanceof Error ? error.message : String(error));
      } finally {
        setImporting(false);
      }
    },
    [applyImport, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-10"
      role="dialog"
      aria-modal="true"
      aria-label="Load a session"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded border border-edge bg-panel shadow-2xl shadow-black/60">
        <header className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <h2 className="flex-1 text-[13px] font-semibold">Load a session</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex gap-1 border-b border-edge px-3 pt-2">
          <TabButton active={tab === "openf1"} onClick={() => setTab("openf1")}>
            <Database size={12} /> OpenF1
          </TabButton>
          <TabButton active={tab === "import"} onClick={() => setTab("import")}>
            <FileUp size={12} /> Import a file
          </TabButton>
        </div>

        {tab === "openf1" ? (
          <div className="p-4">
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 text-[11px] text-ink-3">
                Season
                <select
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="rounded border border-edge bg-panel-2 px-2 py-1.5 text-[12px] text-ink"
                >
                  {AVAILABLE_YEARS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by circuit or session…"
                aria-label="Filter sessions"
                className="min-w-0 flex-1 rounded border border-edge bg-panel-2 px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-3"
              />
            </div>

            <div className="mt-3 max-h-80 overflow-y-auto rounded border border-edge-soft">
              {listing ? (
                <p className="flex items-center gap-2 p-4 text-[12px] text-ink-3">
                  <Loader2 size={13} className="animate-spin" /> Fetching the {year} calendar…
                </p>
              ) : listError ? (
                <p className="p-4 text-[12px] text-bad">{listError}</p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-[12px] text-ink-3">No sessions match.</p>
              ) : (
                <ul>
                  {filtered.map((session) => (
                    <li key={session.key} className="border-b border-edge-soft last:border-0">
                      <button
                        type="button"
                        onClick={() => {
                          void loadFromOpenF1(session.key);
                          onClose();
                        }}
                        className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-panel-2"
                      >
                        <span className="w-28 shrink-0 font-mono text-[11px] text-ink-3">
                          {session.date.slice(0, 10)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                          {session.circuit}
                          <span className="text-ink-3"> · {session.name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-3">
                          {session.kind}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
              Lap, stint, pit and race-control data are fetched up front. Car telemetry is
              fetched per lap, on demand, and cached in this browser. Nothing is uploaded
              anywhere.
            </p>
          </div>
        ) : (
          <div className="p-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void handleFiles(event.dataTransfer.files);
              }}
              className={`flex flex-col items-center gap-2 rounded border-2 border-dashed px-4 py-10 text-center transition-colors ${
                dragging ? "border-ref bg-ref/5" : "border-edge"
              }`}
            >
              {importing ? (
                <Loader2 size={20} className="animate-spin text-ink-3" />
              ) : (
                <FileUp size={20} className="text-ink-3" />
              )}
              <p className="text-[12px] text-ink-2">Drop a .json or .csv export here</p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded border border-edge bg-panel-2 px-3 py-1.5 text-[11px] text-ink hover:border-ink-3"
              >
                Choose a file
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".json,.csv,.tsv"
                className="hidden"
                onChange={(event) => void handleFiles(event.target.files)}
              />
            </div>

            {importError ? <p className="mt-3 text-[12px] text-bad">{importError}</p> : null}

            <dl className="mt-4 space-y-2 text-[10px] leading-relaxed text-ink-3">
              <div>
                <dt className="font-semibold text-ink-2">JSON</dt>
                <dd>
                  A full session:{" "}
                  <code className="font-mono">
                    {"{ meta, drivers[], laps[], stints[], pits[], zones[], telemetry[] }"}
                  </code>
                  . Missing fields are filled in rather than rejected.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-2">CSV</dt>
                <dd>
                  One lap of telemetry, with at least a time and a speed column. Optional:
                  throttle, brake, gear, rpm, steering, driver, lap.
                </dd>
              </div>
            </dl>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-edge bg-panel-2/40 px-4 py-3">
          <p className="text-[10px] text-ink-3">No account, no backend, no upload.</p>
          <button
            type="button"
            onClick={() => {
              void loadSample(BASE_PATH);
              onClose();
            }}
            className="rounded border border-edge px-3 py-1.5 text-[11px] text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            Load the sample session
          </button>
        </footer>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-t border-b-2 px-3 py-2 text-[11px] ${
        active
          ? "border-ref text-ink"
          : "border-transparent text-ink-3 hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}
