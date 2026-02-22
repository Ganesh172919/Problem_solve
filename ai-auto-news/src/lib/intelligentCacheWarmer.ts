/**
 * Intelligent Cache Warmer
 *
 * Provides:
 * - Predictive cache warming based on traffic patterns (time-of-day, day-of-week model)
 * - Content popularity scoring for pre-caching (exponential decay scoring)
 * - Dependency graph cache invalidation (topological sort)
 * - Adaptive TTL based on content freshness signals (update frequency)
 * - Cache hit rate optimization strategies
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CacheWarmingJob {
  id: string;
  contentKey: string;
  priority: number; // 0-100
  strategy: WarmingStrategy['name'];
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  ttl: number;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
}

export interface ContentPopularity {
  contentKey: string;
  rawScore: number;
  decayedScore: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  lastAccessedAt: Date;
  firstSeenAt: Date;
  accessHistory: Array<{ timestamp: Date; hits: number }>;
  trend: 'rising' | 'stable' | 'declining';
  predictedHitsNextHour: number;
}

export interface DependencyNode {
  key: string;
  dependencies: string[]; // keys this node depends on
  dependents: string[];   // keys that depend on this node
  invalidateOnChange: boolean;
  lastInvalidatedAt?: Date;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  adjacencyList: Record<string, string[]>;
  reverseAdjacencyList: Record<string, string[]>;
}

export interface TTLConfig {
  contentKey: string;
  baseTTL: number;
  adaptedTTL: number;
  updateFrequencySeconds: number;
  volatility: 'high' | 'medium' | 'low';
  lastUpdatedAt: Date;
  updateCount: number;
  reason: string;
}

export interface WarmingStrategy {
  name: 'lru_evict' | 'popularity' | 'time_based' | 'dependency_aware' | 'hybrid';
  description: string;
  config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
}

export interface TrafficPattern {
  hour: number;       // 0-23
  dayOfWeek: number;  // 0-6
  avgRequests: number;
  peakMultiplier: number;
}

export interface CacheMetrics {
  generatedAt: Date;
  totalKeys: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  missRate: number;
  warmingJobsCompleted: number;
  warmingJobsFailed: number;
  averageWarmingTimeMs: number;
  totalBytesServedFromCache: number;
  topHotKeys: Array<{ key: string; hits: number; hitRate: number }>;
  coldKeys: Array<{ key: string; missRate: number }>;
  ttlDistribution: Record<string, number>;
  strategyPerformance: Record<string, { jobs: number; successRate: number }>;
}

export interface WarmingScheduleEntry {
  contentKey: string;
  nextWarmAt: Date;
  intervalMs: number;
  strategy: WarmingStrategy['name'];
  enabled: boolean;
}

// ─── Intelligent Cache Warmer ─────────────────────────────────────────────────

class IntelligentCacheWarmer {
  private warmingJobs = new Map<string, CacheWarmingJob>();
  private popularityMap = new Map<string, ContentPopularity>();
  private dependencyGraph: DependencyGraph = {
    nodes: new Map(),
    adjacencyList: {},
    reverseAdjacencyList: {},
  };
  private ttlConfigs = new Map<string, TTLConfig>();
  private trafficPatterns: TrafficPattern[] = [];
  private strategies: WarmingStrategy[] = [];
  private scheduledEntries = new Map<string, WarmingScheduleEntry>();
  private scheduledTimers = new Map<string, NodeJS.Timeout>();
  private metrics = {
    hitCount: 0,
    missCount: 0,
    warmingJobsCompleted: 0,
    warmingJobsFailed: 0,
    warmingTimesMs: [] as number[],
    bytesServed: 0,
  };
  private readonly DECAY_HALF_LIFE_HOURS = 24; // exponential decay half-life

  constructor() {
    this.initStrategies();
    this.seedTrafficPatterns();
    this.seedSampleContentKeys();
    logger.info('IntelligentCacheWarmer initialized');
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  private initStrategies(): void {
    this.strategies = [
      {
        name: 'popularity',
        description: 'Pre-warm content with highest decayed popularity score',
        config: { minScore: 10, topN: 50 },
        enabled: true,
        priority: 1,
      },
      {
        name: 'time_based',
        description: 'Pre-warm based on predicted peak traffic hours',
        config: { minutesBefore: 15, peakThreshold: 1.5 },
        enabled: true,
        priority: 2,
      },
      {
        name: 'dependency_aware',
        description: 'Warm cache considering key dependency chains',
        config: { maxDepth: 5 },
        enabled: true,
        priority: 3,
      },
      {
        name: 'lru_evict',
        description: 'Warm recently evicted high-value keys',
        config: { evictionWindowMs: 600_000 },
        enabled: true,
        priority: 4,
      },
      {
        name: 'hybrid',
        description: 'Combine popularity + traffic pattern scoring',
        config: { popularityWeight: 0.6, trafficWeight: 0.4 },
        enabled: true,
        priority: 5,
      },
    ];
  }

  private seedTrafficPatterns(): void {
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        const isWeekend = dow === 0 || dow === 6;
        const baseMod = isWeekend ? 0.6 : 1.0;
        // Morning peak ~9am, afternoon trough ~3pm, evening peak ~8pm
        const hourCurve =
          h >= 8 && h <= 10 ? 1.8
          : h >= 11 && h <= 13 ? 1.4
          : h >= 18 && h <= 21 ? 1.6
          : h >= 0 && h <= 5 ? 0.3
          : 1.0;
        this.trafficPatterns.push({
          hour: h,
          dayOfWeek: dow,
          avgRequests: Math.round(100 * baseMod * hourCurve),
          peakMultiplier: hourCurve * baseMod,
        });
      }
    }
  }

  private seedSampleContentKeys(): void {
    const keys = [
      'article:latest:page:1', 'article:trending', 'homepage:hero',
      'nav:menu', 'user:profile:template', 'search:popular-terms',
      'category:technology:page:1', 'category:business:page:1',
      'widget:weather', 'widget:stocks', 'ad:banner:homepage',
      'config:site-settings', 'config:feature-flags',
    ];
    const now = new Date();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const hitCount = Math.floor(100 + Math.random() * 10000);
      const missCount = Math.floor(10 + Math.random() * 500);
      const lastAccessedAt = new Date(now.getTime() - Math.random() * 3_600_000);

      this.popularityMap.set(key, {
        contentKey: key,
        rawScore: hitCount,
        decayedScore: this.computeDecayedScore(hitCount, lastAccessedAt),
        hitCount,
        missCount,
        hitRate: parseFloat(((hitCount / (hitCount + missCount)) * 100).toFixed(2)),
        lastAccessedAt,
        firstSeenAt: new Date(now.getTime() - (i + 1) * 86_400_000),
        accessHistory: Array.from({ length: 24 }, (_, h) => ({
          timestamp: new Date(now.getTime() - h * 3_600_000),
          hits: Math.floor(Math.random() * 100),
        })),
        trend: ['rising', 'stable', 'declining'][i % 3] as ContentPopularity['trend'],
        predictedHitsNextHour: Math.floor(20 + Math.random() * 200),
      });

      this.ttlConfigs.set(key, {
        contentKey: key,
        baseTTL: 300,
        adaptedTTL: 300,
        updateFrequencySeconds: Math.floor(300 + Math.random() * 3600),
        volatility: (['high', 'medium', 'low'] as const)[i % 3],
        lastUpdatedAt: new Date(now.getTime() - Math.random() * 86_400_000),
        updateCount: Math.floor(1 + Math.random() * 50),
        reason: 'initial',
      });
    }

    // Seed dependency graph
    this.buildDependencyGraph({
      'homepage:hero': ['article:latest:page:1', 'widget:weather', 'ad:banner:homepage'],
      'nav:menu': ['config:site-settings', 'config:feature-flags'],
      'article:trending': ['search:popular-terms'],
      'category:technology:page:1': ['article:latest:page:1'],
      'category:business:page:1': [],
      'config:feature-flags': [],
      'config:site-settings': [],
      'article:latest:page:1': [],
      'widget:weather': [],
      'widget:stocks': [],
      'ad:banner:homepage': ['config:feature-flags'],
      'search:popular-terms': [],
      'user:profile:template': ['config:site-settings'],
    });
  }

  // ─── Popularity Scoring (Exponential Decay) ───────────────────────────────

  scoreContentPopularity(key: string, hits: number = 1): ContentPopularity {
    const now = new Date();
    let pop = this.popularityMap.get(key);

    if (!pop) {
      pop = {
        contentKey: key,
        rawScore: 0,
        decayedScore: 0,
        hitCount: 0,
        missCount: 0,
        hitRate: 0,
        lastAccessedAt: now,
        firstSeenAt: now,
        accessHistory: [],
        trend: 'rising',
        predictedHitsNextHour: 0,
      };
      this.popularityMap.set(key, pop);
    }

    pop.hitCount += hits;
    pop.rawScore += hits;
    pop.hitRate = parseFloat(
      ((pop.hitCount / (pop.hitCount + pop.missCount || 1)) * 100).toFixed(2),
    );
    pop.lastAccessedAt = now;
    pop.accessHistory.push({ timestamp: now, hits });
    // Keep only last 48 hourly buckets
    if (pop.accessHistory.length > 48) pop.accessHistory.shift();

    // Recompute decayed score
    pop.decayedScore = this.computeDecayedScore(pop.rawScore, pop.lastAccessedAt);

    // Trend: compare last 2 hours vs prior 2 hours
    const recentCutoff = new Date(now.getTime() - 2 * 3_600_000);
    const olderCutoff = new Date(now.getTime() - 4 * 3_600_000);
    const recentHits = pop.accessHistory
      .filter((a) => a.timestamp >= recentCutoff)
      .reduce((s, a) => s + a.hits, 0);
    const olderHits = pop.accessHistory
      .filter((a) => a.timestamp >= olderCutoff && a.timestamp < recentCutoff)
      .reduce((s, a) => s + a.hits, 0);
    pop.trend = recentHits > olderHits * 1.1 ? 'rising' : recentHits < olderHits * 0.9 ? 'declining' : 'stable';

    // Simple linear prediction for next hour
    const lastTwoHours = pop.accessHistory.slice(-2).reduce((s, a) => s + a.hits, 0);
    pop.predictedHitsNextHour = Math.round(lastTwoHours / 2);

    this.metrics.hitCount += hits;
    return pop;
  }

  recordMiss(key: string): void {
    const pop = this.popularityMap.get(key);
    if (pop) {
      pop.missCount++;
      pop.hitRate = parseFloat(
        ((pop.hitCount / (pop.hitCount + pop.missCount)) * 100).toFixed(2),
      );
    }
    this.metrics.missCount++;
  }

  private computeDecayedScore(rawScore: number, lastAccessed: Date): number {
    const hoursAgo = (Date.now() - lastAccessed.getTime()) / 3_600_000;
    const decayFactor = Math.pow(0.5, hoursAgo / this.DECAY_HALF_LIFE_HOURS);
    return parseFloat((rawScore * decayFactor).toFixed(4));
  }

  // ─── Dependency Graph ─────────────────────────────────────────────────────

  buildDependencyGraph(deps: Record<string, string[]>): DependencyGraph {
    this.dependencyGraph = {
      nodes: new Map(),
      adjacencyList: {},
      reverseAdjacencyList: {},
    };

    // First pass: create all nodes
    const allKeys = new Set([...Object.keys(deps), ...Object.values(deps).flat()]);
    for (const key of allKeys) {
      if (!this.dependencyGraph.nodes.has(key)) {
        this.dependencyGraph.nodes.set(key, {
          key,
          dependencies: [],
          dependents: [],
          invalidateOnChange: true,
        });
      }
      this.dependencyGraph.adjacencyList[key] = [];
      this.dependencyGraph.reverseAdjacencyList[key] = [];
    }

    // Second pass: set edges
    for (const [key, depKeys] of Object.entries(deps)) {
      const node = this.dependencyGraph.nodes.get(key)!;
      node.dependencies = depKeys;
      this.dependencyGraph.adjacencyList[key] = depKeys;
      for (const dep of depKeys) {
        const depNode = this.dependencyGraph.nodes.get(dep);
        if (depNode) depNode.dependents.push(key);
        if (!this.dependencyGraph.reverseAdjacencyList[dep]) {
          this.dependencyGraph.reverseAdjacencyList[dep] = [];
        }
        this.dependencyGraph.reverseAdjacencyList[dep].push(key);
      }
    }

    logger.info('Dependency graph built', { nodes: this.dependencyGraph.nodes.size });
    return this.dependencyGraph;
  }

  // ─── Topological Sort ─────────────────────────────────────────────────────

  private topologicalSort(keys: string[]): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (key: string, visiting: Set<string>) => {
      if (visiting.has(key)) return; // cycle guard
      if (visited.has(key)) return;
      visiting.add(key);
      const deps = this.dependencyGraph.adjacencyList[key] ?? [];
      for (const dep of deps) visit(dep, visiting);
      visiting.delete(key);
      visited.add(key);
      result.push(key);
    };

    for (const key of keys) visit(key, new Set());
    return result;
  }

  // ─── Dependency Invalidation ──────────────────────────────────────────────

  invalidateDependencies(changedKey: string): string[] {
    const toInvalidate = new Set<string>();
    const queue = [changedKey];

    while (queue.length > 0) {
      const key = queue.shift()!;
      if (toInvalidate.has(key)) continue;
      toInvalidate.add(key);
      const dependents = this.dependencyGraph.reverseAdjacencyList[key] ?? [];
      for (const dep of dependents) queue.push(dep);
    }

    const invalidated: string[] = [];
    for (const key of toInvalidate) {
      cache.delete(key);
      const node = this.dependencyGraph.nodes.get(key);
      if (node) node.lastInvalidatedAt = new Date();
      invalidated.push(key);
    }

    logger.info('Cache invalidated via dependency graph', {
      changedKey,
      invalidatedCount: invalidated.length,
      keys: invalidated,
    });
    return invalidated;
  }

  // ─── Adaptive TTL ─────────────────────────────────────────────────────────

  calculateAdaptiveTTL(contentKey: string, currentUpdateFreqSeconds?: number): TTLConfig {
    let config = this.ttlConfigs.get(contentKey);
    if (!config) {
      config = {
        contentKey,
        baseTTL: 300,
        adaptedTTL: 300,
        updateFrequencySeconds: currentUpdateFreqSeconds ?? 3600,
        volatility: 'medium',
        lastUpdatedAt: new Date(),
        updateCount: 0,
        reason: 'default',
      };
      this.ttlConfigs.set(contentKey, config);
    }

    if (currentUpdateFreqSeconds !== undefined) {
      config.updateFrequencySeconds = currentUpdateFreqSeconds;
      config.updateCount++;
    }

    const freq = config.updateFrequencySeconds;
    let adaptedTTL: number;
    let volatility: TTLConfig['volatility'];
    let reason: string;

    if (freq <= 60) {
      // Very frequently updated – short TTL
      adaptedTTL = Math.max(30, freq * 0.5);
      volatility = 'high';
      reason = 'high-frequency updates';
    } else if (freq <= 600) {
      // Moderately updated
      adaptedTTL = Math.round(freq * 0.75);
      volatility = 'medium';
      reason = 'moderate update frequency';
    } else if (freq <= 3600) {
      // Hourly-ish
      adaptedTTL = Math.round(freq * 0.9);
      volatility = 'medium';
      reason = 'low-frequency updates';
    } else {
      // Rarely updated – can cache aggressively
      adaptedTTL = Math.min(86_400, Math.round(freq * 0.95));
      volatility = 'low';
      reason = 'rarely updated content';
    }

    // Popularity bonus: popular content gets longer TTL (already warmed)
    const pop = this.popularityMap.get(contentKey);
    if (pop && pop.decayedScore > 1000) {
      adaptedTTL = Math.round(adaptedTTL * 1.3);
      reason += ' + popularity boost';
    }

    config.adaptedTTL = adaptedTTL;
    config.volatility = volatility;
    config.reason = reason;
    config.lastUpdatedAt = new Date();

    return config;
  }

  // ─── Cache Hit Rate Optimization ─────────────────────────────────────────

  optimizeHitRate(): {
    recommendations: Array<{ key: string; action: string; expectedImpact: string }>;
    projectedHitRateImprovement: number;
  } {
    const recommendations: Array<{ key: string; action: string; expectedImpact: string }> = [];
    let impact = 0;

    for (const [key, pop] of this.popularityMap) {
      if (pop.hitRate < 50 && pop.hitCount > 10) {
        const ttlConfig = this.ttlConfigs.get(key);
        if (ttlConfig && ttlConfig.adaptedTTL < 60) {
          recommendations.push({
            key,
            action: `Increase TTL from ${ttlConfig.adaptedTTL}s to ${ttlConfig.adaptedTTL * 3}s`,
            expectedImpact: `+${Math.round((50 - pop.hitRate) * 0.4)}% hit rate improvement`,
          });
          impact += (50 - pop.hitRate) * 0.4;
        }
      }

      if (pop.trend === 'rising' && pop.predictedHitsNextHour > 100) {
        recommendations.push({
          key,
          action: 'Pre-warm immediately due to rising traffic trend',
          expectedImpact: `Prevent ~${pop.predictedHitsNextHour} cache misses`,
        });
        impact += 5;
      }

      if (pop.missCount > pop.hitCount && pop.decayedScore > 100) {
        recommendations.push({
          key,
          action: 'Schedule aggressive pre-warming for high-miss-rate key',
          expectedImpact: `Hit rate improvement from ${pop.hitRate.toFixed(1)}% to ~${Math.min(95, pop.hitRate + 30).toFixed(1)}%`,
        });
        impact += 10;
      }
    }

    return {
      recommendations: recommendations.slice(0, 20),
      projectedHitRateImprovement: parseFloat(Math.min(impact, 40).toFixed(2)),
    };
  }

  // ─── Warming Strategy Execution ───────────────────────────────────────────

  async runWarmingStrategy(strategy: WarmingStrategy, loaderFn?: (key: string) => Promise<unknown>): Promise<CacheWarmingJob[]> {
    const jobs: CacheWarmingJob[] = [];
    const keys = this.selectKeysForStrategy(strategy);
    logger.info('Running warming strategy', { strategy: strategy.name, keyCount: keys.length });

    for (const key of keys) {
      const ttlConfig = this.calculateAdaptiveTTL(key);
      const job: CacheWarmingJob = {
        id: `warm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        contentKey: key,
        priority: this.popularityMap.get(key)?.decayedScore ?? 0,
        strategy: strategy.name,
        scheduledAt: new Date(),
        status: 'running',
        ttl: ttlConfig.adaptedTTL,
        attempts: 1,
        maxAttempts: 3,
      };
      job.startedAt = new Date();

      try {
        if (loaderFn) {
          const value = await loaderFn(key);
          cache.set(key, value, ttlConfig.adaptedTTL);
        } else {
          // Simulate warming
          cache.set(key, { warmed: true, at: new Date().toISOString() }, ttlConfig.adaptedTTL);
        }
        job.status = 'done';
        job.completedAt = new Date();
        this.metrics.warmingJobsCompleted++;
        const durationMs = job.completedAt.getTime() - job.startedAt.getTime();
        this.metrics.warmingTimesMs.push(durationMs);
      } catch (err: unknown) {
        job.status = 'failed';
        job.errorMessage = err instanceof Error ? err.message : 'Warming failed';
        this.metrics.warmingJobsFailed++;
        logger.error('Cache warming job failed', { key, error: job.errorMessage });
      }

      this.warmingJobs.set(job.id, job);
      jobs.push(job);
    }
    return jobs;
  }

  private selectKeysForStrategy(strategy: WarmingStrategy): string[] {
    const allKeys = Array.from(this.popularityMap.keys());

    switch (strategy.name) {
      case 'popularity': {
        const minScore = (strategy.config.minScore as number) ?? 10;
        const topN = (strategy.config.topN as number) ?? 50;
        return Array.from(this.popularityMap.values())
          .filter((p) => p.decayedScore >= minScore)
          .sort((a, b) => b.decayedScore - a.decayedScore)
          .slice(0, topN)
          .map((p) => p.contentKey);
      }

      case 'time_based': {
        const now = new Date();
        const minutesBefore = (strategy.config.minutesBefore as number) ?? 15;
        const peakThreshold = (strategy.config.peakThreshold as number) ?? 1.5;
        const targetHour = new Date(now.getTime() + minutesBefore * 60_000).getHours();
        const isPeakSoon = this.trafficPatterns.some(
          (p) => p.hour === targetHour && p.dayOfWeek === now.getDay() && p.peakMultiplier >= peakThreshold,
        );
        return isPeakSoon ? allKeys : allKeys.filter((k) => (this.popularityMap.get(k)?.decayedScore ?? 0) > 500);
      }

      case 'dependency_aware': {
        const sorted = this.topologicalSort(allKeys);
        return sorted; // warm in dependency order (dependencies first)
      }

      case 'lru_evict': {
        const windowMs = (strategy.config.evictionWindowMs as number) ?? 600_000;
        const cutoff = new Date(Date.now() - windowMs);
        return Array.from(this.popularityMap.values())
          .filter((p) => p.lastAccessedAt < cutoff && p.decayedScore > 50)
          .sort((a, b) => b.decayedScore - a.decayedScore)
          .map((p) => p.contentKey);
      }

      case 'hybrid': {
        const popWeight = (strategy.config.popularityWeight as number) ?? 0.6;
        const trafficWeight = (strategy.config.trafficWeight as number) ?? 0.4;
        const now = new Date();
        const patternScore = (key: string) => {
          const nextHour = (now.getHours() + 1) % 24;
          const pattern = this.trafficPatterns.find(
            (p) => p.hour === nextHour && p.dayOfWeek === now.getDay(),
          );
          const pop = this.popularityMap.get(key);
          return (
            popWeight * (pop?.decayedScore ?? 0) +
            trafficWeight * ((pattern?.peakMultiplier ?? 1) * (pop?.hitCount ?? 0))
          );
        };
        return allKeys.sort((a, b) => patternScore(b) - patternScore(a)).slice(0, 30);
      }

      default:
        return allKeys;
    }
  }

  // ─── Scheduling ───────────────────────────────────────────────────────────

  scheduleWarming(
    contentKey: string,
    intervalMs: number,
    strategy: WarmingStrategy['name'] = 'popularity',
    loaderFn?: (key: string) => Promise<unknown>,
  ): WarmingScheduleEntry {
    const entry: WarmingScheduleEntry = {
      contentKey,
      nextWarmAt: new Date(Date.now() + intervalMs),
      intervalMs,
      strategy,
      enabled: true,
    };
    this.scheduledEntries.set(contentKey, entry);

    const schedule = () => {
      if (!this.scheduledEntries.get(contentKey)?.enabled) return;
      const strat = this.strategies.find((s) => s.name === strategy) ?? this.strategies[0];
      this.runWarmingStrategy({ ...strat, config: { ...strat.config, keys: [contentKey] } }, loaderFn)
        .then(() => {
          const upd = this.scheduledEntries.get(contentKey);
          if (upd) upd.nextWarmAt = new Date(Date.now() + intervalMs);
          const t = setTimeout(schedule, intervalMs);
          this.scheduledTimers.set(contentKey, t);
        })
        .catch((err) => logger.error('Scheduled warming error', { contentKey, err }));
    };

    const timer = setTimeout(schedule, intervalMs);
    this.scheduledTimers.set(contentKey, timer);
    logger.info('Cache warming scheduled', { contentKey, intervalMs, strategy });
    return entry;
  }

  cancelScheduledWarming(contentKey: string): boolean {
    const entry = this.scheduledEntries.get(contentKey);
    if (entry) entry.enabled = false;
    const timer = this.scheduledTimers.get(contentKey);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimers.delete(contentKey);
      return true;
    }
    return false;
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────

  getCacheMetrics(): CacheMetrics {
    const cacheKey = 'cache-warmer:metrics';
    const cached = cache.get<CacheMetrics>(cacheKey);
    if (cached) return cached;

    const totalHits = this.metrics.hitCount;
    const totalMisses = this.metrics.missCount;
    const total = totalHits + totalMisses;
    const hitRate = total > 0 ? parseFloat(((totalHits / total) * 100).toFixed(2)) : 0;
    const missRate = 100 - hitRate;
    const avgWarmMs =
      this.metrics.warmingTimesMs.length > 0
        ? Math.round(
            this.metrics.warmingTimesMs.reduce((a, b) => a + b, 0) /
              this.metrics.warmingTimesMs.length,
          )
        : 0;

    const topHotKeys = Array.from(this.popularityMap.values())
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10)
      .map((p) => ({ key: p.contentKey, hits: p.hitCount, hitRate: p.hitRate }));

    const coldKeys = Array.from(this.popularityMap.values())
      .filter((p) => p.hitRate < 40)
      .sort((a, b) => a.hitRate - b.hitRate)
      .slice(0, 10)
      .map((p) => ({ key: p.contentKey, missRate: 100 - p.hitRate }));

    const ttlDist: Record<string, number> = { '<60s': 0, '1-5min': 0, '5-30min': 0, '30min+': 0 };
    for (const cfg of this.ttlConfigs.values()) {
      if (cfg.adaptedTTL < 60) ttlDist['<60s']++;
      else if (cfg.adaptedTTL < 300) ttlDist['1-5min']++;
      else if (cfg.adaptedTTL < 1800) ttlDist['5-30min']++;
      else ttlDist['30min+']++;
    }

    const stratPerf: Record<string, { jobs: number; successRate: number }> = {};
    for (const job of this.warmingJobs.values()) {
      if (!stratPerf[job.strategy]) stratPerf[job.strategy] = { jobs: 0, successRate: 0 };
      stratPerf[job.strategy].jobs++;
    }
    for (const [strat, data] of Object.entries(stratPerf)) {
      const stratJobs = Array.from(this.warmingJobs.values()).filter((j) => j.strategy === strat);
      const successJobs = stratJobs.filter((j) => j.status === 'done').length;
      data.successRate = stratJobs.length > 0 ? parseFloat(((successJobs / stratJobs.length) * 100).toFixed(2)) : 0;
    }

    const metrics: CacheMetrics = {
      generatedAt: new Date(),
      totalKeys: this.popularityMap.size,
      hitCount: totalHits,
      missCount: totalMisses,
      hitRate,
      missRate,
      warmingJobsCompleted: this.metrics.warmingJobsCompleted,
      warmingJobsFailed: this.metrics.warmingJobsFailed,
      averageWarmingTimeMs: avgWarmMs,
      totalBytesServedFromCache: this.metrics.bytesServed,
      topHotKeys,
      coldKeys,
      ttlDistribution: ttlDist,
      strategyPerformance: stratPerf,
    };

    cache.set(cacheKey, metrics, 60);
    return metrics;
  }

  // ─── Traffic Pattern Utilities ────────────────────────────────────────────

  getTrafficPattern(hour: number, dayOfWeek: number): TrafficPattern | undefined {
    return this.trafficPatterns.find((p) => p.hour === hour && p.dayOfWeek === dayOfWeek);
  }

  predictPeakHours(dayOfWeek: number, topN = 3): TrafficPattern[] {
    return this.trafficPatterns
      .filter((p) => p.dayOfWeek === dayOfWeek)
      .sort((a, b) => b.peakMultiplier - a.peakMultiplier)
      .slice(0, topN);
  }

  getStrategies(): WarmingStrategy[] { return this.strategies; }
  getWarmingJobs(status?: CacheWarmingJob['status']): CacheWarmingJob[] {
    const jobs = Array.from(this.warmingJobs.values());
    return status ? jobs.filter((j) => j.status === status) : jobs;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getIntelligentCacheWarmer(): IntelligentCacheWarmer {
  if (!(globalThis as any).__intelligentCacheWarmer__) {
    (globalThis as any).__intelligentCacheWarmer__ = new IntelligentCacheWarmer();
  }
  return (globalThis as any).__intelligentCacheWarmer__;
}
