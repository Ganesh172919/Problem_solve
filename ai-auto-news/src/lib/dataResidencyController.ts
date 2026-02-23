import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

type RegionCode = string;
type ComplianceFramework = 'gdpr' | 'ccpa' | 'hipaa' | 'pipeda' | 'lgpd' | 'pdpa' | 'appi';
type MigrationStatus = 'pending' | 'in_progress' | 'validating' | 'completed' | 'failed' | 'rolled_back';
type DataCategory = 'pii' | 'phi' | 'financial' | 'operational' | 'analytics' | 'general';

interface RegionConfig {
  code: RegionCode;
  name: string;
  dataCenters: string[];
  enabled: boolean;
  complianceFrameworks: ComplianceFramework[];
  maxTenants: number;
  currentTenants: number;
  dataCategories: DataCategory[];
  restrictedTransferTo: RegionCode[];
}

interface TenantResidency {
  tenantId: string;
  primaryRegion: RegionCode;
  replicaRegions: RegionCode[];
  dataCategories: DataCategory[];
  complianceRequirements: ComplianceFramework[];
  assignedAt: Date;
  updatedAt: Date;
}

interface RoutingRule {
  id: string;
  tenantId: string;
  dataCategory: DataCategory;
  targetRegion: RegionCode;
  priority: number;
  enabled: boolean;
  createdAt: Date;
}

interface TransferRestriction {
  sourceRegion: RegionCode;
  targetRegion: RegionCode;
  blocked: boolean;
  requiredFrameworks: ComplianceFramework[];
  requiresConsent: boolean;
}

interface MigrationWorkflow {
  id: string;
  tenantId: string;
  sourceRegion: RegionCode;
  targetRegion: RegionCode;
  status: MigrationStatus;
  dataCategories: DataCategory[];
  startedAt: Date;
  completedAt: Date | null;
  progress: number;
  errors: string[];
  rollbackAvailable: boolean;
}

interface ComplianceReport {
  tenantId: string;
  region: RegionCode;
  frameworks: ComplianceFramework[];
  compliant: boolean;
  violations: ComplianceViolation[];
  generatedAt: Date;
}

interface ComplianceViolation {
  framework: ComplianceFramework;
  rule: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  remediation: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

class DataResidencyController {
  private regions = new Map<RegionCode, RegionConfig>();
  private tenantResidency = new Map<string, TenantResidency>();
  private routingRules = new Map<string, RoutingRule>();
  private transferRestrictions = new Map<string, TransferRestriction>();
  private migrations = new Map<string, MigrationWorkflow>();
  private tenantRulesIndex = new Map<string, Set<string>>();

  constructor() {
    logger.info('DataResidencyController initialized');
  }

  // ── Region Configuration ─────────────────────────────────────────────────

  registerRegion(config: RegionConfig): RegionConfig {
    if (!config.code || !config.name) {
      throw new Error('Region requires code and name');
    }
    if (config.dataCenters.length === 0) {
      throw new Error('Region must have at least one data center');
    }
    this.regions.set(config.code, config);
    logger.info('Region registered', { region: config.code, name: config.name });
    return config;
  }

  updateRegion(code: RegionCode, updates: Partial<Omit<RegionConfig, 'code'>>): RegionConfig {
    const region = this.regions.get(code);
    if (!region) throw new Error(`Region ${code} not found`);
    Object.assign(region, updates);
    logger.info('Region updated', { region: code });
    return region;
  }

  getRegion(code: RegionCode): RegionConfig | null {
    return this.regions.get(code) ?? null;
  }

  listRegions(enabledOnly = true): RegionConfig[] {
    const all = Array.from(this.regions.values());
    return enabledOnly ? all.filter((r) => r.enabled) : all;
  }

  // ── Tenant Data Routing ──────────────────────────────────────────────────

  assignTenant(
    tenantId: string,
    primaryRegion: RegionCode,
    complianceRequirements: ComplianceFramework[],
    dataCategories: DataCategory[] = ['general'],
  ): TenantResidency {
    const region = this.regions.get(primaryRegion);
    if (!region) throw new Error(`Region ${primaryRegion} not found`);
    if (!region.enabled) throw new Error(`Region ${primaryRegion} is not enabled`);
    if (region.currentTenants >= region.maxTenants) {
      throw new Error(`Region ${primaryRegion} is at capacity (${region.maxTenants} tenants)`);
    }

    // Validate compliance compatibility
    for (const req of complianceRequirements) {
      if (!region.complianceFrameworks.includes(req)) {
        throw new Error(`Region ${primaryRegion} does not support ${req} compliance`);
      }
    }

    const now = new Date();
    const residency: TenantResidency = {
      tenantId,
      primaryRegion,
      replicaRegions: [],
      dataCategories,
      complianceRequirements,
      assignedAt: now,
      updatedAt: now,
    };

    this.tenantResidency.set(tenantId, residency);
    region.currentTenants++;
    logger.info('Tenant assigned to region', { tenantId, region: primaryRegion });
    return residency;
  }

  addReplicaRegion(tenantId: string, replicaRegion: RegionCode): TenantResidency {
    const residency = this.tenantResidency.get(tenantId);
    if (!residency) throw new Error(`Tenant ${tenantId} has no residency assignment`);
    const region = this.regions.get(replicaRegion);
    if (!region || !region.enabled) throw new Error(`Region ${replicaRegion} not available`);

    this.validateTransfer(residency.primaryRegion, replicaRegion, residency.complianceRequirements);

    if (!residency.replicaRegions.includes(replicaRegion)) {
      residency.replicaRegions.push(replicaRegion);
      residency.updatedAt = new Date();
    }
    logger.info('Replica region added', { tenantId, replicaRegion });
    return residency;
  }

  addRoutingRule(
    tenantId: string,
    dataCategory: DataCategory,
    targetRegion: RegionCode,
    priority = 0,
  ): RoutingRule {
    const residency = this.tenantResidency.get(tenantId);
    if (!residency) throw new Error(`Tenant ${tenantId} has no residency assignment`);
    if (!this.regions.has(targetRegion)) throw new Error(`Region ${targetRegion} not found`);

    const id = `rule_${tenantId}_${dataCategory}_${Date.now()}`;
    const rule: RoutingRule = {
      id,
      tenantId,
      dataCategory,
      targetRegion,
      priority,
      enabled: true,
      createdAt: new Date(),
    };

    this.routingRules.set(id, rule);
    if (!this.tenantRulesIndex.has(tenantId)) {
      this.tenantRulesIndex.set(tenantId, new Set());
    }
    this.tenantRulesIndex.get(tenantId)!.add(id);
    logger.info('Routing rule added', { tenantId, dataCategory, targetRegion });
    return rule;
  }

  resolveRegion(tenantId: string, dataCategory: DataCategory): RegionCode {
    const ruleIds = this.tenantRulesIndex.get(tenantId);
    if (ruleIds) {
      const rules = Array.from(ruleIds)
        .map((id) => this.routingRules.get(id)!)
        .filter((r) => r && r.enabled && r.dataCategory === dataCategory)
        .sort((a, b) => b.priority - a.priority);

      if (rules.length > 0) {
        const target = this.regions.get(rules[0].targetRegion);
        if (target?.enabled) return rules[0].targetRegion;
      }
    }

    const residency = this.tenantResidency.get(tenantId);
    if (!residency) throw new Error(`Tenant ${tenantId} has no residency assignment`);
    return residency.primaryRegion;
  }

  // ── Transfer Restrictions ────────────────────────────────────────────────

  setTransferRestriction(restriction: TransferRestriction): void {
    const key = `${restriction.sourceRegion}:${restriction.targetRegion}`;
    this.transferRestrictions.set(key, restriction);
    logger.info('Transfer restriction set', {
      source: restriction.sourceRegion,
      target: restriction.targetRegion,
      blocked: restriction.blocked,
    });
  }

  validateTransfer(
    sourceRegion: RegionCode,
    targetRegion: RegionCode,
    tenantFrameworks: ComplianceFramework[],
  ): { allowed: boolean; reason?: string; requiresConsent: boolean } {
    if (sourceRegion === targetRegion) {
      return { allowed: true, requiresConsent: false };
    }

    const source = this.regions.get(sourceRegion);
    if (source?.restrictedTransferTo.includes(targetRegion)) {
      return { allowed: false, reason: `Transfer from ${sourceRegion} to ${targetRegion} is restricted at region level`, requiresConsent: false };
    }

    const key = `${sourceRegion}:${targetRegion}`;
    const restriction = this.transferRestrictions.get(key);
    if (restriction) {
      if (restriction.blocked) {
        return { allowed: false, reason: `Transfer blocked by explicit restriction`, requiresConsent: false };
      }
      for (const req of restriction.requiredFrameworks) {
        if (!tenantFrameworks.includes(req)) {
          return { allowed: false, reason: `Transfer requires ${req} compliance`, requiresConsent: false };
        }
      }
      return { allowed: true, requiresConsent: restriction.requiresConsent };
    }

    // Check target region supports tenant's compliance needs
    const target = this.regions.get(targetRegion);
    if (target) {
      for (const fw of tenantFrameworks) {
        if (!target.complianceFrameworks.includes(fw)) {
          return { allowed: false, reason: `Target region ${targetRegion} does not support ${fw}`, requiresConsent: false };
        }
      }
    }

    return { allowed: true, requiresConsent: false };
  }

  // ── Migration Workflow ───────────────────────────────────────────────────

  startMigration(
    tenantId: string,
    targetRegion: RegionCode,
    dataCategories?: DataCategory[],
  ): MigrationWorkflow {
    const residency = this.tenantResidency.get(tenantId);
    if (!residency) throw new Error(`Tenant ${tenantId} has no residency assignment`);

    const transferCheck = this.validateTransfer(residency.primaryRegion, targetRegion, residency.complianceRequirements);
    if (!transferCheck.allowed) {
      throw new Error(`Migration blocked: ${transferCheck.reason}`);
    }

    const activeMigration = Array.from(this.migrations.values()).find(
      (m) => m.tenantId === tenantId && (m.status === 'pending' || m.status === 'in_progress'),
    );
    if (activeMigration) {
      throw new Error(`Tenant ${tenantId} already has an active migration (${activeMigration.id})`);
    }

    const id = `mig_${tenantId}_${Date.now()}`;
    const workflow: MigrationWorkflow = {
      id,
      tenantId,
      sourceRegion: residency.primaryRegion,
      targetRegion,
      status: 'pending',
      dataCategories: dataCategories ?? residency.dataCategories,
      startedAt: new Date(),
      completedAt: null,
      progress: 0,
      errors: [],
      rollbackAvailable: true,
    };

    this.migrations.set(id, workflow);
    logger.info('Migration started', { migrationId: id, tenantId, from: residency.primaryRegion, to: targetRegion });
    return workflow;
  }

  advanceMigration(migrationId: string, progress: number, errors?: string[]): MigrationWorkflow {
    const migration = this.migrations.get(migrationId);
    if (!migration) throw new Error(`Migration ${migrationId} not found`);

    if (migration.status === 'completed' || migration.status === 'rolled_back') {
      throw new Error(`Migration ${migrationId} is already finalized`);
    }

    migration.progress = Math.min(100, Math.max(0, progress));
    if (errors) migration.errors.push(...errors);

    if (migration.errors.length > 10) {
      migration.status = 'failed';
      logger.error('Migration failed due to excessive errors', new Error('Too many migration errors'), { migrationId });
    } else if (migration.progress >= 100) {
      migration.status = 'validating';
    } else if (migration.status === 'pending') {
      migration.status = 'in_progress';
    }

    return migration;
  }

  completeMigration(migrationId: string): MigrationWorkflow {
    const migration = this.migrations.get(migrationId);
    if (!migration) throw new Error(`Migration ${migrationId} not found`);
    if (migration.status !== 'validating') {
      throw new Error(`Migration must be in validating state to complete (current: ${migration.status})`);
    }

    migration.status = 'completed';
    migration.completedAt = new Date();
    migration.rollbackAvailable = true;

    const residency = this.tenantResidency.get(migration.tenantId);
    if (residency) {
      const oldRegion = this.regions.get(residency.primaryRegion);
      if (oldRegion) oldRegion.currentTenants = Math.max(0, oldRegion.currentTenants - 1);

      residency.primaryRegion = migration.targetRegion;
      residency.updatedAt = new Date();

      const newRegion = this.regions.get(migration.targetRegion);
      if (newRegion) newRegion.currentTenants++;
    }

    logger.info('Migration completed', { migrationId, tenantId: migration.tenantId });
    return migration;
  }

  rollbackMigration(migrationId: string): MigrationWorkflow {
    const migration = this.migrations.get(migrationId);
    if (!migration) throw new Error(`Migration ${migrationId} not found`);
    if (!migration.rollbackAvailable) {
      throw new Error(`Rollback not available for migration ${migrationId}`);
    }

    if (migration.status === 'completed') {
      const residency = this.tenantResidency.get(migration.tenantId);
      if (residency) {
        const currentRegion = this.regions.get(residency.primaryRegion);
        if (currentRegion) currentRegion.currentTenants = Math.max(0, currentRegion.currentTenants - 1);
        residency.primaryRegion = migration.sourceRegion;
        residency.updatedAt = new Date();
        const sourceRegion = this.regions.get(migration.sourceRegion);
        if (sourceRegion) sourceRegion.currentTenants++;
      }
    }

    migration.status = 'rolled_back';
    migration.rollbackAvailable = false;
    logger.info('Migration rolled back', { migrationId });
    return migration;
  }

  // ── Compliance Reporting ─────────────────────────────────────────────────

  generateComplianceReport(tenantId: string): ComplianceReport {
    const residency = this.tenantResidency.get(tenantId);
    if (!residency) throw new Error(`Tenant ${tenantId} has no residency assignment`);

    const region = this.regions.get(residency.primaryRegion);
    const violations: ComplianceViolation[] = [];

    if (region) {
      for (const req of residency.complianceRequirements) {
        if (!region.complianceFrameworks.includes(req)) {
          violations.push({
            framework: req,
            rule: 'region_compliance',
            description: `Primary region ${residency.primaryRegion} does not support ${req}`,
            severity: 'critical',
            remediation: `Migrate tenant to a region that supports ${req}`,
          });
        }
      }

      for (const replica of residency.replicaRegions) {
        const replicaRegion = this.regions.get(replica);
        if (!replicaRegion) {
          violations.push({
            framework: residency.complianceRequirements[0] ?? 'gdpr',
            rule: 'replica_availability',
            description: `Replica region ${replica} configuration not found`,
            severity: 'high',
            remediation: `Re-register region ${replica} or remove replica assignment`,
          });
          continue;
        }
        for (const req of residency.complianceRequirements) {
          if (!replicaRegion.complianceFrameworks.includes(req)) {
            violations.push({
              framework: req,
              rule: 'replica_compliance',
              description: `Replica region ${replica} does not support ${req}`,
              severity: 'high',
              remediation: `Remove replica region ${replica} or ensure it supports ${req}`,
            });
          }
        }
      }
    }

    // Check routing rules don't violate compliance
    const ruleIds = this.tenantRulesIndex.get(tenantId);
    if (ruleIds) {
      for (const ruleId of ruleIds) {
        const rule = this.routingRules.get(ruleId);
        if (!rule || !rule.enabled) continue;
        const targetRegion = this.regions.get(rule.targetRegion);
        if (targetRegion) {
          for (const req of residency.complianceRequirements) {
            if (!targetRegion.complianceFrameworks.includes(req)) {
              violations.push({
                framework: req,
                rule: 'routing_compliance',
                description: `Routing rule directs ${rule.dataCategory} data to ${rule.targetRegion} which does not support ${req}`,
                severity: 'medium',
                remediation: `Update routing rule ${rule.id} or add ${req} support to region ${rule.targetRegion}`,
              });
            }
          }
        }
      }
    }

    return {
      tenantId,
      region: residency.primaryRegion,
      frameworks: residency.complianceRequirements,
      compliant: violations.length === 0,
      violations,
      generatedAt: new Date(),
    };
  }

  getTenantResidency(tenantId: string): TenantResidency | null {
    return this.tenantResidency.get(tenantId) ?? null;
  }

  getMigration(migrationId: string): MigrationWorkflow | null {
    return this.migrations.get(migrationId) ?? null;
  }

  getTenantMigrations(tenantId: string): MigrationWorkflow[] {
    return Array.from(this.migrations.values()).filter((m) => m.tenantId === tenantId);
  }

  getStats(): {
    totalRegions: number;
    enabledRegions: number;
    totalTenants: number;
    activeMigrations: number;
  } {
    return {
      totalRegions: this.regions.size,
      enabledRegions: Array.from(this.regions.values()).filter((r) => r.enabled).length,
      totalTenants: this.tenantResidency.size,
      activeMigrations: Array.from(this.migrations.values()).filter(
        (m) => m.status === 'pending' || m.status === 'in_progress' || m.status === 'validating',
      ).length,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__dataResidencyController__';

export function getDataResidencyController(): DataResidencyController {
  const g = globalThis as unknown as Record<string, DataResidencyController>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new DataResidencyController();
  }
  return g[GLOBAL_KEY];
}

export type {
  RegionCode,
  RegionConfig,
  TenantResidency,
  RoutingRule,
  TransferRestriction,
  MigrationWorkflow,
  MigrationStatus,
  ComplianceReport,
  ComplianceViolation,
  ComplianceFramework,
  DataCategory,
};
