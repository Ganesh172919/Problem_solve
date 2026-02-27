/**
 * @module schemaEvolutionAgent
 * @description Autonomous schema evolution agent that monitors production schemas,
 * detects opportunities for optimization, plans and validates migrations,
 * and coordinates zero-downtime schema changes with tenant awareness.
 */

import { getLogger } from '../lib/logger';
import {
  getSchemaEvolution,
  SchemaChange,
  ChangeType,
  TableSchema,
} from '../lib/dynamicSchemaEvolution';

const logger = getLogger();

export interface SchemaAnalysisResult {
  tableCount: number;
  totalColumns: number;
  missingIndexes: Array<{ table: string; column: string; reason: string }>;
  redundantIndexes: Array<{ table: string; indexName: string; reason: string }>;
  nullableColumnsWithoutDefault: Array<{ table: string; column: string }>;
  largeTables: Array<{ table: string; estimatedRows: number }>;
  recommendations: string[];
  score: number; // 0-100 schema health
}

export interface MigrationProposal {
  id: string;
  title: string;
  description: string;
  proposedChanges: SchemaChange[];
  estimatedRiskLevel: 'low' | 'medium' | 'high';
  estimatedDurationMs: number;
  rationale: string;
  requiresReview: boolean;
  autoApproved: boolean;
  createdAt: number;
}

export interface SchemaMonitoringReport {
  reportId: string;
  timestamp: number;
  analysis: SchemaAnalysisResult;
  proposals: MigrationProposal[];
  appliedMigrations: number;
  failedMigrations: number;
  pendingMigrations: number;
}

// ── Analyzer ──────────────────────────────────────────────────────────────────

function analyzeSchemas(tables: TableSchema[]): SchemaAnalysisResult {
  const missingIndexes: SchemaAnalysisResult['missingIndexes'] = [];
  const redundantIndexes: SchemaAnalysisResult['redundantIndexes'] = [];
  const nullableColumnsWithoutDefault: SchemaAnalysisResult['nullableColumnsWithoutDefault'] = [];
  const largeTables: SchemaAnalysisResult['largeTables'] = [];
  const recommendations: string[] = [];

  let totalColumns = 0;
  let healthScore = 100;

  for (const table of tables) {
    totalColumns += table.columns.length;

    // Check for columns that likely need indexes
    for (const col of table.columns) {
      if (col.references && !col.indexed) {
        missingIndexes.push({
          table: table.name,
          column: col.name,
          reason: 'Foreign key column without index causes slow JOIN operations',
        });
        healthScore -= 3;
      }

      if (col.name.endsWith('_id') && !col.indexed && !table.primaryKey.includes(col.name)) {
        missingIndexes.push({
          table: table.name,
          column: col.name,
          reason: 'ID-style column commonly used in WHERE clauses should be indexed',
        });
        healthScore -= 2;
      }

      if (col.nullable && col.defaultValue === undefined) {
        nullableColumnsWithoutDefault.push({ table: table.name, column: col.name });
      }
    }

    // Check for redundant indexes
    const indexedCols = new Set<string>();
    for (const idx of table.indexes) {
      const key = idx.columns.join(',');
      if (indexedCols.has(key)) {
        redundantIndexes.push({
          table: table.name,
          indexName: idx.name,
          reason: `Duplicate index on columns: ${key}`,
        });
        healthScore -= 2;
      }
      indexedCols.add(key);
    }

    // Missing primary key
    if (table.primaryKey.length === 0) {
      recommendations.push(`Table '${table.name}' has no primary key defined`);
      healthScore -= 10;
    }
  }

  if (missingIndexes.length > 5) recommendations.push('Consider a comprehensive index review');
  if (redundantIndexes.length > 0) recommendations.push('Remove redundant indexes to improve write performance');
  if (nullableColumnsWithoutDefault.length > 10) recommendations.push('Add default values to nullable columns for consistency');

  return {
    tableCount: tables.length,
    totalColumns,
    missingIndexes,
    redundantIndexes,
    nullableColumnsWithoutDefault,
    largeTables,
    recommendations,
    score: Math.max(0, Math.min(100, healthScore)),
  };
}

// ── Core Agent ────────────────────────────────────────────────────────────────

export class SchemaEvolutionAgent {
  private evolution = getSchemaEvolution();
  private proposals = new Map<string, MigrationProposal>();
  private reports: SchemaMonitoringReport[] = [];
  private appliedCount = 0;
  private failedCount = 0;
  private monitoringHandle: ReturnType<typeof setInterval> | null = null;
  private autoApproveRiskLevel: 'low' | 'none' = 'low';

  start(intervalMs = 600_000): void {
    this.monitoringHandle = setInterval(() => this.runMonitoringCycle(), intervalMs);
    logger.info('SchemaEvolutionAgent started', { intervalMs });
  }

  stop(): void {
    if (this.monitoringHandle) {
      clearInterval(this.monitoringHandle);
      this.monitoringHandle = null;
    }
    logger.info('SchemaEvolutionAgent stopped');
  }

  setAutoApproveRiskLevel(level: 'low' | 'none'): void {
    this.autoApproveRiskLevel = level;
  }

  analyzeTables(tables: TableSchema[]): SchemaAnalysisResult {
    return analyzeSchemas(tables);
  }

  proposeOptimizations(tables: TableSchema[], tenantId?: string): MigrationProposal[] {
    const analysis = analyzeSchemas(tables);
    const proposals: MigrationProposal[] = [];

    // Propose adding missing indexes
    if (analysis.missingIndexes.length > 0) {
      const changes: SchemaChange[] = analysis.missingIndexes.slice(0, 10).map(mi => ({
        id: `add_idx_${mi.table}_${mi.column}_${Date.now()}`,
        type: 'add_index' as ChangeType,
        table: mi.table,
        description: `Add index on ${mi.table}.${mi.column}`,
        upSQL: `CREATE INDEX CONCURRENTLY idx_${mi.table}_${mi.column} ON ${mi.table}(${mi.column});`,
        downSQL: `DROP INDEX IF EXISTS idx_${mi.table}_${mi.column};`,
        breakingChange: false,
        affectedEndpoints: [],
        estimatedDurationMs: 5000,
        requiresLock: false,
        requiresDowntime: false,
      }));

      const proposal: MigrationProposal = {
        id: `prop_indexes_${Date.now()}`,
        title: `Add ${changes.length} missing indexes`,
        description: `Performance optimization: add indexes to ${analysis.missingIndexes.length} columns used in common query patterns`,
        proposedChanges: changes,
        estimatedRiskLevel: 'low',
        estimatedDurationMs: changes.length * 5000,
        rationale: 'Missing indexes on foreign keys and ID columns cause full table scans',
        requiresReview: false,
        autoApproved: this.autoApproveRiskLevel === 'low',
        createdAt: Date.now(),
      };
      proposals.push(proposal);
    }

    // Propose removing redundant indexes
    if (analysis.redundantIndexes.length > 0) {
      const changes: SchemaChange[] = analysis.redundantIndexes.map(ri => ({
        id: `drop_idx_${ri.table}_${ri.indexName}`,
        type: 'drop_index' as ChangeType,
        table: ri.table,
        description: `Drop redundant index ${ri.indexName} on ${ri.table}`,
        upSQL: `DROP INDEX IF EXISTS ${ri.indexName};`,
        downSQL: `-- Dropped index was redundant, no rollback needed`,
        breakingChange: false,
        affectedEndpoints: [],
        estimatedDurationMs: 100,
        requiresLock: false,
        requiresDowntime: false,
      }));

      const proposal: MigrationProposal = {
        id: `prop_dropidx_${Date.now()}`,
        title: `Remove ${changes.length} redundant indexes`,
        description: 'Improve write performance by removing duplicate/redundant indexes',
        proposedChanges: changes,
        estimatedRiskLevel: 'low',
        estimatedDurationMs: changes.length * 100,
        rationale: 'Redundant indexes consume storage and slow down writes without query benefit',
        requiresReview: false,
        autoApproved: this.autoApproveRiskLevel === 'low',
        createdAt: Date.now(),
      };
      proposals.push(proposal);
    }

    for (const proposal of proposals) {
      this.proposals.set(proposal.id, proposal);
    }

    logger.info('Schema optimization proposals generated', {
      count: proposals.length,
      tenantId,
      schemaScore: analysis.score,
    });

    return proposals;
  }

  async applyProposal(proposalId: string, dryRun = false): Promise<{ success: boolean; migrationId?: string; error?: string }> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return { success: false, error: `Proposal not found: ${proposalId}` };
    if (proposal.requiresReview && !proposal.autoApproved) {
      return { success: false, error: 'Proposal requires human review before application' };
    }

    try {
      const migration = this.evolution.createMigration(
        proposal.title,
        `auto_${Date.now()}`,
        proposal.proposedChanges
      );
      await this.evolution.applyMigration(migration.id, dryRun);

      if (!dryRun) this.appliedCount++;
      logger.info('Proposal applied', { proposalId, migrationId: migration.id, dryRun });
      return { success: true, migrationId: migration.id };
    } catch (err) {
      this.failedCount++;
      const error = err instanceof Error ? err.message : String(err);
      logger.error('Failed to apply proposal', err instanceof Error ? err : new Error(String(err)), { proposalId });
      return { success: false, error };
    }
  }

  private runMonitoringCycle(): void {
    logger.debug('SchemaEvolutionAgent monitoring cycle', {
      proposals: this.proposals.size,
      applied: this.appliedCount,
      failed: this.failedCount,
    });
  }

  getProposals(): MigrationProposal[] {
    return Array.from(this.proposals.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getStats(): {
    proposals: number;
    appliedCount: number;
    failedCount: number;
    pendingMigrations: number;
  } {
    return {
      proposals: this.proposals.size,
      appliedCount: this.appliedCount,
      failedCount: this.failedCount,
      pendingMigrations: this.evolution.getPendingMigrations().length,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __schemaEvolutionAgent__: SchemaEvolutionAgent | undefined;
}

export function getSchemaEvolutionAgent(): SchemaEvolutionAgent {
  if (!globalThis.__schemaEvolutionAgent__) {
    globalThis.__schemaEvolutionAgent__ = new SchemaEvolutionAgent();
  }
  return globalThis.__schemaEvolutionAgent__;
}
