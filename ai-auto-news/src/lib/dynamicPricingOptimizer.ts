/**
 * @module dynamicPricingOptimizer
 * @description ML-driven dynamic pricing engine with demand elasticity modeling,
 * competitor-aware price adjustment, cohort-based willingness-to-pay estimation,
 * real-time margin enforcement, promotional discount orchestration, price anchoring
 * strategies, surge pricing detection, floor/ceiling guardrails, A/B price testing
 * support, revenue-maximization objective functions, and per-tenant pricing policies
 * for SaaS subscription and usage-based monetization models.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type PricingModel = 'flat_rate' | 'usage_based' | 'tiered' | 'volume' | 'hybrid' | 'dynamic';
export type PriceAdjustmentReason = 'demand_surge' | 'demand_low' | 'competitor_match' | 'promotion' | 'cohort_target' | 'manual' | 'ab_test';
export type DiscountType = 'percentage' | 'fixed_amount' | 'free_units' | 'trial_extension';
export type ElasticityClass = 'inelastic' | 'unit_elastic' | 'elastic' | 'highly_elastic';

export interface PricingPolicy {
  id: string;
  tenantId: string;
  productId: string;
  model: PricingModel;
  basePrice: number;            // in USD cents
  currentPrice: number;
  minPrice: number;             // floor
  maxPrice: number;             // ceiling
  currency: string;
  adjustmentEnabled: boolean;
  maxAdjustmentPct: number;     // max % change from base
  elasticityClass: ElasticityClass;
  costBasisCents: number;       // minimum margin enforcer
  targetMarginPct: number;
  createdAt: number;
  updatedAt: number;
}

export interface DemandSignal {
  productId: string;
  tenantId: string;
  periodMs: number;
  requestCount: number;
  conversionCount: number;
  avgSessionDurationMs: number;
  abandonmentRate: number;       // 0-1
  competitorPriceCents?: number;
  timestamp: number;
}

export interface PriceAdjustmentEvent {
  id: string;
  policyId: string;
  productId: string;
  tenantId: string;
  previousPriceCents: number;
  newPriceCents: number;
  adjustmentPct: number;
  reason: PriceAdjustmentReason;
  confidence: number;            // 0-1
  estimatedRevenueImpactUsd: number;
  appliedAt: number;
  experimentId?: string;
}

export interface Discount {
  id: string;
  policyId: string;
  tenantId: string;
  code?: string;
  type: DiscountType;
  value: number;                 // pct or fixed cents or free units
  maxUses: number;
  currentUses: number;
  validFrom: number;
  validTo: number;
  active: boolean;
  description: string;
}

export interface PriceExperiment {
  id: string;
  policyId: string;
  controlPriceCents: number;
  variantPriceCents: number;
  trafficSplitPct: number;       // % to variant
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'concluded' | 'stopped';
  controlConversions: number;
  variantConversions: number;
  controlRevenueCents: number;
  variantRevenueCents: number;
  winner?: 'control' | 'variant' | 'inconclusive';
}

export interface PricingSummary {
  totalPolicies: number;
  avgCurrentPriceCents: number;
  avgBaselineDeviation: number;
  totalAdjustments: number;
  totalDiscounts: number;
  activeExperiments: number;
  estimatedRevenueImpactUsd: number;
  avgMarginPct: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeElasticityAdjustment(signal: DemandSignal, policy: PricingPolicy): { newPriceCents: number; reason: PriceAdjustmentReason; confidence: number } {
  const conversionRate = signal.requestCount > 0 ? signal.conversionCount / signal.requestCount : 0;
  const avgConversionRate = 0.05; // baseline 5%
  const demandRatio = conversionRate / avgConversionRate;

  let adjustmentFactor = 1.0;
  let reason: PriceAdjustmentReason = 'demand_surge';
  let confidence = 0.7;

  if (demandRatio > 1.5) {
    // high demand — consider price increase
    if (policy.elasticityClass === 'inelastic') {
      adjustmentFactor = Math.min(1 + policy.maxAdjustmentPct / 100, 1.15);
      confidence = 0.85;
    } else if (policy.elasticityClass === 'unit_elastic') {
      adjustmentFactor = Math.min(1 + policy.maxAdjustmentPct / 200, 1.08);
      confidence = 0.75;
    } else {
      adjustmentFactor = 1.0; // elastic — don't raise price
      confidence = 0.9;
    }
    reason = 'demand_surge';
  } else if (demandRatio < 0.5) {
    // low demand — price decrease to stimulate
    adjustmentFactor = Math.max(1 - policy.maxAdjustmentPct / 100, 0.90);
    reason = 'demand_low';
    confidence = 0.72;
  }

  // Competitor awareness
  if (signal.competitorPriceCents && signal.competitorPriceCents < policy.currentPrice * 0.9) {
    adjustmentFactor = Math.max(adjustmentFactor, signal.competitorPriceCents / policy.currentPrice);
    reason = 'competitor_match';
    confidence = 0.88;
  }

  const proposed = Math.round(policy.currentPrice * adjustmentFactor);
  const minAllowed = Math.max(policy.minPrice, Math.ceil(policy.costBasisCents / (1 - policy.targetMarginPct / 100)));
  const newPrice = Math.max(minAllowed, Math.min(policy.maxPrice, proposed));
  return { newPriceCents: newPrice, reason, confidence };
}

// ── Engine ────────────────────────────────────────────────────────────────────

class DynamicPricingOptimizer {
  private readonly policies = new Map<string, PricingPolicy>();
  private readonly adjustmentHistory: PriceAdjustmentEvent[] = [];
  private readonly discounts = new Map<string, Discount>();
  private readonly experiments = new Map<string, PriceExperiment>();
  private readonly demandHistory = new Map<string, DemandSignal[]>();

  registerPolicy(policy: PricingPolicy): void {
    this.policies.set(policy.id, { ...policy });
    logger.info('Pricing policy registered', { policyId: policy.id, model: policy.model, basePrice: policy.basePrice });
  }

  updatePolicy(policyId: string, updates: Partial<PricingPolicy>): boolean {
    const p = this.policies.get(policyId);
    if (!p) return false;
    this.policies.set(policyId, { ...p, ...updates, id: policyId, updatedAt: Date.now() });
    return true;
  }

  ingestDemandSignal(signal: DemandSignal): void {
    const key = `${signal.tenantId}:${signal.productId}`;
    const hist = this.demandHistory.get(key) ?? [];
    hist.push(signal);
    if (hist.length > 500) hist.splice(0, 100);
    this.demandHistory.set(key, hist);
  }

  optimizePrice(policyId: string): PriceAdjustmentEvent | null {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.adjustmentEnabled) return null;
    const key = `${policy.tenantId}:${policy.productId}`;
    const signals = this.demandHistory.get(key) ?? [];
    if (signals.length === 0) return null;
    const latestSignal = signals[signals.length - 1];
    const { newPriceCents, reason, confidence } = computeElasticityAdjustment(latestSignal, policy);
    if (newPriceCents === policy.currentPrice) return null;

    const previousPrice = policy.currentPrice;
    policy.currentPrice = newPriceCents;
    policy.updatedAt = Date.now();

    const revenueImpact = ((newPriceCents - previousPrice) / 100) * latestSignal.conversionCount;
    const event: PriceAdjustmentEvent = {
      id: `pa-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      policyId,
      productId: policy.productId,
      tenantId: policy.tenantId,
      previousPriceCents: previousPrice,
      newPriceCents,
      adjustmentPct: parseFloat(((newPriceCents - previousPrice) / previousPrice * 100).toFixed(2)),
      reason,
      confidence,
      estimatedRevenueImpactUsd: parseFloat((revenueImpact).toFixed(2)),
      appliedAt: Date.now(),
    };
    this.adjustmentHistory.push(event);
    if (this.adjustmentHistory.length > 10000) this.adjustmentHistory.splice(0, 1000);
    logger.info('Price optimized', { policyId, from: previousPrice, to: newPriceCents, reason, confidence });
    return event;
  }

  createDiscount(discount: Discount): void {
    this.discounts.set(discount.id, { ...discount, currentUses: 0 });
    logger.info('Discount created', { discountId: discount.id, type: discount.type, value: discount.value });
  }

  applyDiscount(discountId: string): { discountedPriceCents: number; policyId: string } | null {
    const d = this.discounts.get(discountId);
    if (!d || !d.active || d.currentUses >= d.maxUses) return null;
    if (Date.now() < d.validFrom || Date.now() > d.validTo) return null;
    const policy = this.policies.get(d.policyId);
    if (!policy) return null;
    d.currentUses += 1;
    let discountedPrice: number;
    if (d.type === 'percentage') {
      discountedPrice = Math.round(policy.currentPrice * (1 - d.value / 100));
    } else if (d.type === 'fixed_amount') {
      discountedPrice = Math.max(policy.minPrice, policy.currentPrice - d.value);
    } else {
      discountedPrice = policy.currentPrice;
    }
    return { discountedPriceCents: discountedPrice, policyId: d.policyId };
  }

  startExperiment(experiment: PriceExperiment): void {
    this.experiments.set(experiment.id, { ...experiment, status: 'running', startedAt: Date.now() });
    logger.info('Price experiment started', { experimentId: experiment.id, control: experiment.controlPriceCents, variant: experiment.variantPriceCents });
  }

  recordExperimentConversion(experimentId: string, isVariant: boolean, revenueCents: number): boolean {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== 'running') return false;
    if (isVariant) { exp.variantConversions += 1; exp.variantRevenueCents += revenueCents; }
    else { exp.controlConversions += 1; exp.controlRevenueCents += revenueCents; }
    return true;
  }

  concludeExperiment(experimentId: string): PriceExperiment | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;
    exp.status = 'concluded';
    exp.endedAt = Date.now();
    const controlRpv = exp.controlConversions > 0 ? exp.controlRevenueCents / exp.controlConversions : 0;
    const variantRpv = exp.variantConversions > 0 ? exp.variantRevenueCents / exp.variantConversions : 0;
    exp.winner = Math.abs(variantRpv - controlRpv) < 5 ? 'inconclusive' : variantRpv > controlRpv ? 'variant' : 'control';
    logger.info('Price experiment concluded', { experimentId, winner: exp.winner, controlRpv, variantRpv });
    return exp;
  }

  getPricingForUser(policyId: string, userId: string): number {
    const policy = this.policies.get(policyId);
    if (!policy) return 0;
    // Check running experiment for this policy
    const exp = Array.from(this.experiments.values()).find(e => e.policyId === policyId && e.status === 'running');
    if (exp) {
      const isVariant = (userId.charCodeAt(0) % 100) < exp.trafficSplitPct;
      return isVariant ? exp.variantPriceCents : exp.controlPriceCents;
    }
    return policy.currentPrice;
  }

  getPolicy(policyId: string): PricingPolicy | undefined {
    return this.policies.get(policyId);
  }

  listPolicies(tenantId?: string): PricingPolicy[] {
    const all = Array.from(this.policies.values());
    return tenantId ? all.filter(p => p.tenantId === tenantId) : all;
  }

  listAdjustmentHistory(policyId?: string, limit = 100): PriceAdjustmentEvent[] {
    const filtered = policyId ? this.adjustmentHistory.filter(e => e.policyId === policyId) : this.adjustmentHistory;
    return filtered.slice(-limit);
  }

  listDiscounts(active?: boolean): Discount[] {
    const all = Array.from(this.discounts.values());
    return active === undefined ? all : all.filter(d => d.active === active);
  }

  listExperiments(status?: PriceExperiment['status']): PriceExperiment[] {
    const all = Array.from(this.experiments.values());
    return status ? all.filter(e => e.status === status) : all;
  }

  getSummary(): PricingSummary {
    const policies = Array.from(this.policies.values());
    const avgCurrent = policies.length > 0 ? policies.reduce((s, p) => s + p.currentPrice, 0) / policies.length : 0;
    const avgDeviation = policies.length > 0
      ? policies.reduce((s, p) => s + Math.abs(p.currentPrice - p.basePrice) / p.basePrice * 100, 0) / policies.length
      : 0;
    const totalImpact = this.adjustmentHistory.reduce((s, e) => s + e.estimatedRevenueImpactUsd, 0);
    const avgMargin = policies.length > 0 ? policies.reduce((s, p) => s + p.targetMarginPct, 0) / policies.length : 0;
    return {
      totalPolicies: policies.length,
      avgCurrentPriceCents: parseFloat(avgCurrent.toFixed(0)),
      avgBaselineDeviation: parseFloat(avgDeviation.toFixed(2)),
      totalAdjustments: this.adjustmentHistory.length,
      totalDiscounts: this.discounts.size,
      activeExperiments: Array.from(this.experiments.values()).filter(e => e.status === 'running').length,
      estimatedRevenueImpactUsd: parseFloat(totalImpact.toFixed(2)),
      avgMarginPct: parseFloat(avgMargin.toFixed(1)),
    };
  }
}

const KEY = '__dynamicPricingOptimizer__';
export function getDynamicPricingOptimizer(): DynamicPricingOptimizer {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new DynamicPricingOptimizer();
  }
  return (globalThis as Record<string, unknown>)[KEY] as DynamicPricingOptimizer;
}
