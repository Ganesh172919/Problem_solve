/**
 * Feature Flag Engine for SaaS platform.
 *
 * Provides flag creation with targeting rules, percentage-based rollout,
 * user/tenant targeting, environment-based flags, A/B testing variant
 * assignment, flag evaluation with context, override management, and
 * audit logging of flag changes.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface AttributeRule {
  attribute: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'in';
  value: unknown;
}

export interface TargetingRules {
  userIds: string[];
  tenantIds: string[];
  attributes: AttributeRule[];
  percentage: number;
}

export interface FlagVariant {
  key: string;
  value: unknown;
  weight: number;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  targeting: TargetingRules;
  variants: FlagVariant[];
  defaultVariant: string;
  rolloutPercentage: number;
  environment: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FlagEvaluationContext {
  userId?: string;
  tenantId?: string;
  environment?: string;
  attributes?: Record<string, unknown>;
}

export interface FlagEvaluation {
  flagKey: string;
  variant: FlagVariant;
  reason: 'targeting' | 'rollout' | 'default' | 'override' | 'disabled';
  timestamp: number;
}

export interface FlagOverride {
  flagKey: string;
  scope: 'user' | 'tenant' | 'global';
  scopeId: string;
  variant: string;
  expiresAt?: number;
}

export interface FlagAuditEntry {
  flagKey: string;
  action: string;
  previousValue: unknown;
  newValue: unknown;
  changedBy: string;
  timestamp: number;
}

export interface FlagStats {
  totalFlags: number;
  enabledCount: number;
  disabledCount: number;
  evaluationCount: number;
  overrideCount: number;
}

export class FeatureFlagEngine {
  private flags: Map<string, FeatureFlag> = new Map();
  private overrides: FlagOverride[] = [];
  private auditLog: FlagAuditEntry[] = [];
  private evaluationCount = 0;

  createFlag(flag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>): FeatureFlag {
    if (this.flags.has(flag.key)) {
      throw new Error(`Flag with key "${flag.key}" already exists`);
    }
    const now = Date.now();
    const newFlag: FeatureFlag = {
      ...flag,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.flags.set(newFlag.key, newFlag);
    this.addAuditEntry(newFlag.key, 'create', null, newFlag, 'system');
    logger.info(`Flag created: ${newFlag.key}`);
    return { ...newFlag };
  }

  updateFlag(flagKey: string, updates: Partial<FeatureFlag>): FeatureFlag {
    const existing = this.flags.get(flagKey);
    if (!existing) {
      throw new Error(`Flag "${flagKey}" not found`);
    }
    const previous = { ...existing };
    const updated: FeatureFlag = {
      ...existing,
      ...updates,
      id: existing.id,
      key: existing.key,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.flags.set(flagKey, updated);
    this.addAuditEntry(flagKey, 'update', previous, updated, 'system');
    logger.info(`Flag updated: ${flagKey}`);
    return { ...updated };
  }

  deleteFlag(flagKey: string): void {
    const existing = this.flags.get(flagKey);
    if (!existing) {
      throw new Error(`Flag "${flagKey}" not found`);
    }
    this.flags.delete(flagKey);
    this.overrides = this.overrides.filter((o) => o.flagKey !== flagKey);
    this.addAuditEntry(flagKey, 'delete', existing, null, 'system');
    logger.info(`Flag deleted: ${flagKey}`);
  }

  evaluate(flagKey: string, context: FlagEvaluationContext): FlagEvaluation {
    const flag = this.flags.get(flagKey);
    if (!flag) {
      throw new Error(`Flag "${flagKey}" not found`);
    }
    this.evaluationCount++;

    if (!flag.enabled) {
      return this.buildEvaluation(flag, this.getDefaultVariant(flag), 'disabled');
    }

    if (context.environment && flag.environment && context.environment !== flag.environment) {
      return this.buildEvaluation(flag, this.getDefaultVariant(flag), 'disabled');
    }

    // Check overrides: user > tenant > global
    const override = this.resolveOverride(flagKey, context);
    if (override) {
      const variant = flag.variants.find((v) => v.key === override.variant);
      if (variant) {
        return this.buildEvaluation(flag, variant, 'override');
      }
    }

    // Check user targeting
    if (context.userId && flag.targeting.userIds.includes(context.userId)) {
      return this.buildEvaluation(flag, this.pickFirstNonDefaultVariant(flag), 'targeting');
    }

    // Check tenant targeting
    if (context.tenantId && flag.targeting.tenantIds.includes(context.tenantId)) {
      return this.buildEvaluation(flag, this.pickFirstNonDefaultVariant(flag), 'targeting');
    }

    // Check attribute rules
    if (context.attributes && this.matchesAttributeRules(flag.targeting.attributes, context.attributes)) {
      return this.buildEvaluation(flag, this.pickFirstNonDefaultVariant(flag), 'targeting');
    }

    // Percentage-based rollout
    if (flag.rolloutPercentage < 100) {
      const bucket = this.hashToBucket(context.userId ?? '', flagKey);
      if (bucket >= flag.rolloutPercentage) {
        return this.buildEvaluation(flag, this.getDefaultVariant(flag), 'default');
      }
      const variant = this.assignVariantByWeight(flag, context.userId ?? '', flagKey);
      return this.buildEvaluation(flag, variant, 'rollout');
    }

    // Full rollout – assign variant by weight
    if (flag.variants.length > 1) {
      const variant = this.assignVariantByWeight(flag, context.userId ?? '', flagKey);
      return this.buildEvaluation(flag, variant, 'rollout');
    }

    return this.buildEvaluation(flag, this.getDefaultVariant(flag), 'default');
  }

  evaluateAll(context: FlagEvaluationContext): Map<string, FlagEvaluation> {
    const results = new Map<string, FlagEvaluation>();
    for (const [key, flag] of this.flags) {
      if (context.environment && flag.environment && context.environment !== flag.environment) {
        continue;
      }
      results.set(key, this.evaluate(key, context));
    }
    return results;
  }

  addOverride(override: FlagOverride): void {
    if (!this.flags.has(override.flagKey)) {
      throw new Error(`Flag "${override.flagKey}" not found`);
    }
    this.removeOverride(override.flagKey, override.scope, override.scopeId);
    this.overrides.push({ ...override });
    this.addAuditEntry(override.flagKey, 'override_add', null, override, 'system');
    logger.info(`Override added for flag: ${override.flagKey}`);
  }

  removeOverride(flagKey: string, scope: string, scopeId: string): void {
    const before = this.overrides.length;
    this.overrides = this.overrides.filter(
      (o) => !(o.flagKey === flagKey && o.scope === scope && o.scopeId === scopeId),
    );
    if (this.overrides.length < before) {
      this.addAuditEntry(flagKey, 'override_remove', { scope, scopeId }, null, 'system');
      logger.info(`Override removed for flag: ${flagKey}`);
    }
  }

  getFlag(flagKey: string): FeatureFlag | null {
    const flag = this.flags.get(flagKey);
    return flag ? { ...flag } : null;
  }

  getAllFlags(environment?: string): FeatureFlag[] {
    const all = Array.from(this.flags.values());
    if (environment) {
      return all.filter((f) => f.environment === environment).map((f) => ({ ...f }));
    }
    return all.map((f) => ({ ...f }));
  }

  getAuditLog(flagKey?: string): FlagAuditEntry[] {
    if (flagKey) {
      return this.auditLog.filter((e) => e.flagKey === flagKey);
    }
    return [...this.auditLog];
  }

  getStats(): FlagStats {
    const flags = Array.from(this.flags.values());
    return {
      totalFlags: flags.length,
      enabledCount: flags.filter((f) => f.enabled).length,
      disabledCount: flags.filter((f) => !f.enabled).length,
      evaluationCount: this.evaluationCount,
      overrideCount: this.overrides.length,
    };
  }

  isEnabled(flagKey: string, context: FlagEvaluationContext): boolean {
    try {
      const evaluation = this.evaluate(flagKey, context);
      return evaluation.reason !== 'disabled';
    } catch {
      return false;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private resolveOverride(flagKey: string, context: FlagEvaluationContext): FlagOverride | null {
    const now = Date.now();
    const active = this.overrides.filter(
      (o) => o.flagKey === flagKey && (!o.expiresAt || o.expiresAt > now),
    );

    // Precedence: user > tenant > global
    if (context.userId) {
      const userOverride = active.find((o) => o.scope === 'user' && o.scopeId === context.userId);
      if (userOverride) return userOverride;
    }
    if (context.tenantId) {
      const tenantOverride = active.find((o) => o.scope === 'tenant' && o.scopeId === context.tenantId);
      if (tenantOverride) return tenantOverride;
    }
    const globalOverride = active.find((o) => o.scope === 'global');
    return globalOverride ?? null;
  }

  private matchesAttributeRules(rules: AttributeRule[], attributes: Record<string, unknown>): boolean {
    if (rules.length === 0) return false;
    return rules.every((rule) => this.evaluateAttributeRule(rule, attributes));
  }

  private evaluateAttributeRule(rule: AttributeRule, attributes: Record<string, unknown>): boolean {
    const actual = attributes[rule.attribute];
    if (actual === undefined) return false;

    switch (rule.operator) {
      case 'eq':
        return actual === rule.value;
      case 'neq':
        return actual !== rule.value;
      case 'gt':
        return typeof actual === 'number' && typeof rule.value === 'number' && actual > rule.value;
      case 'lt':
        return typeof actual === 'number' && typeof rule.value === 'number' && actual < rule.value;
      case 'contains':
        return typeof actual === 'string' && typeof rule.value === 'string' && actual.includes(rule.value);
      case 'in':
        return Array.isArray(rule.value) && rule.value.includes(actual);
      default:
        return false;
    }
  }

  /**
   * Deterministic hash that maps a string to a bucket in [0, 100).
   * Uses FNV-1a so the same userId+flagKey always lands in the same bucket.
   */
  private hashToBucket(userId: string, flagKey: string): number {
    const input = `${userId}:${flagKey}`;
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
    return Math.abs(hash) % 100;
  }

  /**
   * Assigns a variant using deterministic hashing and cumulative weights.
   */
  private assignVariantByWeight(flag: FeatureFlag, userId: string, flagKey: string): FlagVariant {
    if (flag.variants.length === 0) {
      return { key: flag.defaultVariant, value: null, weight: 100 };
    }
    if (flag.variants.length === 1) {
      return flag.variants[0];
    }

    const totalWeight = flag.variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight === 0) {
      return this.getDefaultVariant(flag);
    }

    const bucket = this.hashToBucket(userId, `${flagKey}:variant`);
    const normalised = (bucket / 100) * totalWeight;

    let cumulative = 0;
    for (const variant of flag.variants) {
      cumulative += variant.weight;
      if (normalised < cumulative) {
        return variant;
      }
    }
    return flag.variants[flag.variants.length - 1];
  }

  private getDefaultVariant(flag: FeatureFlag): FlagVariant {
    const found = flag.variants.find((v) => v.key === flag.defaultVariant);
    return found ?? { key: flag.defaultVariant, value: null, weight: 0 };
  }

  private pickFirstNonDefaultVariant(flag: FeatureFlag): FlagVariant {
    const nonDefault = flag.variants.find((v) => v.key !== flag.defaultVariant);
    return nonDefault ?? this.getDefaultVariant(flag);
  }

  private buildEvaluation(
    flag: FeatureFlag,
    variant: FlagVariant,
    reason: FlagEvaluation['reason'],
  ): FlagEvaluation {
    return {
      flagKey: flag.key,
      variant: { ...variant },
      reason,
      timestamp: Date.now(),
    };
  }

  private addAuditEntry(
    flagKey: string,
    action: string,
    previousValue: unknown,
    newValue: unknown,
    changedBy: string,
  ): void {
    this.auditLog.push({ flagKey, action, previousValue, newValue, changedBy, timestamp: Date.now() });
  }

  private generateId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    return `ff_${ts}_${rand}`;
  }
}

declare global {
  var __featureFlagEngine__: FeatureFlagEngine | undefined;
}

export function getFeatureFlagEngine(): FeatureFlagEngine {
  if (!globalThis.__featureFlagEngine__) {
    globalThis.__featureFlagEngine__ = new FeatureFlagEngine();
    logger.info('FeatureFlagEngine singleton initialized');
  }
  return globalThis.__featureFlagEngine__;
}
