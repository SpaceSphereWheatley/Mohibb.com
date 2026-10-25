import type { Compound, LapRecord } from "@/types/session";
import type { CornerComparison } from "@/types/telemetry";
import { DEFAULT_CORNER_OPTIONS, detectCorners, measureAgainst } from "@/utils/cornerDetection";
import { deltaTimeTrace, deltaOverSegment } from "@/utils/deltaTime";
import { resampleToDistance } from "@/utils/distanceInterpolation";
import { classifyLaps, fuelCorrect } from "@/utils/fuelCorrection";
import { robustRegression } from "@/utils/linearRegression";
import type {
  CornersRequest,
  CornersResponse,
  DegradationFit,
  DegradationPoint,
  DegradationRequest,
  DegradationResponse,
  RaceTraceRequest,
  RaceTraceResponse,
  RaceTraceSeries,
  ResampleRequest,
  ResampleResponse,
  WorkerRequest,
  WorkerResponse,
} from "./computeTypes";

/**
 * Every expensive calculation the dashboard performs, as plain functions.
 *
 * The worker is a thin dispatcher over this module, and the main thread falls
 * back to calling it directly if a Worker cannot be constructed — so there is
 * exactly one implementation of the maths regardless of where it runs.
 */

function runResample(request: ResampleRequest): ResampleResponse {
  return {
    kind: "resample",
    telemetry: resampleToDistance(request.samples, {
      driverId: request.driverId,
      lap: request.lap,
      lapDistance: request.lapDistance,
      step: request.step,
    }),
  };
}

function runCorners(request: CornersRequest): CornersResponse {
  const options = { ...DEFAULT_CORNER_OPTIONS, ...request.options };
  const reference = request.reference;
  const referenceCorners = detectCorners(reference, options);

  if (!request.comparison) {
    return {
      kind: "corners",
      corners: referenceCorners.map((corner) => ({
        index: corner.index,
        apexDistance: corner.apexDistance,
        reference: corner,
        comparison: null,
        vMinDelta: null,
        brakeDelta: null,
        throttleDelta: null,
        timeDelta: null,
      })),
    };
  }

  const comparison = request.comparison;
  const measured = measureAgainst(referenceCorners, comparison, options);
  const delta = deltaTimeTrace(reference, comparison);

  const corners: CornerComparison[] = referenceCorners.map((corner, i) => {
    const other = measured[i];
    return {
      index: corner.index,
      apexDistance: corner.apexDistance,
      reference: corner,
      comparison: other,
      vMinDelta: other ? other.vMin - corner.vMin : null,
      brakeDelta:
        other && other.brakeDistance != null && corner.brakeDistance != null
          ? other.brakeDistance - corner.brakeDistance
          : null,
      throttleDelta:
        other && other.throttleDistance != null && corner.throttleDistance != null
          ? other.throttleDistance - corner.throttleDistance
          : null,
      timeDelta: deltaOverSegment(delta, reference.step, corner.entry, corner.exit),
    };
  });

  return { kind: "corners", corners };
}

function runDegradation(request: DegradationRequest): DegradationResponse {
  const wanted = new Set(request.driverIds);
  const compounds = new Set<Compound>(request.compounds);

  const scoped = request.laps.filter(
    (lap) => wanted.has(lap.driverId) && compounds.has(lap.compound),
  );
  const classified = classifyLaps(scoped, request.zones, request.filter);

  const points: DegradationPoint[] = [];
  for (const { record, excluded } of classified) {
    if (record.lapTime == null) continue;
    const corrected = request.fuelCorrectionEnabled
      ? fuelCorrect(record.lapTime, record.lap, request.fuel)
      : record.lapTime;
    points.push({
      driverId: record.driverId,
      lap: record.lap,
      stint: record.stint ?? 0,
      compound: record.compound,
      tyreAge: record.tyreAge ?? 0,
      rawTime: record.lapTime,
      correctedTime: corrected,
      excluded,
    });
  }

  // One fit per driver-stint: a stint is the only window over which "tyre age"
  // means anything, and mixing two stints of the same compound would fit a line
  // through two unrelated wear curves.
  const groups = new Map<string, DegradationPoint[]>();
  for (const point of points) {
    if (point.excluded) continue;
    const key = `${point.driverId}:${point.stint}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(point);
    else groups.set(key, [point]);
  }

  const fits: DegradationFit[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 4) continue;
    const { fit } = robustRegression(
      bucket.map((p) => p.tyreAge),
      bucket.map((p) => p.correctedTime),
    );
    if (!Number.isFinite(fit.slope)) continue;

    const laps = bucket.map((p) => p.lap);
    fits.push({
      driverId: bucket[0].driverId,
      stint: bucket[0].stint,
      compound: bucket[0].compound,
      lapStart: Math.min(...laps),
      lapEnd: Math.max(...laps),
      slope: fit.slope,
      intercept: fit.intercept,
      r2: fit.r2,
      n: fit.n,
      cliffAge: fit.slope > 0.001 ? 1 / fit.slope : null,
    });
  }

  fits.sort((a, b) => a.driverId.localeCompare(b.driverId) || a.stint - b.stint);
  return { kind: "degradation", points, fits };
}

function runRaceTrace(request: RaceTraceRequest): RaceTraceResponse {
  const wanted = new Set(request.driverIds);
  const byDriver = new Map<string, LapRecord[]>();
  for (const lap of request.laps) {
    if (!wanted.has(lap.driverId)) continue;
    const bucket = byDriver.get(lap.driverId);
    if (bucket) bucket.push(lap);
    else byDriver.set(lap.driverId, [lap]);
  }
  for (const bucket of byDriver.values()) bucket.sort((a, b) => a.lap - b.lap);

  // Cumulative elapsed time per driver, per lap.
  const cumulative = new Map<string, Map<number, number>>();
  let baselineDriverId: string | null = null;
  let baselineLaps = 0;
  let baselineTotal = Number.POSITIVE_INFINITY;

  for (const [driverId, bucket] of byDriver) {
    const running = new Map<number, number>();
    let total = 0;
    let counted = 0;
    for (const lap of bucket) {
      if (lap.lapTime == null) continue;
      total += lap.lapTime;
      counted++;
      running.set(lap.lap, total);
    }
    cumulative.set(driverId, running);
    if (counted === 0) continue;
    if (counted > baselineLaps || (counted === baselineLaps && total < baselineTotal)) {
      baselineLaps = counted;
      baselineTotal = total;
      baselineDriverId = driverId;
    }
  }

  const baseline = baselineDriverId ? cumulative.get(baselineDriverId) : undefined;

  const series: RaceTraceSeries[] = [];
  for (const [driverId, bucket] of byDriver) {
    const running = cumulative.get(driverId);
    if (!running) continue;
    const points: [number, number][] = [];
    for (const [lap, total] of running) {
      const reference = baseline?.get(lap);
      if (reference == null) continue;
      points.push([lap, total - reference]);
    }
    points.sort((a, b) => a[0] - b[0]);
    series.push({
      driverId,
      points,
      pitLaps: bucket.filter((lap) => lap.isPitIn).map((lap) => lap.lap),
    });
  }

  return { kind: "raceTrace", baselineDriverId, series };
}

export function runTask(request: WorkerRequest): WorkerResponse {
  switch (request.kind) {
    case "resample":
      return runResample(request);
    case "corners":
      return runCorners(request);
    case "degradation":
      return runDegradation(request);
    case "raceTrace":
      return runRaceTrace(request);
  }
}
