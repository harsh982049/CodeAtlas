import { performance } from "node:perf_hooks";
import { cpuUsage, memoryUsage, resourceUsage } from "node:process";

export type AnalysisPhaseName =
  | "REPOSITORY_DISCOVERY"
  | "CONFIGURATION_PARSING"
  | "PROGRAM_CONSTRUCTION"
  | "ENTITY_EXTRACTION"
  | "RELATIONSHIP_RESOLUTION"
  | "GRAPH_VALIDATION";

export interface AnalysisPhaseTelemetry {
  readonly phase: AnalysisPhaseName;
  readonly elapsedMs: number;
  readonly rssBeforeBytes: number;
  readonly rssAfterBytes: number;
}

export interface AnalysisTelemetry {
  readonly phases: readonly AnalysisPhaseTelemetry[];
  readonly peakRssBytes: number;
  readonly peakRssMeasurement: "PROCESS_HIGH_WATER_MARK";
  readonly cpuUserMicroseconds: number;
  readonly cpuSystemMicroseconds: number;
}

export class AnalysisTelemetryRecorder {
  readonly #phases: AnalysisPhaseTelemetry[] = [];
  readonly #cpuStart = cpuUsage();

  async measureAsync<T>(phase: AnalysisPhaseName, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const rssBeforeBytes = memoryUsage.rss();
    try {
      return await operation();
    } finally {
      this.#record(phase, started, rssBeforeBytes);
    }
  }

  measure<T>(phase: AnalysisPhaseName, operation: () => T): T {
    const started = performance.now();
    const rssBeforeBytes = memoryUsage.rss();
    try {
      return operation();
    } finally {
      this.#record(phase, started, rssBeforeBytes);
    }
  }

  recordElapsed(phase: AnalysisPhaseName, elapsedMs: number): void {
    const rss = memoryUsage.rss();
    this.#phases.push({ phase, elapsedMs: Math.max(0, Math.round(elapsedMs)), rssBeforeBytes: rss, rssAfterBytes: rss });
  }

  result(): AnalysisTelemetry {
    const cpu = cpuUsage(this.#cpuStart);
    return {
      phases: this.#phases,
      peakRssBytes: resourceUsage().maxRSS * 1024,
      peakRssMeasurement: "PROCESS_HIGH_WATER_MARK",
      cpuUserMicroseconds: cpu.user,
      cpuSystemMicroseconds: cpu.system,
    };
  }

  #record(phase: AnalysisPhaseName, started: number, rssBeforeBytes: number): void {
    this.#phases.push({
      phase,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      rssBeforeBytes,
      rssAfterBytes: memoryUsage.rss(),
    });
  }
}
