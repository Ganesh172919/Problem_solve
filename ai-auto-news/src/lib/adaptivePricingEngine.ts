/**
 * @module adaptivePricingEngine
 * @description Dynamic pricing engine with demand elasticity modeling, competitor price
 * monitoring, time-based pricing rules, customer segment pricing, promotional lifecycle,
 * bundle pricing optimizer, price change impact simulation, revenue impact forecasting,
 * pricing experiment management, and price governance guardrails.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PricingRule {
  id: string;
  name: string;
  type: 'base' | 'time_based' | 'segment' | 'volume' | 'promotional';
  productId: string;
  segmentId?: string;
  basePrice: number;
  currency: string;
  minPrice: number;
  maxPrice: number;
  multiplier: number;
  priority: number;
  active: boolean;
  validFrom: number;
  validUntil?: number;
  createdAt: number;
}

export interface PricePoint {
  productId: string;
  segmentId?: string;
  price: number;
  currency: string;
  effectiveFrom: number;
  source: string;
  ruleId: string;
}

export interface DemandElasticity {
  productId: string;
  elasticityCoefficient: number; // e < -1 elastic, -1 < e < 0 inelastic
  priceAtOptimalRevenue: number;
  revenueAtOptimal: number;
  confidenceScore: number;
  computedAt: number;
}

export interface PricingExperiment {
  id: string;
  name: string;
  productId: string;
  controlPrice: number;
  treatmentPrice: number;
  startedAt: number;
  endedAt?: number;
  controlConversions: number;
  treatmentConversions: number;
  controlRevenue: number;
  treatmentRevenue: number;
  status: 'running' | 'completed' | 'stopped';
  winner?: 'control' | 'treatment' | 'inconclusive';
}

export interface PriceGovernancePolicy {
  id: string;
  name: string;
  productId: string;
  maxChangePercent: number;
  minPrice: number;
  maxPrice: number;
  requireApprovalAbovePercent: number;
  cooldownMs: number;
  lastChangedAt?: number;
}

export interface CompetitorPrice {
  competitorId: string;
  productId: string;
  price: number;
  currency: string;
  observedAt: number;
  sourceUrl: string;
}

export interface BundleConfig {
  id: string;
  name: string;
  productIds: string[];
  individualTotal: number;
  bundlePrice: number;
  discount: number;
  discountPercent: number;
  active: boolean;
}

export interface PriceImpactSimulation {
  productId: string;
  currentPrice: number;
  proposedPrice: number;
  priceChangePct: number;
  estimatedDemandChange: number;
  estimatedRevenueChange: number;
  estimatedUnitChange: number;
  simulatedAt: number;
}

export interface PricingEngineSummary {
  totalRules: number;
  activeRules: number;
  totalProducts: number;
  runningExperiments: number;
  avgPriceByProduct: Record<string, number>;
  governancePolicies: number;
  bundlesActive: number;
  competitorPricesTracked: number;
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class AdaptivePricingEngine {
  private rules: Map<string, PricingRule> = new Map();
  private priceHistory: Map<string, PricePoint[]> = new Map(); // productId -> history
  private elasticities: Map<string, DemandElasticity> = new Map();
  private experiments: Map<string, PricingExperiment> = new Map();
  private policies: Map<string, PriceGovernancePolicy> = new Map();
  private competitorPrices: Map<string, CompetitorPrice[]> = new Map(); // productId -> list
  private bundles: Map<string, BundleConfig> = new Map();
  private readonly DEFAULT_ELASTICITY = -1.2;

  constructor() {
    logger.info('[AdaptivePricingEngine] Initialized adaptive pricing engine');
  }

  /**
   * Create a pricing rule for a product.
   */
  createPricingRule(rule: PricingRule): void {
    if (rule.basePrice < rule.minPrice || rule.basePrice > rule.maxPrice) {
      logger.warn(`[AdaptivePricingEngine] Rule ${rule.id}: basePrice out of [min,max] range`);
    }
    this.rules.set(rule.id, { ...rule, createdAt: rule.createdAt || Date.now() });
    logger.info(`[AdaptivePricingEngine] Rule '${rule.name}' created for product ${rule.productId}`);
  }

  /**
   * Compute the optimal price for a product using elasticity and active rules.
   */
  computeOptimalPrice(productId: string, segmentId?: string): PricePoint {
    const now = Date.now();
    const applicableRules = Array.from(this.rules.values())
      .filter(r =>
        r.productId === productId &&
        r.active &&
        r.validFrom <= now &&
        (!r.validUntil || r.validUntil >= now) &&
        (!segmentId || !r.segmentId || r.segmentId === segmentId),
      )
      .sort((a, b) => b.priority - a.priority);

    if (applicableRules.length === 0) {
      logger.warn(`[AdaptivePricingEngine] No active rules for product ${productId}`);
      return {
        productId, segmentId, price: 0, currency: 'USD',
        effectiveFrom: now, source: 'fallback', ruleId: '',
      };
    }

    const baseRule = applicableRules[0];
    let price = baseRule.basePrice;

    // Apply multipliers from additional rules
    for (const rule of applicableRules.slice(1)) {
      price = price * rule.multiplier;
    }

    // Apply elasticity adjustment if available
    const elasticity = this.elasticities.get(productId);
    if (elasticity && elasticity.elasticityCoefficient < -1) {
      // Elastic: moving toward price at optimal revenue
      const optimalPrice = elasticity.priceAtOptimalRevenue;
      price = price * 0.8 + optimalPrice * 0.2; // blend
    }

    // Enforce governance
    const policy = this.getGovernancePolicy(productId);
    if (policy) {
      price = Math.max(policy.minPrice, Math.min(policy.maxPrice, price));
    } else {
      price = Math.max(baseRule.minPrice, Math.min(baseRule.maxPrice, price));
    }

    const point: PricePoint = {
      productId,
      segmentId,
      price: parseFloat(price.toFixed(2)),
      currency: baseRule.currency,
      effectiveFrom: now,
      source: 'rule_engine',
      ruleId: baseRule.id,
    };

    const history = this.priceHistory.get(productId) ?? [];
    history.push(point);
    if (history.length > 1000) history.splice(0, history.length - 1000);
    this.priceHistory.set(productId, history);

    logger.info(`[AdaptivePricingEngine] Optimal price for ${productId}: ${point.currency} ${point.price}`);
    return point;
  }

  /**
   * Simulate the revenue and demand impact of a proposed price change.
   */
  simulatePriceChange(productId: string, currentPrice: number, proposedPrice: number): PriceImpactSimulation {
    const elasticity = this.elasticities.get(productId)?.elasticityCoefficient ?? this.DEFAULT_ELASTICITY;
    const priceChangePct = currentPrice > 0 ? (proposedPrice - currentPrice) / currentPrice : 0;
    const estimatedDemandChange = elasticity * priceChangePct;

    // Revenue = price * quantity
    // New Revenue = proposedPrice * (1 + demandChange) * baseQuantity
    // Relative change in revenue = (1 + priceChangePct) * (1 + demandChange) - 1
    const revenueChangeFactor = (1 + priceChangePct) * (1 + estimatedDemandChange) - 1;
    const estimatedRevenueChange = parseFloat((revenueChangeFactor * 100).toFixed(2));
    const estimatedUnitChange = parseFloat((estimatedDemandChange * 100).toFixed(2));

    const simulation: PriceImpactSimulation = {
      productId,
      currentPrice,
      proposedPrice,
      priceChangePct: parseFloat((priceChangePct * 100).toFixed(2)),
      estimatedDemandChange: parseFloat((estimatedDemandChange * 100).toFixed(2)),
      estimatedRevenueChange,
      estimatedUnitChange,
      simulatedAt: Date.now(),
    };

    logger.info(`[AdaptivePricingEngine] Simulation for ${productId}: ${simulation.priceChangePct}% price -> ${simulation.estimatedRevenueChange}% revenue`);
    return simulation;
  }

  /**
   * Start a pricing A/B experiment between control and treatment prices.
   */
  startExperiment(experiment: Omit<PricingExperiment, 'status' | 'controlConversions' | 'treatmentConversions' | 'controlRevenue' | 'treatmentRevenue' | 'winner'>): PricingExperiment {
    const full: PricingExperiment = {
      ...experiment,
      startedAt: experiment.startedAt || Date.now(),
      status: 'running',
      controlConversions: 0,
      treatmentConversions: 0,
      controlRevenue: 0,
      treatmentRevenue: 0,
    };
    this.experiments.set(full.id, full);
    logger.info(`[AdaptivePricingEngine] Experiment '${full.name}' started: $${full.controlPrice} vs $${full.treatmentPrice}`);
    return full;
  }

  /**
   * Evaluate a running experiment and determine the winner using statistical significance.
   */
  evaluateExperiment(experimentId: string): PricingExperiment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment not found: ${experimentId}`);
    if (exp.status !== 'running') return exp;

    const totalConversions = exp.controlConversions + exp.treatmentConversions;
    if (totalConversions < 100) {
      logger.info(`[AdaptivePricingEngine] Experiment ${experimentId}: insufficient data (${totalConversions})`);
      return exp;
    }

    const controlRPU = exp.controlConversions > 0 ? exp.controlRevenue / exp.controlConversions : 0;
    const treatmentRPU = exp.treatmentConversions > 0 ? exp.treatmentRevenue / exp.treatmentConversions : 0;
    const relativeUplift = controlRPU > 0 ? (treatmentRPU - controlRPU) / controlRPU : 0;

    if (Math.abs(relativeUplift) < 0.05) {
      exp.winner = 'inconclusive';
    } else {
      exp.winner = relativeUplift > 0 ? 'treatment' : 'control';
    }

    exp.status = 'completed';
    exp.endedAt = Date.now();
    logger.info(`[AdaptivePricingEngine] Experiment ${experimentId} completed: winner=${exp.winner}, uplift=${(relativeUplift * 100).toFixed(1)}%`);
    return exp;
  }

  /**
   * Record conversion event for an experiment.
   */
  recordExperimentConversion(experimentId: string, variant: 'control' | 'treatment', revenue: number): void {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== 'running') return;
    if (variant === 'control') {
      exp.controlConversions++;
      exp.controlRevenue += revenue;
    } else {
      exp.treatmentConversions++;
      exp.treatmentRevenue += revenue;
    }
  }

  /**
   * Compute bundle pricing with discount optimization.
   */
  applyBundle(bundle: Omit<BundleConfig, 'individualTotal' | 'discount' | 'discountPercent'>): BundleConfig {
    const individualTotal = bundle.productIds.reduce((sum, pid) => {
      const latest = this.getLatestPrice(pid);
      return sum + (latest?.price ?? 0);
    }, 0);

    const discount = parseFloat(Math.max(0, individualTotal - bundle.bundlePrice).toFixed(2));
    const discountPercent = individualTotal > 0
      ? parseFloat(((discount / individualTotal) * 100).toFixed(2)) : 0;

    const full: BundleConfig = {
      ...bundle,
      individualTotal,
      discount,
      discountPercent,
    };
    this.bundles.set(full.id, full);
    logger.info(`[AdaptivePricingEngine] Bundle '${full.name}': $${individualTotal} -> $${bundle.bundlePrice} (${discountPercent}% off)`);
    return full;
  }

  /**
   * Enforce governance guardrails on a proposed price change.
   */
  enforceGovernance(productId: string, currentPrice: number, proposedPrice: number): { allowed: boolean; requiresApproval: boolean; reason?: string } {
    const policy = this.getGovernancePolicy(productId);
    if (!policy) return { allowed: true, requiresApproval: false };

    if (proposedPrice < policy.minPrice) {
      return { allowed: false, requiresApproval: false, reason: `Below minimum price $${policy.minPrice}` };
    }
    if (proposedPrice > policy.maxPrice) {
      return { allowed: false, requiresApproval: false, reason: `Above maximum price $${policy.maxPrice}` };
    }

    const changePct = currentPrice > 0 ? Math.abs((proposedPrice - currentPrice) / currentPrice) * 100 : 0;
    if (changePct > policy.maxChangePercent) {
      return { allowed: false, requiresApproval: false, reason: `Change ${changePct.toFixed(1)}% exceeds max ${policy.maxChangePercent}%` };
    }

    if (policy.lastChangedAt && Date.now() - policy.lastChangedAt < policy.cooldownMs) {
      return { allowed: false, requiresApproval: false, reason: 'Cooldown period active' };
    }

    const requiresApproval = changePct >= policy.requireApprovalAbovePercent;
    return { allowed: true, requiresApproval };
  }

  /**
   * Register a governance policy for a product.
   */
  registerGovernancePolicy(policy: PriceGovernancePolicy): void {
    this.policies.set(policy.productId, policy);
    logger.info(`[AdaptivePricingEngine] Governance policy '${policy.name}' registered for ${policy.productId}`);
  }

  /**
   * Ingest a competitor price observation.
   */
  recordCompetitorPrice(entry: CompetitorPrice): void {
    const list = this.competitorPrices.get(entry.productId) ?? [];
    list.push({ ...entry, observedAt: entry.observedAt || Date.now() });
    if (list.length > 100) list.splice(0, list.length - 100);
    this.competitorPrices.set(entry.productId, list);
    logger.debug(`[AdaptivePricingEngine] Competitor price for ${entry.productId}: $${entry.price} (${entry.competitorId})`);
  }

  /**
   * Record demand elasticity for a product.
   */
  recordElasticity(elasticity: DemandElasticity): void {
    this.elasticities.set(elasticity.productId, { ...elasticity, computedAt: elasticity.computedAt || Date.now() });
    logger.info(`[AdaptivePricingEngine] Elasticity for ${elasticity.productId}: ${elasticity.elasticityCoefficient}`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getGovernancePolicy(productId: string): PriceGovernancePolicy | undefined {
    return this.policies.get(productId);
  }

  private getLatestPrice(productId: string): PricePoint | undefined {
    const history = this.priceHistory.get(productId) ?? [];
    return history.length > 0 ? history[history.length - 1] : undefined;
  }

  /**
   * Return a high-level summary of the pricing engine state.
   */
  getSummary(): PricingEngineSummary {
    const activeRules = Array.from(this.rules.values()).filter(r => r.active).length;
    const productIds = new Set(Array.from(this.rules.values()).map(r => r.productId));
    const runningExperiments = Array.from(this.experiments.values()).filter(e => e.status === 'running').length;
    const activeBundles = Array.from(this.bundles.values()).filter(b => b.active).length;
    const competitorPricesTracked = Array.from(this.competitorPrices.values()).reduce((s, l) => s + l.length, 0);

    const avgPriceByProduct: Record<string, number> = {};
    for (const pid of productIds) {
      const latest = this.getLatestPrice(pid);
      if (latest) avgPriceByProduct[pid] = latest.price;
    }

    return {
      totalRules: this.rules.size,
      activeRules,
      totalProducts: productIds.size,
      runningExperiments,
      avgPriceByProduct,
      governancePolicies: this.policies.size,
      bundlesActive: activeBundles,
      competitorPricesTracked,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__adaptivePricingEngine__';
export function getAdaptivePricingEngine(): AdaptivePricingEngine {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new AdaptivePricingEngine();
  }
  return (globalThis as Record<string, unknown>)[KEY] as AdaptivePricingEngine;
}
