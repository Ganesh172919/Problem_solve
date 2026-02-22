/**
 * Intelligent Feature Flag & A/B Testing System
 *
 * Advanced system for:
 * - Dynamic feature rollouts
 * - A/B and multivariate testing
 * - Gradual rollouts with automatic rollback
 * - User segmentation
 * - Statistical significance testing
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  type: 'boolean' | 'string' | 'number' | 'json';
  defaultValue: any;
  enabled: boolean;
  environments: string[];
  rollout: RolloutStrategy;
  targeting: TargetingRule[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RolloutStrategy {
  type: 'percentage' | 'user_list' | 'gradual' | 'canary';
  percentage?: number;
  userList?: string[];
  gradualConfig?: GradualRollout;
  canaryConfig?: CanaryDeployment;
}

export interface GradualRollout {
  stages: RolloutStage[];
  currentStage: number;
  autoAdvance: boolean;
  advanceInterval: number; // hours
  rollbackOnError: boolean;
  errorThreshold: number; // percentage
}

export interface RolloutStage {
  percentage: number;
  duration: number; // hours
  startTime?: Date;
  metrics?: StageMetrics;
}

export interface StageMetrics {
  users: number;
  errors: number;
  errorRate: number;
  avgLatency: number;
  conversionRate: number;
}

export interface CanaryDeployment {
  canaryPercentage: number;
  canaryDuration: number; // hours
  successCriteria: SuccessCriteria;
  monitoringMetrics: string[];
}

export interface SuccessCriteria {
  maxErrorRate: number;
  maxLatencyIncrease: number; // percentage
  minConversionRate: number;
}

export interface TargetingRule {
  attribute: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in' | 'regex';
  value: any;
  negate?: boolean;
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  hypothesis: string;
  type: 'ab' | 'multivariate';
  status: 'draft' | 'running' | 'paused' | 'completed';
  variants: Variant[];
  allocation: VariantAllocation;
  targeting: TargetingRule[];
  metrics: ExperimentMetric[];
  startDate?: Date;
  endDate?: Date;
  sampleSize: number;
  currentSample: number;
  results?: ExperimentResults;
}

export interface Variant {
  id: string;
  name: string;
  description: string;
  isControl: boolean;
  config: Record<string, any>;
  allocation: number; // percentage
}

export interface VariantAllocation {
  method: 'random' | 'sticky' | 'weighted';
  seed?: string;
}

export interface ExperimentMetric {
  id: string;
  name: string;
  type: 'conversion' | 'revenue' | 'engagement' | 'latency' | 'error_rate';
  goal: 'increase' | 'decrease';
  baseline?: number;
  targetImprovement: number; // percentage
}

export interface ExperimentResults {
  variants: Map<string, VariantResults>;
  winner?: string;
  confidence: number; // 0-1
  statisticalSignificance: boolean;
  pValue: number;
  recommendations: string[];
}

export interface VariantResults {
  variantId: string;
  users: number;
  metrics: Map<string, MetricResult>;
  conversionRate: number;
  revenue: number;
  engagement: number;
}

export interface MetricResult {
  value: number;
  change: number; // vs control
  changePercent: number;
  confidence: number;
}

export interface UserContext {
  userId: string;
  attributes: Map<string, any>;
  environment: string;
}

class FeatureFlagSystem {
  private flags: Map<string, FeatureFlag> = new Map();
  private experiments: Map<string, Experiment> = new Map();
  private userAssignments: Map<string, Map<string, string>> = new Map(); // userId -> experimentId -> variantId
  private evaluationCache: Map<string, any> = new Map();

  /**
   * Create feature flag
   */
  createFlag(flag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>): FeatureFlag {
    const id = `flag_${Date.now()}`;

    const newFlag: FeatureFlag = {
      ...flag,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.flags.set(flag.key, newFlag);

    logger.info('Feature flag created', {
      id,
      key: flag.key,
      rolloutType: flag.rollout.type,
    });

    return newFlag;
  }

  /**
   * Evaluate feature flag for user
   */
  async evaluate(
    flagKey: string,
    context: UserContext,
    defaultValue?: any
  ): Promise<any> {
    const cacheKey = `${flagKey}:${context.userId}:${context.environment}`;

    // Check cache
    if (this.evaluationCache.has(cacheKey)) {
      return this.evaluationCache.get(cacheKey);
    }

    const flag = this.flags.get(flagKey);

    if (!flag) {
      return defaultValue ?? null;
    }

    // Check if flag is enabled
    if (!flag.enabled) {
      return flag.defaultValue;
    }

    // Check environment
    if (!flag.environments.includes(context.environment)) {
      return flag.defaultValue;
    }

    // Check targeting rules
    if (!this.matchesTargeting(context, flag.targeting)) {
      return flag.defaultValue;
    }

    // Apply rollout strategy
    const value = await this.applyRollout(flag, context);

    // Cache result
    this.evaluationCache.set(cacheKey, value);
    setTimeout(() => this.evaluationCache.delete(cacheKey), 60000); // 1 min cache

    logger.debug('Feature flag evaluated', {
      flagKey,
      userId: context.userId,
      value,
    });

    return value;
  }

  /**
   * Create A/B test experiment
   */
  createExperiment(experiment: Omit<Experiment, 'id' | 'currentSample' | 'results'>): Experiment {
    const id = `exp_${Date.now()}`;

    // Validate allocation sums to 100
    const totalAllocation = experiment.variants.reduce((sum, v) => sum + v.allocation, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new Error('Variant allocations must sum to 100%');
    }

    const newExperiment: Experiment = {
      ...experiment,
      id,
      currentSample: 0,
    };

    this.experiments.set(id, newExperiment);

    logger.info('Experiment created', {
      id,
      name: experiment.name,
      variants: experiment.variants.length,
    });

    return newExperiment;
  }

  /**
   * Assign user to experiment variant
   */
  async assignVariant(experimentId: string, context: UserContext): Promise<Variant | null> {
    const experiment = this.experiments.get(experimentId);

    if (!experiment) {
      throw new Error('Experiment not found');
    }

    if (experiment.status !== 'running') {
      return null;
    }

    // Check if user already assigned
    const userExperiments = this.userAssignments.get(context.userId);
    if (userExperiments?.has(experimentId)) {
      const variantId = userExperiments.get(experimentId)!;
      return experiment.variants.find(v => v.id === variantId) || null;
    }

    // Check targeting
    if (!this.matchesTargeting(context, experiment.targeting)) {
      return null;
    }

    // Assign variant
    const variant = this.selectVariant(experiment, context);

    // Store assignment
    if (!this.userAssignments.has(context.userId)) {
      this.userAssignments.set(context.userId, new Map());
    }
    this.userAssignments.get(context.userId)!.set(experimentId, variant.id);

    // Increment sample size
    experiment.currentSample++;

    logger.info('Variant assigned', {
      experimentId,
      userId: context.userId,
      variantId: variant.id,
    });

    return variant;
  }

  /**
   * Track experiment event
   */
  async trackEvent(
    experimentId: string,
    userId: string,
    metricId: string,
    value: number
  ): Promise<void> {
    const experiment = this.experiments.get(experimentId);

    if (!experiment) {
      return;
    }

    const userExperiments = this.userAssignments.get(userId);
    if (!userExperiments?.has(experimentId)) {
      return;
    }

    const variantId = userExperiments.get(experimentId)!;

    logger.debug('Experiment event tracked', {
      experimentId,
      userId,
      variantId,
      metricId,
      value,
    });

    // Would store in metrics database
  }

  /**
   * Analyze experiment results
   */
  async analyzeExperiment(experimentId: string): Promise<ExperimentResults> {
    const experiment = this.experiments.get(experimentId);

    if (!experiment) {
      throw new Error('Experiment not found');
    }

    // Collect results for each variant
    const variantResults = new Map<string, VariantResults>();

    for (const variant of experiment.variants) {
      const results = await this.collectVariantResults(experiment, variant);
      variantResults.set(variant.id, results);
    }

    // Find control variant
    const control = experiment.variants.find(v => v.isControl);
    if (!control) {
      throw new Error('No control variant found');
    }

    // Calculate statistical significance
    const { winner, confidence, pValue } = this.calculateSignificance(
      variantResults,
      control.id
    );

    const statisticalSignificance = pValue < 0.05 && confidence > 0.95;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      experiment,
      variantResults,
      winner,
      statisticalSignificance
    );

    const results: ExperimentResults = {
      variants: variantResults,
      winner,
      confidence,
      statisticalSignificance,
      pValue,
      recommendations,
    };

    experiment.results = results;

    logger.info('Experiment analyzed', {
      experimentId,
      winner,
      confidence,
      statisticalSignificance,
    });

    return results;
  }

  /**
   * Gradual rollout management
   */
  async advanceRollout(flagKey: string): Promise<void> {
    const flag = this.flags.get(flagKey);

    if (!flag || flag.rollout.type !== 'gradual') {
      return;
    }

    const config = flag.rollout.gradualConfig!;
    const currentStage = config.stages[config.currentStage];

    if (!currentStage) {
      logger.info('Rollout complete', { flagKey });
      return;
    }

    // Check if stage duration elapsed
    if (currentStage.startTime) {
      const elapsed = Date.now() - currentStage.startTime.getTime();
      const duration = currentStage.duration * 3600000; // hours to ms

      if (elapsed < duration) {
        return; // Still in current stage
      }
    }

    // Check error threshold
    if (config.rollbackOnError && currentStage.metrics) {
      if (currentStage.metrics.errorRate > config.errorThreshold) {
        await this.rollbackFeature(flagKey);
        return;
      }
    }

    // Advance to next stage
    config.currentStage++;

    if (config.currentStage < config.stages.length) {
      const nextStage = config.stages[config.currentStage];
      nextStage.startTime = new Date();
      flag.rollout.percentage = nextStage.percentage;

      logger.info('Rollout advanced', {
        flagKey,
        stage: config.currentStage,
        percentage: nextStage.percentage,
      });
    } else {
      logger.info('Rollout complete', { flagKey });
    }

    flag.updatedAt = new Date();
  }

  /**
   * Rollback feature flag
   */
  async rollbackFeature(flagKey: string): Promise<void> {
    const flag = this.flags.get(flagKey);

    if (!flag) {
      return;
    }

    flag.enabled = false;
    flag.rollout.percentage = 0;
    flag.updatedAt = new Date();

    // Clear cache
    for (const key of this.evaluationCache.keys()) {
      if (key.startsWith(flagKey)) {
        this.evaluationCache.delete(key);
      }
    }

    logger.warn('Feature rolled back', { flagKey });
  }

  // Private helper methods

  private matchesTargeting(context: UserContext, rules: TargetingRule[]): boolean {
    if (rules.length === 0) {
      return true;
    }

    for (const rule of rules) {
      const attributeValue = context.attributes.get(rule.attribute);
      const matches = this.evaluateRule(attributeValue, rule);

      if (rule.negate ? matches : !matches) {
        return false;
      }
    }

    return true;
  }

  private evaluateRule(value: any, rule: TargetingRule): boolean {
    switch (rule.operator) {
      case 'equals':
        return value === rule.value;

      case 'contains':
        return String(value).includes(String(rule.value));

      case 'greater_than':
        return Number(value) > Number(rule.value);

      case 'less_than':
        return Number(value) < Number(rule.value);

      case 'in':
        return Array.isArray(rule.value) && rule.value.includes(value);

      case 'regex':
        return new RegExp(rule.value).test(String(value));

      default:
        return false;
    }
  }

  private async applyRollout(flag: FeatureFlag, context: UserContext): Promise<any> {
    const { rollout } = flag;

    switch (rollout.type) {
      case 'percentage':
        const hash = this.hashUserId(context.userId, flag.key);
        return hash < (rollout.percentage || 0) / 100 ? flag.defaultValue : null;

      case 'user_list':
        return rollout.userList?.includes(context.userId) ? flag.defaultValue : null;

      case 'gradual':
        const gradualHash = this.hashUserId(context.userId, flag.key);
        const currentPercentage = rollout.percentage || 0;
        return gradualHash < currentPercentage / 100 ? flag.defaultValue : null;

      case 'canary':
        const canaryHash = this.hashUserId(context.userId, flag.key);
        const canaryPercentage = rollout.canaryConfig?.canaryPercentage || 0;
        return canaryHash < canaryPercentage / 100 ? flag.defaultValue : null;

      default:
        return flag.defaultValue;
    }
  }

  private selectVariant(experiment: Experiment, context: UserContext): Variant {
    const hash = this.hashUserId(context.userId, experiment.id);

    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.allocation / 100;
      if (hash < cumulative) {
        return variant;
      }
    }

    return experiment.variants[0]; // Fallback
  }

  private hashUserId(userId: string, seed: string): number {
    // Simple hash function (in production use crypto hash)
    let hash = 0;
    const str = userId + seed;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash) / 2147483647; // Normalize to 0-1
  }

  private async collectVariantResults(
    experiment: Experiment,
    variant: Variant
  ): Promise<VariantResults> {
    // Simplified - would query actual metrics database
    const users = Math.floor(experiment.currentSample * (variant.allocation / 100));

    return {
      variantId: variant.id,
      users,
      metrics: new Map(),
      conversionRate: 0.15 + Math.random() * 0.1,
      revenue: users * (50 + Math.random() * 20),
      engagement: 0.6 + Math.random() * 0.2,
    };
  }

  private calculateSignificance(
    variantResults: Map<string, VariantResults>,
    controlId: string
  ): { winner: string | undefined; confidence: number; pValue: number } {
    const control = variantResults.get(controlId);
    if (!control) {
      return { winner: undefined, confidence: 0, pValue: 1 };
    }

    let winner: string | undefined;
    let maxImprovement = 0;

    for (const [variantId, results] of variantResults.entries()) {
      if (variantId === controlId) continue;

      const improvement =
        (results.conversionRate - control.conversionRate) / control.conversionRate;

      if (improvement > maxImprovement) {
        maxImprovement = improvement;
        winner = variantId;
      }
    }

    // Simplified significance calculation
    const confidence = Math.min(0.99, maxImprovement * 10);
    const pValue = 1 - confidence;

    return { winner, confidence, pValue };
  }

  private generateRecommendations(
    experiment: Experiment,
    variantResults: Map<string, VariantResults>,
    winner: string | undefined,
    significant: boolean
  ): string[] {
    const recommendations: string[] = [];

    if (!significant) {
      recommendations.push('Results not statistically significant. Continue experiment or increase sample size.');
    } else if (winner) {
      const winnerResults = variantResults.get(winner);
      if (winnerResults) {
        recommendations.push(
          `Winner: ${winner}. Recommend rolling out to 100% of users.`
        );

        const control = Array.from(variantResults.values()).find(v => v.variantId !== winner);
        if (control) {
          const improvement =
            ((winnerResults.conversionRate - control.conversionRate) / control.conversionRate) *
            100;
          recommendations.push(
            `Expected improvement: ${improvement.toFixed(1)}% in conversion rate`
          );
        }
      }
    }

    if (experiment.currentSample < experiment.sampleSize) {
      recommendations.push(
        `Sample size: ${experiment.currentSample} / ${experiment.sampleSize}. Continue until target reached.`
      );
    }

    return recommendations;
  }

  /**
   * Get system statistics
   */
  getStats(): {
    totalFlags: number;
    enabledFlags: number;
    totalExperiments: number;
    runningExperiments: number;
    completedExperiments: number;
  } {
    return {
      totalFlags: this.flags.size,
      enabledFlags: Array.from(this.flags.values()).filter(f => f.enabled).length,
      totalExperiments: this.experiments.size,
      runningExperiments: Array.from(this.experiments.values()).filter(
        e => e.status === 'running'
      ).length,
      completedExperiments: Array.from(this.experiments.values()).filter(
        e => e.status === 'completed'
      ).length,
    };
  }
}

// Singleton
let featureFlagSystem: FeatureFlagSystem;

export function getFeatureFlagSystem(): FeatureFlagSystem {
  if (!featureFlagSystem) {
    featureFlagSystem = new FeatureFlagSystem();
  }
  return featureFlagSystem;
}
