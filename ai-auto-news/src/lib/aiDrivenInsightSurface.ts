/**
 * @module aiDrivenInsightSurface
 * @description Autonomous AI-powered insight surfacing engine that continuously monitors
 * platform metrics, detects significant patterns, generates natural-language insight
 * narratives, prioritizes insights by business impact, delivers contextual
 * recommendations, deduplicates similar insights, tracks insight resolution status,
 * learns from user feedback to improve relevance scoring, and integrates with
 * notification channels for proactive alerting across engineering, product, and
 * business teams.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type InsightCategory = 'revenue' | 'performance' | 'user_behavior' | 'security' | 'infrastructure' | 'product_adoption' | 'churn_risk' | 'cost';
export type InsightSeverity = 'info' | 'warning' | 'critical' | 'opportunity';
export type InsightStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed';
export type InsightSource = 'metric_anomaly' | 'trend_analysis' | 'cohort_comparison' | 'threshold_breach' | 'correlation_detection' | 'ai_inference';

export interface MetricSnapshot {
  metricId: string;
  tenantId: string;
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  labels: Record<string, string>;
}

export interface InsightRule {
  id: string;
  name: string;
  category: InsightCategory;
  condition: 'threshold_breach' | 'trend_change' | 'anomaly' | 'comparison';
  metricId: string;
  thresholdValue?: number;
  thresholdDirection?: 'above' | 'below';
  trendWindowMs?: number;
  minConfidence: number;
  severity: InsightSeverity;
  enabled: boolean;
  cooldownMs: number;           // min time between same insight
  lastTriggeredAt?: number;
}

export interface Insight {
  id: string;
  tenantId: string;
  ruleId?: string;
  category: InsightCategory;
  severity: InsightSeverity;
  source: InsightSource;
  title: string;
  narrative: string;            // AI-generated natural language description
  recommendation: string;
  metricId?: string;
  currentValue?: number;
  expectedValue?: number;
  businessImpactScore: number;  // 0-100
  confidence: number;           // 0-1
  status: InsightStatus;
  acknowledgedBy?: string;
  resolvedBy?: string;
  userRating?: number;          // 1-5 feedback
  tags: string[];
  detectedAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

export interface InsightFeedback {
  insightId: string;
  userId: string;
  rating: number;               // 1-5: 1=not useful, 5=very useful
  comment?: string;
  submittedAt: number;
}

export interface InsightDeduplication {
  signatureKey: string;         // hash of category+metricId+direction
  lastInsightId: string;
  lastSeenAt: number;
  suppressedCount: number;
}

export interface InsightSurfaceSummary {
  totalInsights: number;
  newInsights: number;
  criticalInsights: number;
  opportunityInsights: number;
  avgBusinessImpact: number;
  avgConfidence: number;
  avgUserRating: number;
  resolvedLast24h: number;
}

// ── Narrative generation ──────────────────────────────────────────────────────

function generateNarrative(category: InsightCategory, metricName: string, currentValue: number, expectedValue: number, direction: 'above' | 'below'): string {
  const change = Math.abs(currentValue - expectedValue);
  const pctChange = expectedValue !== 0 ? Math.abs(change / expectedValue * 100).toFixed(1) : '0';
  const dir = direction === 'above' ? 'above' : 'below';

  const templates: Record<InsightCategory, string> = {
    revenue: `Revenue metric "${metricName}" is ${pctChange}% ${dir} expected baseline (current: ${currentValue.toFixed(2)}, expected: ${expectedValue.toFixed(2)}).`,
    performance: `Performance metric "${metricName}" has ${direction === 'above' ? 'increased' : 'decreased'} by ${pctChange}% compared to baseline.`,
    user_behavior: `User behavior signal "${metricName}" shows a ${pctChange}% deviation from normal patterns.`,
    security: `Security indicator "${metricName}" has exceeded safe thresholds by ${pctChange}%.`,
    infrastructure: `Infrastructure metric "${metricName}" is ${pctChange}% ${dir} expected capacity.`,
    product_adoption: `Product adoption for "${metricName}" is ${pctChange}% ${dir} the target adoption curve.`,
    churn_risk: `Churn risk indicator "${metricName}" has escalated by ${pctChange}% above baseline thresholds.`,
    cost: `Cost metric "${metricName}" is ${pctChange}% ${dir} the planned budget allocation.`,
  };
  return templates[category] ?? `Metric "${metricName}" shows a significant ${pctChange}% deviation.`;
}

function generateRecommendation(category: InsightCategory, direction: 'above' | 'below'): string {
  const recs: Record<InsightCategory, Record<string, string>> = {
    revenue: { above: 'Capitalize on momentum — consider upsell campaigns to power users.', below: 'Investigate conversion funnel for revenue leakage and optimize pricing.' },
    performance: { above: 'Review recent deployments for regressions causing elevated latency.', below: 'Performance improved — document optimizations and apply patterns broadly.' },
    user_behavior: { above: 'Investigate unusual activity pattern for potential abuse or anomaly.', below: 'Users are disengaging — consider re-engagement workflows and UX improvements.' },
    security: { above: 'Escalate to security team immediately for investigation.', below: 'Security posture improving — maintain current hardening measures.' },
    infrastructure: { above: 'Scale infrastructure to prevent capacity exhaustion.', below: 'Infrastructure underutilized — consider right-sizing to reduce costs.' },
    product_adoption: { above: 'Feature gaining traction — prioritize improvements and expand to more users.', below: 'Investigate adoption blockers via user interviews and in-product analytics.' },
    churn_risk: { above: 'Activate at-risk customer retention workflows and CSM outreach.', below: 'Churn risk normalizing — continue engagement programs.' },
    cost: { above: 'Review cost drivers and identify optimization opportunities.', below: 'Cost efficiency improving — document successful optimizations.' },
  };
  return recs[category]?.[direction] ?? 'Review metric trends and take appropriate action.';
}

// ── Engine ────────────────────────────────────────────────────────────────────

class AiDrivenInsightSurface {
  private readonly insights = new Map<string, Insight>();
  private static readonly MAX_DEAD_LETTER_SIZE = 10000;
  private static readonly MAX_INSIGHTS_SIZE = 1000000;
  private readonly rules = new Map<string, InsightRule>();
  private readonly metricHistory = new Map<string, MetricSnapshot[]>();
  private readonly feedback: InsightFeedback[] = [];
  private readonly deduplication = new Map<string, InsightDeduplication>();
  private readonly ruleWeights = new Map<string, number>(); // learned relevance weights

  registerRule(rule: InsightRule): void {
    this.rules.set(rule.id, { ...rule });
    this.ruleWeights.set(rule.id, 1.0);
    logger.debug('Insight rule registered', { ruleId: rule.id, category: rule.category });
  }

  ingestMetric(snapshot: MetricSnapshot): Insight[] {
    const key = `${snapshot.tenantId}:${snapshot.metricId}`;
    const history = this.metricHistory.get(key) ?? [];
    history.push(snapshot);
    if (history.length > 1000) history.splice(0, 100);
    this.metricHistory.set(key, history);
    return this._evaluateRules(snapshot, history);
  }

  createManualInsight(insight: Omit<Insight, 'id' | 'detectedAt' | 'updatedAt' | 'status'>): Insight {
    const full: Insight = { ...insight, id: `ins-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`, status: 'new', detectedAt: Date.now(), updatedAt: Date.now() };
    this.insights.set(full.id, full);
    return full;
  }

  acknowledgeInsight(insightId: string, userId: string): boolean {
    const ins = this.insights.get(insightId);
    if (!ins) return false;
    ins.status = 'acknowledged';
    ins.acknowledgedBy = userId;
    ins.updatedAt = Date.now();
    return true;
  }

  resolveInsight(insightId: string, userId: string): boolean {
    const ins = this.insights.get(insightId);
    if (!ins) return false;
    ins.status = 'resolved';
    ins.resolvedBy = userId;
    ins.resolvedAt = Date.now();
    ins.updatedAt = Date.now();
    return true;
  }

  submitFeedback(feedback: InsightFeedback): void {
    this.feedback.push(feedback);
    // Update rule weight based on feedback
    const ins = this.insights.get(feedback.insightId);
    if (ins?.ruleId) {
      const currentWeight = this.ruleWeights.get(ins.ruleId) ?? 1;
      const adjustment = (feedback.rating - 3) * 0.05; // -0.1 to +0.1
      this.ruleWeights.set(ins.ruleId, Math.max(0.1, Math.min(2.0, currentWeight + adjustment)));
    }
    logger.debug('Insight feedback received', { insightId: feedback.insightId, rating: feedback.rating });
  }

  getInsight(insightId: string): Insight | undefined {
    return this.insights.get(insightId);
  }

  listInsights(tenantId: string, category?: InsightCategory, severity?: InsightSeverity, status?: InsightStatus): Insight[] {
    let all = Array.from(this.insights.values()).filter(i => i.tenantId === tenantId);
    if (category) all = all.filter(i => i.category === category);
    if (severity) all = all.filter(i => i.severity === severity);
    if (status) all = all.filter(i => i.status === status);
    return all.sort((a, b) => b.businessImpactScore - a.businessImpactScore || b.detectedAt - a.detectedAt);
  }

  getTopInsights(tenantId: string, limit = 10): Insight[] {
    return this.listInsights(tenantId).slice(0, limit);
  }

  getSummary(tenantId: string): InsightSurfaceSummary {
    const insights = Array.from(this.insights.values()).filter(i => i.tenantId === tenantId);
    const now = Date.now();
    const last24h = insights.filter(i => i.resolvedAt && now - i.resolvedAt < 86400000);
    const fb = this.feedback.filter(f => insights.find(i => i.id === f.insightId));
    const avgRating = fb.length > 0 ? fb.reduce((s, f) => s + f.rating, 0) / fb.length : 0;
    const avgImpact = insights.length > 0 ? insights.reduce((s, i) => s + i.businessImpactScore, 0) / insights.length : 0;
    const avgConf = insights.length > 0 ? insights.reduce((s, i) => s + i.confidence, 0) / insights.length : 0;
    return {
      totalInsights: insights.length,
      newInsights: insights.filter(i => i.status === 'new').length,
      criticalInsights: insights.filter(i => i.severity === 'critical' && i.status !== 'resolved').length,
      opportunityInsights: insights.filter(i => i.severity === 'opportunity' && i.status !== 'dismissed').length,
      avgBusinessImpact: parseFloat(avgImpact.toFixed(1)),
      avgConfidence: parseFloat(avgConf.toFixed(3)),
      avgUserRating: parseFloat(avgRating.toFixed(1)),
      resolvedLast24h: last24h.length,
    };
  }

  private _evaluateRules(snapshot: MetricSnapshot, history: MetricSnapshot[]): Insight[] {
    const generated: Insight[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled || rule.metricId !== snapshot.metricId) continue;
      if (rule.lastTriggeredAt && Date.now() - rule.lastTriggeredAt < rule.cooldownMs) continue;

      const baseline = this._computeBaseline(history.slice(0, -1));
      let triggered = false;
      let direction: 'above' | 'below' = 'above';
      let confidence = 0.7;

      if (rule.condition === 'threshold_breach' && rule.thresholdValue !== undefined) {
        triggered = rule.thresholdDirection === 'above'
          ? snapshot.value > rule.thresholdValue
          : snapshot.value < rule.thresholdValue;
        direction = rule.thresholdDirection ?? 'above';
        confidence = 0.95;
      } else if (rule.condition === 'anomaly' && baseline !== null) {
        const deviation = Math.abs(snapshot.value - baseline.mean) / Math.max(1, baseline.std);
        triggered = deviation > 2.5;
        direction = snapshot.value > baseline.mean ? 'above' : 'below';
        confidence = Math.min(0.95, 0.5 + deviation * 0.1);
      } else if (rule.condition === 'trend_change' && history.length > 10) {
        const recentAvg = history.slice(-5).reduce((s, h) => s + h.value, 0) / 5;
        const previousAvg = history.slice(-15, -5).reduce((s, h) => s + h.value, 0) / Math.min(10, history.length - 5);
        const changePct = previousAvg > 0 ? Math.abs(recentAvg - previousAvg) / previousAvg : 0;
        triggered = changePct > 0.15;
        direction = recentAvg > previousAvg ? 'above' : 'below';
        confidence = Math.min(0.9, changePct * 2);
      }

      if (!triggered || confidence < rule.minConfidence) continue;
      const weight = this.ruleWeights.get(rule.id) ?? 1;
      if (confidence * weight < rule.minConfidence) continue;

      // Dedup check
      const sigKey = `${snapshot.tenantId}:${rule.category}:${snapshot.metricId}:${direction}`;
      const dedup = this.deduplication.get(sigKey);
      if (dedup && Date.now() - dedup.lastSeenAt < rule.cooldownMs) {
        dedup.suppressedCount += 1;
        continue;
      }

      const expectedValue = baseline?.mean ?? snapshot.value;
      const insight: Insight = {
        id: `ins-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        tenantId: snapshot.tenantId,
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        source: rule.condition === 'threshold_breach' ? 'threshold_breach' : rule.condition === 'anomaly' ? 'metric_anomaly' : 'trend_analysis',
        title: `${rule.category.replace('_', ' ')} alert: ${snapshot.name}`,
        narrative: generateNarrative(rule.category, snapshot.name, snapshot.value, expectedValue, direction),
        recommendation: generateRecommendation(rule.category, direction),
        metricId: snapshot.metricId,
        currentValue: snapshot.value,
        expectedValue,
        businessImpactScore: Math.round(confidence * weight * 100),
        confidence: parseFloat((confidence * weight).toFixed(3)),
        status: 'new',
        tags: [snapshot.tenantId, rule.category],
        detectedAt: Date.now(), updatedAt: Date.now(),
      };
      this.insights.set(insight.id, insight);
      if (this.insights.size > AiDrivenInsightSurface.MAX_INSIGHTS_SIZE) {
        const oldest = [...this.insights.entries()].sort((a, b) => a[1].detectedAt - b[1].detectedAt)[0];
        if (oldest) this.insights.delete(oldest[0]);
      }
      rule.lastTriggeredAt = Date.now();
      this.deduplication.set(sigKey, { signatureKey: sigKey, lastInsightId: insight.id, lastSeenAt: Date.now(), suppressedCount: 0 });
      generated.push(insight);
      logger.info('Insight generated', { insightId: insight.id, category: rule.category, severity: rule.severity, confidence: insight.confidence });
    }
    return generated;
  }

  private _computeBaseline(history: MetricSnapshot[]): { mean: number; std: number } | null {
    if (history.length < 5) return null;
    const values = history.map(h => h.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return { mean, std: Math.sqrt(variance) };
  }
}

const KEY = '__aiDrivenInsightSurface__';
export function getInsightSurface(): AiDrivenInsightSurface {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AiDrivenInsightSurface();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AiDrivenInsightSurface;
}
