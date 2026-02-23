import { logger } from '@/lib/logger';

// --- Types ---

type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

interface MetricDefinition {
  name: string;
  type: MetricType;
  description?: string;
  labels: string[];
  buckets?: number[];
  retentionMs: number;
}

interface TaggedSample {
  value: number;
  timestamp: number;
  tags: Record<string, string>;
}

interface MetricState {
  definition: MetricDefinition;
  samples: TaggedSample[];
}

interface AggregatedResult {
  metric: string;
  tags: Record<string, string>;
  sum: number;
  avg: number;
  min: number;
  max: number;
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

interface RateResult {
  metric: string;
  tags: Record<string, string>;
  perSecond: number;
  perMinute: number;
}

interface AlertRule {
  id: string;
  metric: string;
  condition: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  windowMs: number;
  aggregation: 'avg' | 'sum' | 'min' | 'max' | 'p95' | 'p99';
  tags?: Record<string, string>;
  message?: string;
}

interface AlertEvent {
  ruleId: string;
  metric: string;
  value: number;
  threshold: number;
  condition: string;
  triggeredAt: number;
  message: string;
}

interface PrometheusLine {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp: number;
}

// --- Helpers ---

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function tagsKey(tags: Record<string, string>): string {
  return Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

function tagsMatch(sample: Record<string, string>, filter: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (sample[k] !== v) return false;
  }
  return true;
}

// --- Aggregator ---

class CustomMetricsAggregator {
  private metrics = new Map<string, MetricState>();
  private alertRules = new Map<string, AlertRule>();
  private alerts: AlertEvent[] = [];
  private alertCallbacks: ((alert: AlertEvent) => void)[] = [];
  private readonly maxAlertsHistory: number;
  private evictIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(maxAlertsHistory = 10_000) {
    this.maxAlertsHistory = maxAlertsHistory;
    if (typeof setInterval !== 'undefined') {
      this.evictIntervalId = setInterval(() => this.evictExpired(), 60_000);
    }
    logger.info('CustomMetricsAggregator initialized');
  }

  registerMetric(definition: MetricDefinition): void {
    if (this.metrics.has(definition.name)) {
      logger.warn('Metric already registered, updating', { metric: definition.name });
    }
    if (definition.type === 'histogram' && (!definition.buckets || definition.buckets.length === 0)) {
      definition.buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    }
    this.metrics.set(definition.name, { definition, samples: [] });
    logger.info('Metric registered', { name: definition.name, type: definition.type });
  }

  removeMetric(name: string): boolean {
    return this.metrics.delete(name);
  }

  getMetricDefinition(name: string): MetricDefinition | undefined {
    return this.metrics.get(name)?.definition;
  }

  listMetrics(): MetricDefinition[] {
    return Array.from(this.metrics.values()).map((s) => s.definition);
  }

  // --- Recording ---

  increment(name: string, value = 1, tags: Record<string, string> = {}): void {
    const state = this.metrics.get(name);
    if (!state) {
      logger.warn('Increment on unknown metric', { metric: name });
      return;
    }
    if (state.definition.type !== 'counter' && state.definition.type !== 'gauge') {
      logger.warn('Increment only for counter/gauge', { metric: name });
      return;
    }
    this.addSample(state, value, tags);
  }

  set(name: string, value: number, tags: Record<string, string> = {}): void {
    const state = this.metrics.get(name);
    if (!state) {
      logger.warn('Set on unknown metric', { metric: name });
      return;
    }
    if (state.definition.type !== 'gauge') {
      logger.warn('Set only for gauge metrics', { metric: name });
      return;
    }
    this.addSample(state, value, tags);
  }

  observe(name: string, value: number, tags: Record<string, string> = {}): void {
    const state = this.metrics.get(name);
    if (!state) {
      logger.warn('Observe on unknown metric', { metric: name });
      return;
    }
    if (state.definition.type !== 'histogram' && state.definition.type !== 'summary') {
      logger.warn('Observe only for histogram/summary', { metric: name });
      return;
    }
    this.addSample(state, value, tags);
  }

  private addSample(state: MetricState, value: number, tags: Record<string, string>): void {
    state.samples.push({ value, timestamp: Date.now(), tags });
    this.checkAlertRules(state.definition.name);
  }

  // --- Eviction ---

  private evictExpired(): void {
    const now = Date.now();
    for (const state of this.metrics.values()) {
      const cutoff = now - state.definition.retentionMs;
      if (state.samples.length > 0 && state.samples[0].timestamp < cutoff) {
        state.samples = state.samples.filter((s) => s.timestamp >= cutoff);
      }
    }
  }

  // --- Aggregation ---

  aggregate(
    name: string,
    tags?: Record<string, string>,
    from?: number,
    to?: number,
  ): AggregatedResult | null {
    const state = this.metrics.get(name);
    if (!state) return null;

    let samples = state.samples;
    if (tags) samples = samples.filter((s) => tagsMatch(s.tags, tags));
    if (from) samples = samples.filter((s) => s.timestamp >= from);
    if (to) samples = samples.filter((s) => s.timestamp <= to);

    if (samples.length === 0) {
      return {
        metric: name,
        tags: tags ?? {},
        sum: 0, avg: 0, min: 0, max: 0, count: 0,
        p50: 0, p95: 0, p99: 0,
      };
    }

    const values = samples.map((s) => s.value);
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((s, v) => s + v, 0);

    return {
      metric: name,
      tags: tags ?? {},
      sum: parseFloat(sum.toFixed(3)),
      avg: parseFloat((sum / values.length).toFixed(3)),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      count: values.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }

  aggregateByTags(name: string, groupByLabel: string, from?: number, to?: number): AggregatedResult[] {
    const state = this.metrics.get(name);
    if (!state) return [];

    let samples = state.samples;
    if (from) samples = samples.filter((s) => s.timestamp >= from);
    if (to) samples = samples.filter((s) => s.timestamp <= to);

    const groups = new Map<string, TaggedSample[]>();
    for (const s of samples) {
      const key = s.tags[groupByLabel] ?? '__untagged__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    const results: AggregatedResult[] = [];
    for (const [tagValue, groupSamples] of groups) {
      const values = groupSamples.map((s) => s.value);
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((s, v) => s + v, 0);

      results.push({
        metric: name,
        tags: { [groupByLabel]: tagValue },
        sum: parseFloat(sum.toFixed(3)),
        avg: parseFloat((sum / values.length).toFixed(3)),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        count: values.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      });
    }

    return results;
  }

  // --- Rate Calculation ---

  rate(name: string, tags?: Record<string, string>, windowMs = 60_000): RateResult {
    const state = this.metrics.get(name);
    if (!state) return { metric: name, tags: tags ?? {}, perSecond: 0, perMinute: 0 };

    const cutoff = Date.now() - windowMs;
    let samples = state.samples.filter((s) => s.timestamp >= cutoff);
    if (tags) samples = samples.filter((s) => tagsMatch(s.tags, tags));

    if (samples.length < 2) {
      return { metric: name, tags: tags ?? {}, perSecond: 0, perMinute: 0 };
    }

    const total = samples.reduce((s, v) => s + v.value, 0);
    const durationMs = samples[samples.length - 1].timestamp - samples[0].timestamp;
    if (durationMs <= 0) {
      return { metric: name, tags: tags ?? {}, perSecond: 0, perMinute: 0 };
    }

    const perSecond = parseFloat(((total / durationMs) * 1000).toFixed(4));
    const perMinute = parseFloat((perSecond * 60).toFixed(4));

    return { metric: name, tags: tags ?? {}, perSecond, perMinute };
  }

  // --- Alert Rules ---

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info('Alert rule added', { ruleId: rule.id, metric: rule.metric });
  }

  removeAlertRule(id: string): boolean {
    return this.alertRules.delete(id);
  }

  onAlert(callback: (alert: AlertEvent) => void): void {
    this.alertCallbacks.push(callback);
  }

  private checkAlertRules(metricName: string): void {
    for (const rule of this.alertRules.values()) {
      if (rule.metric !== metricName) continue;

      const agg = this.aggregate(metricName, rule.tags, Date.now() - rule.windowMs);
      if (!agg || agg.count === 0) continue;

      let value: number;
      switch (rule.aggregation) {
        case 'avg': value = agg.avg; break;
        case 'sum': value = agg.sum; break;
        case 'min': value = agg.min; break;
        case 'max': value = agg.max; break;
        case 'p95': value = agg.p95; break;
        case 'p99': value = agg.p99; break;
        default: value = agg.avg;
      }

      const triggered = this.evaluateCondition(value, rule.condition, rule.threshold);
      if (triggered) {
        const alert: AlertEvent = {
          ruleId: rule.id,
          metric: metricName,
          value,
          threshold: rule.threshold,
          condition: rule.condition,
          triggeredAt: Date.now(),
          message: rule.message ?? `Alert: ${metricName} ${rule.condition} ${rule.threshold} (actual: ${value})`,
        };

        this.alerts.push(alert);
        if (this.alerts.length > this.maxAlertsHistory) {
          this.alerts = this.alerts.slice(this.alerts.length - this.maxAlertsHistory);
        }

        for (const cb of this.alertCallbacks) {
          try { cb(alert); } catch { /* swallow */ }
        }
      }
    }
  }

  private evaluateCondition(value: number, condition: AlertRule['condition'], threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  getAlerts(since?: number): AlertEvent[] {
    if (since) return this.alerts.filter((a) => a.triggeredAt >= since);
    return [...this.alerts];
  }

  // --- Export ---

  toPrometheusFormat(name?: string): string {
    const lines: string[] = [];

    for (const [metricName, state] of this.metrics) {
      if (name && metricName !== name) continue;

      const def = state.definition;
      if (def.description) {
        lines.push(`# HELP ${metricName} ${def.description}`);
      }
      lines.push(`# TYPE ${metricName} ${def.type}`);

      if (def.type === 'counter' || def.type === 'gauge') {
        const tagGroups = new Map<string, number>();
        for (const s of state.samples) {
          const key = tagsKey(s.tags);
          tagGroups.set(key, (tagGroups.get(key) ?? 0) + s.value);
        }
        for (const [key, value] of tagGroups) {
          const labels = key ? `{${key}}` : '';
          lines.push(`${metricName}${labels} ${value}`);
        }
      } else if (def.type === 'histogram') {
        const buckets = def.buckets ?? [];
        const tagGroups = new Map<string, number[]>();
        for (const s of state.samples) {
          const key = tagsKey(s.tags);
          if (!tagGroups.has(key)) tagGroups.set(key, []);
          tagGroups.get(key)!.push(s.value);
        }
        for (const [key, values] of tagGroups) {
          const labels = key ? `{${key}}` : '';
          let cumulative = 0;
          for (const b of buckets) {
            cumulative += values.filter((v) => v <= b).length;
            lines.push(`${metricName}_bucket{le="${b}"${key ? ',' + key : ''}} ${cumulative}`);
          }
          lines.push(`${metricName}_bucket{le="+Inf"${key ? ',' + key : ''}} ${values.length}`);
          lines.push(`${metricName}_sum${labels} ${values.reduce((s, v) => s + v, 0)}`);
          lines.push(`${metricName}_count${labels} ${values.length}`);
        }
      } else if (def.type === 'summary') {
        const tagGroups = new Map<string, number[]>();
        for (const s of state.samples) {
          const key = tagsKey(s.tags);
          if (!tagGroups.has(key)) tagGroups.set(key, []);
          tagGroups.get(key)!.push(s.value);
        }
        for (const [key, values] of tagGroups) {
          const labels = key ? `{${key}}` : '';
          const sorted = [...values].sort((a, b) => a - b);
          lines.push(`${metricName}{quantile="0.5"${key ? ',' + key : ''}} ${percentile(sorted, 50)}`);
          lines.push(`${metricName}{quantile="0.95"${key ? ',' + key : ''}} ${percentile(sorted, 95)}`);
          lines.push(`${metricName}{quantile="0.99"${key ? ',' + key : ''}} ${percentile(sorted, 99)}`);
          lines.push(`${metricName}_sum${labels} ${values.reduce((s, v) => s + v, 0)}`);
          lines.push(`${metricName}_count${labels} ${values.length}`);
        }
      }
    }

    return lines.join('\n');
  }

  toJSON(name?: string): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const [metricName, state] of this.metrics) {
      if (name && metricName !== name) continue;
      const agg = this.aggregate(metricName);
      if (agg) {
        result.push({
          ...agg,
          type: state.definition.type,
          description: state.definition.description,
        });
      }
    }
    return result;
  }

  clearSamples(name?: string): void {
    if (name) {
      const state = this.metrics.get(name);
      if (state) state.samples = [];
    } else {
      for (const state of this.metrics.values()) {
        state.samples = [];
      }
    }
    logger.info('Metric samples cleared', { metric: name ?? 'all' });
  }
}

// --- Singleton ---

const GLOBAL_KEY = '__customMetricsAggregator__';

export function getCustomMetricsAggregator(): CustomMetricsAggregator {
  const g = globalThis as unknown as Record<string, CustomMetricsAggregator>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CustomMetricsAggregator();
  }
  return g[GLOBAL_KEY];
}

export type {
  MetricType,
  MetricDefinition,
  AggregatedResult,
  RateResult,
  AlertRule,
  AlertEvent,
  PrometheusLine,
};
