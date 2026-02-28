interface LatencySample {
  durationMs: number;
  timestamp: number;
}

interface EndpointMetrics {
  samples: LatencySample[];
  requestCount: number;
  errorCount: number;
}

class MetricsCollector {
  private store = new Map<string, EndpointMetrics>();
  private readonly windowMs: number;

  constructor(windowMs = 60_000) {
    this.windowMs = windowMs;
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.evict(), this.windowMs);
    }
  }

  private key(method: string, endpoint: string): string {
    return `${method.toUpperCase()}:${endpoint}`;
  }

  private evict(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [k, metrics] of this.store) {
      metrics.samples = metrics.samples.filter((s) => s.timestamp > cutoff);
      if (metrics.samples.length === 0 && metrics.requestCount === 0) {
        this.store.delete(k);
      }
    }
  }

  // Prometheus-style API used by many modules
  increment(name: string, _labels?: Record<string, string>): void {
    const k = `counter:${name}`;
    const m = this.store.get(k) ?? { samples: [], requestCount: 0, errorCount: 0 };
    m.requestCount++;
    this.store.set(k, m);
  }

  gauge(_name: string, _value: number, _labels?: Record<string, string>): void {
    // no-op stub for gauge metrics
  }

  histogram(_name: string, _value: number, _labels?: Record<string, string>): void {
    // no-op stub for histogram metrics
  }

  record(method: string, endpoint: string, durationMs: number, isError: boolean): void {
    const k = this.key(method, endpoint);
    let m = this.store.get(k);
    if (!m) {
      m = { samples: [], requestCount: 0, errorCount: 0 };
      this.store.set(k, m);
    }
    m.samples.push({ durationMs, timestamp: Date.now() });
    m.requestCount++;
    if (isError) m.errorCount++;
  }

  percentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getSnapshot(): {
    endpoint: string;
    method: string;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    requestCount: number;
    errorCount: number;
    errorRate: number;
  }[] {
    this.evict();
    const results = [];
    for (const [k, m] of this.store) {
      const [method, ...endpointParts] = k.split(':');
      const endpoint = endpointParts.join(':');
      const durations = m.samples.map((s) => s.durationMs);
      results.push({
        endpoint,
        method,
        p50Ms: this.percentile(durations, 50),
        p95Ms: this.percentile(durations, 95),
        p99Ms: this.percentile(durations, 99),
        requestCount: m.requestCount,
        errorCount: m.errorCount,
        errorRate:
          m.requestCount > 0
            ? parseFloat(((m.errorCount / m.requestCount) * 100).toFixed(2))
            : 0,
      });
    }
    return results.sort((a, b) => b.requestCount - a.requestCount);
  }
}

const GLOBAL_METRICS_KEY = '__metricsCollector__';

function getMetrics(): MetricsCollector {
  const g = globalThis as unknown as Record<string, MetricsCollector>;
  if (!g[GLOBAL_METRICS_KEY]) {
    g[GLOBAL_METRICS_KEY] = new MetricsCollector();
  }
  return g[GLOBAL_METRICS_KEY];
}

export const metrics = getMetrics();

export { getMetrics };
