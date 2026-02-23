import { logger } from '@/lib/logger';

// --- Types ---

interface FunnelStepDefinition {
  id: string;
  name: string;
  description?: string;
}

interface FunnelDefinition {
  id: string;
  name: string;
  steps: FunnelStepDefinition[];
  createdAt: number;
}

interface StepEvent {
  userId: string;
  funnelId: string;
  stepId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface StepConversion {
  stepId: string;
  stepName: string;
  entered: number;
  completed: number;
  conversionRate: number;
  dropOffRate: number;
  dropOffCount: number;
  avgTimeMs: number;
  medianTimeMs: number;
  p95TimeMs: number;
}

interface FunnelReport {
  funnelId: string;
  funnelName: string;
  totalEntered: number;
  totalCompleted: number;
  overallConversionRate: number;
  avgTotalTimeMs: number;
  steps: StepConversion[];
  generatedAt: string;
}

interface FunnelComparison {
  funnelA: FunnelReport;
  funnelB: FunnelReport;
  conversionDelta: number;
  timeDeltaMs: number;
  stepDeltas: { stepIndex: number; conversionDelta: number; timeDeltaMs: number }[];
}

interface SegmentedFunnelReport {
  segment: string;
  report: FunnelReport;
}

interface FunnelVisualization {
  funnelId: string;
  funnelName: string;
  bars: { stepId: string; stepName: string; count: number; percentage: number }[];
  dropOffArrows: { fromStep: string; toStep: string; dropCount: number; dropPercent: number }[];
}

type SegmentExtractor = (event: StepEvent) => string;

// --- Helpers ---

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// --- Engine ---

class FunnelAnalyticsEngine {
  private funnels = new Map<string, FunnelDefinition>();
  private events: StepEvent[] = [];
  private readonly maxEvents: number;
  private segmentExtractors = new Map<string, SegmentExtractor>();

  constructor(maxEvents = 500_000) {
    this.maxEvents = maxEvents;
    logger.info('FunnelAnalyticsEngine initialized', { maxEvents });
  }

  defineFunnel(id: string, name: string, steps: FunnelStepDefinition[]): FunnelDefinition {
    if (steps.length < 2) {
      throw new Error('A funnel must have at least 2 steps');
    }
    const seen = new Set<string>();
    for (const s of steps) {
      if (seen.has(s.id)) throw new Error(`Duplicate step id: ${s.id}`);
      seen.add(s.id);
    }
    const def: FunnelDefinition = { id, name, steps, createdAt: Date.now() };
    this.funnels.set(id, def);
    logger.info('Funnel defined', { funnelId: id, stepCount: steps.length });
    return def;
  }

  removeFunnel(id: string): boolean {
    const deleted = this.funnels.delete(id);
    if (deleted) {
      this.events = this.events.filter((e) => e.funnelId !== id);
      logger.info('Funnel removed', { funnelId: id });
    }
    return deleted;
  }

  getFunnel(id: string): FunnelDefinition | undefined {
    return this.funnels.get(id);
  }

  listFunnels(): FunnelDefinition[] {
    return Array.from(this.funnels.values());
  }

  registerSegmentExtractor(name: string, extractor: SegmentExtractor): void {
    this.segmentExtractors.set(name, extractor);
  }

  trackStep(userId: string, funnelId: string, stepId: string, metadata?: Record<string, unknown>): void {
    const funnel = this.funnels.get(funnelId);
    if (!funnel) {
      logger.warn('Track step for unknown funnel', { funnelId });
      return;
    }
    if (!funnel.steps.find((s) => s.id === stepId)) {
      logger.warn('Track step for unknown step', { funnelId, stepId });
      return;
    }
    const event: StepEvent = { userId, funnelId, stepId, timestamp: Date.now(), metadata };
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  private filterEvents(funnelId: string, from?: number, to?: number): StepEvent[] {
    return this.events.filter(
      (e) =>
        e.funnelId === funnelId &&
        (from === undefined || e.timestamp >= from) &&
        (to === undefined || e.timestamp <= to),
    );
  }

  private buildUserTimelines(
    events: StepEvent[],
    steps: FunnelStepDefinition[],
  ): Map<string, Map<string, number>> {
    const stepOrder = new Map(steps.map((s, i) => [s.id, i]));
    const timelines = new Map<string, Map<string, number>>();

    for (const e of events) {
      if (!timelines.has(e.userId)) {
        timelines.set(e.userId, new Map());
      }
      const userMap = timelines.get(e.userId)!;
      const existing = userMap.get(e.stepId);
      // Keep earliest timestamp per step
      if (existing === undefined || e.timestamp < existing) {
        userMap.set(e.stepId, e.timestamp);
      }
    }

    // Validate ordering: a step only counts if the previous step was completed before it
    for (const [, userMap] of timelines) {
      for (let i = 1; i < steps.length; i++) {
        const prev = steps[i - 1].id;
        const curr = steps[i].id;
        const prevTs = userMap.get(prev);
        const currTs = userMap.get(curr);
        if (currTs !== undefined && (prevTs === undefined || currTs < prevTs)) {
          userMap.delete(curr);
        }
      }
    }

    return timelines;
  }

  generateReport(funnelId: string, from?: number, to?: number): FunnelReport {
    const funnel = this.funnels.get(funnelId);
    if (!funnel) throw new Error(`Funnel not found: ${funnelId}`);

    const events = this.filterEvents(funnelId, from, to);
    const timelines = this.buildUserTimelines(events, funnel.steps);
    const steps = funnel.steps;

    const stepResults: StepConversion[] = [];
    let totalEntered = 0;
    let totalCompleted = 0;
    const totalTimes: number[] = [];

    for (let i = 0; i < steps.length; i++) {
      const stepId = steps[i].id;
      const prevStepId = i > 0 ? steps[i - 1].id : null;

      let entered = 0;
      let completed = 0;
      const timesMs: number[] = [];

      for (const [, userMap] of timelines) {
        // For step 0, everyone who has it counts as entered
        if (i === 0) {
          if (userMap.has(stepId)) {
            entered++;
            completed++;
          }
        } else {
          // Entered = completed previous step
          if (userMap.has(prevStepId!)) {
            entered++;
            if (userMap.has(stepId)) {
              completed++;
              const prevTs = userMap.get(prevStepId!)!;
              const currTs = userMap.get(stepId)!;
              timesMs.push(currTs - prevTs);
            }
          }
        }
      }

      if (i === 0) {
        totalEntered = entered;
      }
      if (i === steps.length - 1) {
        totalCompleted = completed;
      }

      const sortedTimes = [...timesMs].sort((a, b) => a - b);

      stepResults.push({
        stepId,
        stepName: steps[i].name,
        entered,
        completed,
        conversionRate: entered > 0 ? parseFloat(((completed / entered) * 100).toFixed(2)) : 0,
        dropOffRate: entered > 0 ? parseFloat((((entered - completed) / entered) * 100).toFixed(2)) : 0,
        dropOffCount: entered - completed,
        avgTimeMs: Math.round(avg(timesMs)),
        medianTimeMs: Math.round(median(timesMs)),
        p95TimeMs: Math.round(percentile(sortedTimes, 95)),
      });
    }

    // Total time: first step timestamp to last step timestamp
    for (const [, userMap] of timelines) {
      const firstTs = userMap.get(steps[0].id);
      const lastTs = userMap.get(steps[steps.length - 1].id);
      if (firstTs !== undefined && lastTs !== undefined) {
        totalTimes.push(lastTs - firstTs);
      }
    }

    return {
      funnelId,
      funnelName: funnel.name,
      totalEntered,
      totalCompleted,
      overallConversionRate:
        totalEntered > 0
          ? parseFloat(((totalCompleted / totalEntered) * 100).toFixed(2))
          : 0,
      avgTotalTimeMs: Math.round(avg(totalTimes)),
      steps: stepResults,
      generatedAt: new Date().toISOString(),
    };
  }

  compareFunnels(
    funnelIdA: string,
    funnelIdB: string,
    from?: number,
    to?: number,
  ): FunnelComparison {
    const reportA = this.generateReport(funnelIdA, from, to);
    const reportB = this.generateReport(funnelIdB, from, to);

    const minSteps = Math.min(reportA.steps.length, reportB.steps.length);
    const stepDeltas: FunnelComparison['stepDeltas'] = [];
    for (let i = 0; i < minSteps; i++) {
      stepDeltas.push({
        stepIndex: i,
        conversionDelta: parseFloat(
          (reportB.steps[i].conversionRate - reportA.steps[i].conversionRate).toFixed(2),
        ),
        timeDeltaMs: reportB.steps[i].avgTimeMs - reportA.steps[i].avgTimeMs,
      });
    }

    return {
      funnelA: reportA,
      funnelB: reportB,
      conversionDelta: parseFloat(
        (reportB.overallConversionRate - reportA.overallConversionRate).toFixed(2),
      ),
      timeDeltaMs: reportB.avgTotalTimeMs - reportA.avgTotalTimeMs,
      stepDeltas,
    };
  }

  analyzeBySegment(
    funnelId: string,
    segmentName: string,
    from?: number,
    to?: number,
  ): SegmentedFunnelReport[] {
    const funnel = this.funnels.get(funnelId);
    if (!funnel) throw new Error(`Funnel not found: ${funnelId}`);

    const extractor = this.segmentExtractors.get(segmentName);
    if (!extractor) throw new Error(`Segment extractor not found: ${segmentName}`);

    const events = this.filterEvents(funnelId, from, to);
    const segmentBuckets = new Map<string, StepEvent[]>();

    for (const event of events) {
      const segment = extractor(event);
      if (!segmentBuckets.has(segment)) {
        segmentBuckets.set(segment, []);
      }
      segmentBuckets.get(segment)!.push(event);
    }

    const results: SegmentedFunnelReport[] = [];
    for (const [segment, segEvents] of segmentBuckets) {
      const timelines = this.buildUserTimelines(segEvents, funnel.steps);
      const report = this.buildReportFromTimelines(funnel, timelines);
      results.push({ segment, report });
    }

    return results.sort((a, b) => b.report.overallConversionRate - a.report.overallConversionRate);
  }

  private buildReportFromTimelines(
    funnel: FunnelDefinition,
    timelines: Map<string, Map<string, number>>,
  ): FunnelReport {
    const steps = funnel.steps;
    const stepResults: StepConversion[] = [];
    let totalEntered = 0;
    let totalCompleted = 0;
    const totalTimes: number[] = [];

    for (let i = 0; i < steps.length; i++) {
      const stepId = steps[i].id;
      const prevStepId = i > 0 ? steps[i - 1].id : null;
      let entered = 0;
      let completed = 0;
      const timesMs: number[] = [];

      for (const [, userMap] of timelines) {
        if (i === 0) {
          if (userMap.has(stepId)) {
            entered++;
            completed++;
          }
        } else {
          if (userMap.has(prevStepId!)) {
            entered++;
            if (userMap.has(stepId)) {
              completed++;
              timesMs.push(userMap.get(stepId)! - userMap.get(prevStepId!)!);
            }
          }
        }
      }

      if (i === 0) totalEntered = entered;
      if (i === steps.length - 1) totalCompleted = completed;

      const sortedTimes = [...timesMs].sort((a, b) => a - b);
      stepResults.push({
        stepId,
        stepName: steps[i].name,
        entered,
        completed,
        conversionRate: entered > 0 ? parseFloat(((completed / entered) * 100).toFixed(2)) : 0,
        dropOffRate: entered > 0 ? parseFloat((((entered - completed) / entered) * 100).toFixed(2)) : 0,
        dropOffCount: entered - completed,
        avgTimeMs: Math.round(avg(timesMs)),
        medianTimeMs: Math.round(median(timesMs)),
        p95TimeMs: Math.round(percentile(sortedTimes, 95)),
      });
    }

    for (const [, userMap] of timelines) {
      const firstTs = userMap.get(steps[0].id);
      const lastTs = userMap.get(steps[steps.length - 1].id);
      if (firstTs !== undefined && lastTs !== undefined) {
        totalTimes.push(lastTs - firstTs);
      }
    }

    return {
      funnelId: funnel.id,
      funnelName: funnel.name,
      totalEntered,
      totalCompleted,
      overallConversionRate:
        totalEntered > 0
          ? parseFloat(((totalCompleted / totalEntered) * 100).toFixed(2))
          : 0,
      avgTotalTimeMs: Math.round(avg(totalTimes)),
      steps: stepResults,
      generatedAt: new Date().toISOString(),
    };
  }

  getVisualizationData(funnelId: string, from?: number, to?: number): FunnelVisualization {
    const funnel = this.funnels.get(funnelId);
    if (!funnel) throw new Error(`Funnel not found: ${funnelId}`);

    const report = this.generateReport(funnelId, from, to);

    const bars = report.steps.map((s) => ({
      stepId: s.stepId,
      stepName: s.stepName,
      count: s.completed,
      percentage:
        report.totalEntered > 0
          ? parseFloat(((s.completed / report.totalEntered) * 100).toFixed(2))
          : 0,
    }));

    const dropOffArrows: FunnelVisualization['dropOffArrows'] = [];
    for (let i = 0; i < report.steps.length - 1; i++) {
      const curr = report.steps[i];
      const next = report.steps[i + 1];
      dropOffArrows.push({
        fromStep: curr.stepId,
        toStep: next.stepId,
        dropCount: curr.completed - next.completed,
        dropPercent:
          curr.completed > 0
            ? parseFloat((((curr.completed - next.completed) / curr.completed) * 100).toFixed(2))
            : 0,
      });
    }

    return {
      funnelId: report.funnelId,
      funnelName: report.funnelName,
      bars,
      dropOffArrows,
    };
  }

  getDropOffAnalysis(
    funnelId: string,
    from?: number,
    to?: number,
  ): { stepId: string; stepName: string; dropOffCount: number; dropOffRate: number; rank: number }[] {
    const report = this.generateReport(funnelId, from, to);
    const analysis = report.steps
      .filter((s) => s.dropOffCount > 0)
      .sort((a, b) => b.dropOffCount - a.dropOffCount)
      .map((s, idx) => ({
        stepId: s.stepId,
        stepName: s.stepName,
        dropOffCount: s.dropOffCount,
        dropOffRate: s.dropOffRate,
        rank: idx + 1,
      }));
    return analysis;
  }

  getEventCount(): number {
    return this.events.length;
  }

  clearEvents(funnelId?: string): void {
    if (funnelId) {
      this.events = this.events.filter((e) => e.funnelId !== funnelId);
    } else {
      this.events = [];
    }
    logger.info('Funnel events cleared', { funnelId: funnelId ?? 'all' });
  }
}

// --- Singleton ---

const GLOBAL_KEY = '__funnelAnalyticsEngine__';

export function getFunnelAnalyticsEngine(): FunnelAnalyticsEngine {
  const g = globalThis as unknown as Record<string, FunnelAnalyticsEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new FunnelAnalyticsEngine();
  }
  return g[GLOBAL_KEY];
}

export type {
  FunnelDefinition,
  FunnelStepDefinition,
  StepEvent,
  StepConversion,
  FunnelReport,
  FunnelComparison,
  SegmentedFunnelReport,
  FunnelVisualization,
};
