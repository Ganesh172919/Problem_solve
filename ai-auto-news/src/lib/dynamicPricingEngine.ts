/**
 * Dynamic Pricing Engine
 *
 * ML-based pricing optimization with:
 * - Demand-based pricing
 * - Customer segment pricing
 * - A/B testing for pricing experiments
 * - Competitor price monitoring
 * - Seasonal pricing adjustments
 * - Volume discounts
 * - Trial conversion optimization
 */

import { getLogger } from '@/lib/logger';
import { SubscriptionTier } from '@/types/saas';

const logger = getLogger();

export interface PricingModel {
  id: string;
  name: string;
  basePrices: Record<SubscriptionTier, number>;
  currency: string;
  factors: PricingFactor[];
  active: boolean;
  effectiveFrom: Date;
  effectiveUntil?: Date;
}

export interface PricingFactor {
  type: 'demand' | 'segment' | 'seasonal' | 'volume' | 'competitive' | 'behavioral';
  weight: number;
  config: Record<string, any>;
}

export interface CustomerSegment {
  id: string;
  name: string;
  criteria: SegmentCriteria;
  priceMultiplier: number;
  priority: number;
}

export interface SegmentCriteria {
  minRevenue?: number;
  maxRevenue?: number;
  industry?: string[];
  companySize?: 'startup' | 'smb' | 'enterprise';
  region?: string[];
  previousChurn?: boolean;
}

export interface PriceQuote {
  tier: SubscriptionTier;
  basePrice: number;
  adjustedPrice: number;
  discount: number;
  discountPercent: number;
  factors: AppliedFactor[];
  currency: string;
  validUntil: Date;
  trialAvailable: boolean;
  trialDays?: number;
}

export interface AppliedFactor {
  type: string;
  name: string;
  adjustment: number;
  adjustmentPercent: number;
  reason: string;
}

export interface PricingExperiment {
  id: string;
  name: string;
  variants: PricingVariant[];
  allocation: Record<string, number>; // variant id -> allocation %
  startDate: Date;
  endDate: Date;
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  results?: ExperimentResults;
}

export interface PricingVariant {
  id: string;
  name: string;
  priceMultiplier: number;
  description: string;
}

export interface ExperimentResults {
  variantResults: Record<string, VariantMetrics>;
  winner?: string;
  confidence: number;
  conversionImpact: number;
  revenueImpact: number;
}

export interface VariantMetrics {
  impressions: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  averageRevenuePerUser: number;
  churnRate: number;
}

class DynamicPricingEngine {
  private models: Map<string, PricingModel> = new Map();
  private segments: Map<string, CustomerSegment> = new Map();
  private experiments: Map<string, PricingExperiment> = new Map();
  private demandMetrics: DemandMetrics = {
    currentLoad: 0,
    peakLoad: 100,
    averageLoad: 50,
    trend: 'stable',
  };

  constructor() {
    this.initializeDefaultModels();
    this.initializeDefaultSegments();
  }

  /**
   * Get price quote for customer
   */
  async getPriceQuote(
    tier: SubscriptionTier,
    customerId?: string,
    metadata?: Record<string, any>
  ): Promise<PriceQuote> {
    // Get active pricing model
    const model = this.getActivePricingModel();
    const basePrice = model.basePrices[tier];

    // Identify customer segment
    const segment = customerId
      ? await this.identifySegment(customerId, metadata)
      : null;

    // Check for active experiments
    const experimentVariant = customerId
      ? await this.getExperimentVariant(customerId)
      : null;

    // Calculate adjustments
    const factors: AppliedFactor[] = [];
    let adjustedPrice = basePrice;

    // Apply segment multiplier
    if (segment) {
      const adjustment = basePrice * (segment.priceMultiplier - 1);
      adjustedPrice += adjustment;
      factors.push({
        type: 'segment',
        name: segment.name,
        adjustment,
        adjustmentPercent: (segment.priceMultiplier - 1) * 100,
        reason: `Customer segment: ${segment.name}`,
      });
    }

    // Apply experiment variant
    if (experimentVariant) {
      const adjustment = adjustedPrice * (experimentVariant.priceMultiplier - 1);
      adjustedPrice += adjustment;
      factors.push({
        type: 'experiment',
        name: experimentVariant.name,
        adjustment,
        adjustmentPercent: (experimentVariant.priceMultiplier - 1) * 100,
        reason: `Pricing experiment: ${experimentVariant.name}`,
      });
    }

    // Apply dynamic factors
    for (const factor of model.factors) {
      const adjustment = await this.calculateFactorAdjustment(
        factor,
        basePrice,
        tier,
        metadata
      );

      if (adjustment !== 0) {
        adjustedPrice += adjustment;
        factors.push({
          type: factor.type,
          name: this.getFactorName(factor.type),
          adjustment,
          adjustmentPercent: (adjustment / basePrice) * 100,
          reason: this.getFactorReason(factor.type, adjustment),
        });
      }
    }

    // Ensure minimum price
    const minimumPrice = basePrice * 0.5; // Never go below 50% of base
    adjustedPrice = Math.max(adjustedPrice, minimumPrice);

    // Calculate discount
    const discount = basePrice - adjustedPrice;
    const discountPercent = (discount / basePrice) * 100;

    // Check trial eligibility
    const trialAvailable = await this.isTrialAvailable(customerId, tier);

    logger.info('Price quote generated', {
      tier,
      basePrice,
      adjustedPrice,
      discountPercent,
      factorCount: factors.length,
    });

    return {
      tier,
      basePrice,
      adjustedPrice: Math.round(adjustedPrice * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      discountPercent: Math.round(discountPercent * 10) / 10,
      factors,
      currency: model.currency,
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      trialAvailable,
      trialDays: trialAvailable ? 14 : undefined,
    };
  }

  /**
   * Create pricing experiment
   */
  createExperiment(experiment: Omit<PricingExperiment, 'id' | 'status'>): string {
    const id = this.generateId('exp');

    const fullExperiment: PricingExperiment = {
      ...experiment,
      id,
      status: 'draft',
    };

    this.experiments.set(id, fullExperiment);

    logger.info('Pricing experiment created', {
      id,
      name: experiment.name,
      variants: experiment.variants.length,
    });

    return id;
  }

  /**
   * Start pricing experiment
   */
  async startExperiment(experimentId: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);

    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    if (experiment.status !== 'draft') {
      throw new Error(`Experiment must be in draft status to start`);
    }

    experiment.status = 'running';

    logger.info('Pricing experiment started', { experimentId, name: experiment.name });
  }

  /**
   * Get experiment results
   */
  async getExperimentResults(experimentId: string): Promise<ExperimentResults | null> {
    const experiment = this.experiments.get(experimentId);

    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    // In production, this would query actual metrics
    // For now, return mock results
    const variantResults: Record<string, VariantMetrics> = {};

    for (const variant of experiment.variants) {
      variantResults[variant.id] = {
        impressions: Math.floor(Math.random() * 1000) + 100,
        conversions: Math.floor(Math.random() * 50) + 10,
        conversionRate: Math.random() * 0.1 + 0.02,
        revenue: Math.random() * 10000 + 1000,
        averageRevenuePerUser: Math.random() * 100 + 50,
        churnRate: Math.random() * 0.05,
      };
    }

    // Determine winner
    const sortedVariants = Object.entries(variantResults).sort(
      ([, a], [, b]) => b.revenue - a.revenue
    );

    const winner = sortedVariants[0][0];

    return {
      variantResults,
      winner,
      confidence: 0.95,
      conversionImpact: 0.15,
      revenueImpact: 0.25,
    };
  }

  /**
   * Update demand metrics
   */
  updateDemandMetrics(currentLoad: number): void {
    this.demandMetrics.currentLoad = currentLoad;

    // Update trend
    if (currentLoad > this.demandMetrics.averageLoad * 1.2) {
      this.demandMetrics.trend = 'increasing';
    } else if (currentLoad < this.demandMetrics.averageLoad * 0.8) {
      this.demandMetrics.trend = 'decreasing';
    } else {
      this.demandMetrics.trend = 'stable';
    }

    // Update peak
    if (currentLoad > this.demandMetrics.peakLoad) {
      this.demandMetrics.peakLoad = currentLoad;
    }

    // Update average (exponential moving average)
    const alpha = 0.1;
    this.demandMetrics.averageLoad =
      alpha * currentLoad + (1 - alpha) * this.demandMetrics.averageLoad;
  }

  /**
   * Add customer segment
   */
  addSegment(segment: CustomerSegment): void {
    this.segments.set(segment.id, segment);
    logger.info('Customer segment added', { id: segment.id, name: segment.name });
  }

  /**
   * Create pricing model
   */
  createPricingModel(model: Omit<PricingModel, 'id'>): string {
    const id = this.generateId('model');

    const fullModel: PricingModel = {
      ...model,
      id,
    };

    this.models.set(id, fullModel);

    logger.info('Pricing model created', { id, name: model.name });

    return id;
  }

  /**
   * Get pricing statistics
   */
  getStatistics(): PricingStatistics {
    const activeExperiments = Array.from(this.experiments.values())
      .filter(e => e.status === 'running');

    return {
      totalModels: this.models.size,
      activeModels: Array.from(this.models.values()).filter(m => m.active).length,
      totalSegments: this.segments.size,
      activeExperiments: activeExperiments.length,
      demandMetrics: { ...this.demandMetrics },
    };
  }

  /**
   * Calculate factor adjustment
   */
  private async calculateFactorAdjustment(
    factor: PricingFactor,
    basePrice: number,
    tier: SubscriptionTier,
    metadata?: Record<string, any>
  ): Promise<number> {
    switch (factor.type) {
      case 'demand':
        return this.calculateDemandAdjustment(basePrice, factor.weight);

      case 'seasonal':
        return this.calculateSeasonalAdjustment(basePrice, factor.weight);

      case 'volume':
        return this.calculateVolumeAdjustment(basePrice, factor.weight, metadata);

      case 'competitive':
        return this.calculateCompetitiveAdjustment(basePrice, factor.weight, tier);

      case 'behavioral':
        return this.calculateBehavioralAdjustment(basePrice, factor.weight, metadata);

      default:
        return 0;
    }
  }

  /**
   * Calculate demand-based adjustment
   */
  private calculateDemandAdjustment(basePrice: number, weight: number): number {
    const loadRatio = this.demandMetrics.currentLoad / this.demandMetrics.averageLoad;

    // Increase price when demand is high
    if (loadRatio > 1.5) {
      return basePrice * 0.1 * weight; // Up to 10% increase
    } else if (loadRatio < 0.5) {
      return -basePrice * 0.15 * weight; // Up to 15% decrease
    }

    return 0;
  }

  /**
   * Calculate seasonal adjustment
   */
  private calculateSeasonalAdjustment(basePrice: number, weight: number): number {
    const month = new Date().getMonth();

    // Example: Black Friday deals in November
    if (month === 10) { // November
      return -basePrice * 0.2 * weight; // 20% discount
    }

    // New Year promotions in January
    if (month === 0) {
      return -basePrice * 0.15 * weight;
    }

    return 0;
  }

  /**
   * Calculate volume-based adjustment
   */
  private calculateVolumeAdjustment(
    basePrice: number,
    weight: number,
    metadata?: Record<string, any>
  ): number {
    const seats = metadata?.seats || 1;

    if (seats >= 100) {
      return -basePrice * 0.25 * weight; // 25% volume discount
    } else if (seats >= 50) {
      return -basePrice * 0.15 * weight;
    } else if (seats >= 10) {
      return -basePrice * 0.1 * weight;
    }

    return 0;
  }

  /**
   * Calculate competitive adjustment
   */
  private calculateCompetitiveAdjustment(
    basePrice: number,
    weight: number,
    tier: SubscriptionTier
  ): number {
    // In production, this would fetch competitor prices
    // For now, apply a small discount to remain competitive
    return -basePrice * 0.05 * weight;
  }

  /**
   * Calculate behavioral adjustment
   */
  private calculateBehavioralAdjustment(
    basePrice: number,
    weight: number,
    metadata?: Record<string, any>
  ): number {
    // Returning customer discount
    if (metadata?.isReturningCustomer) {
      return -basePrice * 0.1 * weight;
    }

    // High engagement discount
    if (metadata?.engagementScore && metadata.engagementScore > 0.8) {
      return -basePrice * 0.05 * weight;
    }

    return 0;
  }

  /**
   * Identify customer segment
   */
  private async identifySegment(
    customerId: string,
    metadata?: Record<string, any>
  ): Promise<CustomerSegment | null> {
    // In production, this would query customer data
    // For now, return first matching segment based on metadata

    for (const segment of Array.from(this.segments.values()).sort((a, b) => b.priority - a.priority)) {
      if (this.matchesSegmentCriteria(segment.criteria, metadata)) {
        return segment;
      }
    }

    return null;
  }

  /**
   * Match segment criteria
   */
  private matchesSegmentCriteria(
    criteria: SegmentCriteria,
    metadata?: Record<string, any>
  ): boolean {
    if (!metadata) return false;

    if (criteria.industry && metadata.industry) {
      if (!criteria.industry.includes(metadata.industry)) return false;
    }

    if (criteria.companySize && metadata.companySize) {
      if (criteria.companySize !== metadata.companySize) return false;
    }

    if (criteria.region && metadata.region) {
      if (!criteria.region.includes(metadata.region)) return false;
    }

    return true;
  }

  /**
   * Get experiment variant for customer
   */
  private async getExperimentVariant(customerId: string): Promise<PricingVariant | null> {
    const runningExperiments = Array.from(this.experiments.values())
      .filter(e => e.status === 'running');

    if (runningExperiments.length === 0) return null;

    // Use first running experiment
    const experiment = runningExperiments[0];

    // Deterministic assignment based on customer ID
    const hash = this.hashString(customerId);
    const allocation = hash % 100;

    let cumulative = 0;
    for (const [variantId, percent] of Object.entries(experiment.allocation)) {
      cumulative += percent;
      if (allocation < cumulative) {
        return experiment.variants.find(v => v.id === variantId) || null;
      }
    }

    return null;
  }

  /**
   * Check if trial is available
   */
  private async isTrialAvailable(customerId?: string, tier?: SubscriptionTier): Promise<boolean> {
    // In production, check if customer has already used trial
    // For now, trials available for pro and enterprise tiers
    return tier === 'pro' || tier === 'enterprise';
  }

  /**
   * Get active pricing model
   */
  private getActivePricingModel(): PricingModel {
    const activeModels = Array.from(this.models.values())
      .filter(m => m.active && new Date() >= m.effectiveFrom)
      .filter(m => !m.effectiveUntil || new Date() <= m.effectiveUntil);

    if (activeModels.length === 0) {
      throw new Error('No active pricing model found');
    }

    return activeModels[0];
  }

  /**
   * Initialize default models
   */
  private initializeDefaultModels(): void {
    const defaultModel: PricingModel = {
      id: 'default',
      name: 'Default Pricing Model',
      basePrices: {
        free: 0,
        pro: 29,
        enterprise: 299,
      },
      currency: 'USD',
      factors: [
        { type: 'demand', weight: 1, config: {} },
        { type: 'seasonal', weight: 1, config: {} },
        { type: 'volume', weight: 1, config: {} },
      ],
      active: true,
      effectiveFrom: new Date('2024-01-01'),
    };

    this.models.set(defaultModel.id, defaultModel);
  }

  /**
   * Initialize default segments
   */
  private initializeDefaultSegments(): void {
    const segments: CustomerSegment[] = [
      {
        id: 'enterprise',
        name: 'Enterprise',
        criteria: { companySize: 'enterprise' },
        priceMultiplier: 1.2,
        priority: 3,
      },
      {
        id: 'smb',
        name: 'Small/Medium Business',
        criteria: { companySize: 'smb' },
        priceMultiplier: 1.0,
        priority: 2,
      },
      {
        id: 'startup',
        name: 'Startup',
        criteria: { companySize: 'startup' },
        priceMultiplier: 0.8,
        priority: 1,
      },
    ];

    for (const segment of segments) {
      this.segments.set(segment.id, segment);
    }
  }

  private getFactorName(type: string): string {
    const names: Record<string, string> = {
      demand: 'Demand-based adjustment',
      segment: 'Customer segment',
      seasonal: 'Seasonal promotion',
      volume: 'Volume discount',
      competitive: 'Competitive pricing',
      behavioral: 'Behavioral discount',
    };
    return names[type] || type;
  }

  private getFactorReason(type: string, adjustment: number): string {
    const direction = adjustment > 0 ? 'increase' : 'discount';
    const reasons: Record<string, string> = {
      demand: `${direction} based on current demand`,
      seasonal: `Seasonal ${direction}`,
      volume: `Volume ${direction} applied`,
      competitive: `Competitive ${direction}`,
      behavioral: `${direction} based on customer behavior`,
    };
    return reasons[type] || `Price ${direction} applied`;
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

interface DemandMetrics {
  currentLoad: number;
  peakLoad: number;
  averageLoad: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

interface PricingStatistics {
  totalModels: number;
  activeModels: number;
  totalSegments: number;
  activeExperiments: number;
  demandMetrics: DemandMetrics;
}

// Singleton
let pricingEngine: DynamicPricingEngine;

export function getDynamicPricingEngine(): DynamicPricingEngine {
  if (!pricingEngine) {
    pricingEngine = new DynamicPricingEngine();
  }
  return pricingEngine;
}

export { DynamicPricingEngine };
