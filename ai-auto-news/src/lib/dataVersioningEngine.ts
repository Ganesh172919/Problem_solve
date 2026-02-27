/**
 * Data Versioning Engine
 *
 * Entity data versioning with time-travel queries, branching, and schema
 * evolution management. Implements:
 * - Deep object diff (added / removed / modified fields)
 * - Binary search for time-travel queries across version timestamps
 * - Branch/merge with three-way conflict detection
 * - Schema registration and up/down migration transforms
 * - Efficient storage with per-version diffs
 */

import { getLogger } from './logger';

const logger = getLogger();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DataDiff {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Record<string, [unknown, unknown]>; // [old, new]
}

export interface DataVersion {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  data: Record<string, unknown>;
  diff: DataDiff;
  author: string;
  timestamp: number;
  reason?: string;
  tags: string[];
}

export interface VersionQuery {
  entityType: string;
  entityId: string;
  fromVersion?: number;
  toVersion?: number;
  fromTimestamp?: number;
  toTimestamp?: number;
  tags?: string[];
}

export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  defaultValue?: unknown;
  deprecated?: boolean;
}

export interface Migration {
  id: string;
  description: string;
  transform: string;    // serialised JS transform body for up/down
  reversible: boolean;
}

export interface SchemaVersion {
  id: string;
  entityType: string;
  version: number;
  schema: Record<string, FieldSchema>;
  migrationsUp: Migration[];
  migrationsDown: Migration[];
}

export interface TimeTravelResult {
  entityId: string;
  entityType: string;
  asOf: number;
  data: Record<string, unknown>;
  version: number;
}

export interface BranchVersion {
  id: string;
  baseVersion: number;
  branchName: string;
  entityId: string;
  entityType: string;
  commits: DataVersion[];
  mergedAt?: number;
}

export interface VersioningStats {
  totalVersions: number;
  totalEntities: number;
  avgVersionsPerEntity: number;
  storageBytes: number;
  oldestVersion: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function estimateBytes(obj: unknown): number {
  return JSON.stringify(obj)?.length ?? 0;
}

// ─── Class ────────────────────────────────────────────────────────────────────

class DataVersioningEngine {
  /** entityId -> sorted array of DataVersion (ascending by version) */
  private readonly store = new Map<string, DataVersion[]>();
  /** entityId -> BranchVersion[] */
  private readonly branches = new Map<string, BranchVersion[]>();
  /** entityType -> SchemaVersion[] (ascending by version) */
  private readonly schemas = new Map<string, SchemaVersion[]>();
  private idCounter = 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  save(
    entityType: string,
    entityId: string,
    data: Record<string, unknown>,
    author: string,
    reason?: string,
    tags: string[] = [],
  ): DataVersion {
    const history = this.getHistory(entityId);
    const prevVersion = history[history.length - 1];
    const version = prevVersion ? prevVersion.version + 1 : 1;
    const prevData = prevVersion?.data ?? {};
    const diff = this.computeDiff(prevData, data);

    const dv: DataVersion = {
      id: `dv_${++this.idCounter}`,
      entityType, entityId, version,
      data: this.deepClone(data),
      diff, author,
      timestamp: Date.now(),
      tags,
      ...(reason !== undefined ? { reason } : {}),
    };

    history.push(dv);
    this.store.set(entityId, history);
    logger.debug('Data version saved', { entityId, entityType, version, author });
    return dv;
  }

  getVersion(entityId: string, version: number): DataVersion | undefined {
    return this.getHistory(entityId).find(v => v.version === version);
  }

  getLatest(entityId: string): DataVersion | undefined {
    const history = this.getHistory(entityId);
    return history[history.length - 1];
  }

  /**
   * Binary search on sorted timestamp array to find the version
   * that was current at `timestamp`.
   */
  travelToTime(entityId: string, timestamp: number): TimeTravelResult | undefined {
    const history = this.getHistory(entityId);
    if (history.length === 0) return undefined;

    let lo = 0;
    let hi = history.length - 1;
    let best: DataVersion | undefined;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (history[mid].timestamp <= timestamp) {
        best = history[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (!best) return undefined;

    return {
      entityId,
      entityType: best.entityType,
      asOf: timestamp,
      data: this.deepClone(best.data),
      version: best.version,
    };
  }

  queryVersions(query: VersionQuery): DataVersion[] {
    const history = this.getHistory(query.entityId);
    return history.filter(v => {
      if (v.entityType !== query.entityType) return false;
      if (query.fromVersion !== undefined && v.version < query.fromVersion) return false;
      if (query.toVersion !== undefined && v.version > query.toVersion) return false;
      if (query.fromTimestamp !== undefined && v.timestamp < query.fromTimestamp) return false;
      if (query.toTimestamp !== undefined && v.timestamp > query.toTimestamp) return false;
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.some(t => v.tags.includes(t))) return false;
      }
      return true;
    });
  }

  diff(entityId: string, v1: number, v2: number): DataDiff {
    const ver1 = this.getVersion(entityId, v1);
    const ver2 = this.getVersion(entityId, v2);
    if (!ver1) throw new Error(`Version ${v1} not found for entity '${entityId}'`);
    if (!ver2) throw new Error(`Version ${v2} not found for entity '${entityId}'`);
    return this.computeDiff(ver1.data, ver2.data);
  }

  revert(entityId: string, targetVersion: number, author: string): DataVersion {
    const target = this.getVersion(entityId, targetVersion);
    if (!target) throw new Error(`Version ${targetVersion} not found for entity '${entityId}'`);

    logger.info('Reverting entity to version', { entityId, targetVersion, author });
    return this.save(
      target.entityType, entityId, target.data, author,
      `Reverted to v${targetVersion}`, ['revert'],
    );
  }

  createBranch(entityId: string, branchName: string): BranchVersion {
    const latest = this.getLatest(entityId);
    if (!latest) throw new Error(`No versions found for entity '${entityId}'`);
    const branch: BranchVersion = {
      id: `branch_${++this.idCounter}_${branchName}`, baseVersion: latest.version,
      branchName, entityId, entityType: latest.entityType, commits: [],
    };
    const entityBranches = this.branches.get(entityId) ?? [];
    entityBranches.push(branch);
    this.branches.set(entityId, entityBranches);
    logger.info('Branch created', { entityId, branchName, baseVersion: latest.version });
    return branch;
  }

  mergeBranch(branchId: string, author: string): DataVersion {
    let foundBranch: BranchVersion | undefined;
    let entityId = '';
    for (const [eid, bList] of this.branches) {
      const b = bList.find(x => x.id === branchId);
      if (b) { foundBranch = b; entityId = eid; break; }
    }
    if (!foundBranch) throw new Error(`Branch '${branchId}' not found`);
    if (foundBranch.mergedAt) throw new Error(`Branch '${branchId}' already merged`);
    if (foundBranch.commits.length === 0) throw new Error(`Branch '${branchId}' has no commits to merge`);

    const baseVer = this.getVersion(entityId, foundBranch.baseVersion);
    const mainTip = this.getLatest(entityId);
    const branchTip = foundBranch.commits[foundBranch.commits.length - 1];
    if (!baseVer || !mainTip) throw new Error(`Could not resolve base or main version for merge`);

    const merged = this.threeWayMerge(baseVer.data, mainTip.data, branchTip.data);
    foundBranch.mergedAt = Date.now();
    logger.info('Branch merged', { branchId, entityId, baseVersion: foundBranch.baseVersion, mainVersion: mainTip.version });
    return this.save(branchTip.entityType, entityId, merged, author, `Merged branch '${foundBranch.branchName}'`, ['merge']);
  }

  /** Commit a data version onto a branch (does not update main store). */
  commitToBranch(branchId: string, data: Record<string, unknown>, author: string, reason?: string): DataVersion {
    let foundBranch: BranchVersion | undefined;
    for (const bList of this.branches.values()) {
      const b = bList.find(x => x.id === branchId);
      if (b) { foundBranch = b; break; }
    }
    if (!foundBranch) throw new Error(`Branch '${branchId}' not found`);
    if (foundBranch.mergedAt) throw new Error(`Branch '${branchId}' is already merged`);

    const prevCommit = foundBranch.commits[foundBranch.commits.length - 1];
    const baseVer = !prevCommit ? this.getVersion(foundBranch.entityId, foundBranch.baseVersion) : prevCommit;
    const dv: DataVersion = {
      id: `dv_${++this.idCounter}`, entityType: foundBranch.entityType,
      entityId: foundBranch.entityId,
      version: (prevCommit?.version ?? foundBranch.baseVersion) + 1,
      data: this.deepClone(data), diff: this.computeDiff(baseVer?.data ?? {}, data),
      author, timestamp: Date.now(), tags: ['branch'],
      ...(reason !== undefined ? { reason } : {}),
    };
    foundBranch.commits.push(dv);
    return dv;
  }

  registerSchema(entityType: string, schema: Omit<SchemaVersion, 'id'>): SchemaVersion {
    const id = `schema_${++this.idCounter}_${entityType}_v${schema.version}`;
    const sv: SchemaVersion = { ...schema, id };
    const existing = this.schemas.get(entityType) ?? [];
    existing.push(sv);
    existing.sort((a, b) => a.version - b.version);
    this.schemas.set(entityType, existing);
    logger.info('Schema registered', { entityType, version: schema.version, id });
    return sv;
  }

  migrateEntity(entityId: string, targetSchemaVersion: number): DataVersion {
    const latest = this.getLatest(entityId);
    if (!latest) throw new Error(`Entity '${entityId}' not found`);

    const schemaList = this.schemas.get(latest.entityType);
    if (!schemaList || schemaList.length === 0) {
      throw new Error(`No schemas registered for type '${latest.entityType}'`);
    }

    const targetSchema = schemaList.find(s => s.version === targetSchemaVersion);
    if (!targetSchema) {
      throw new Error(`Schema version ${targetSchemaVersion} not found for type '${latest.entityType}'`);
    }

    let data = this.deepClone(latest.data);
    const currentSchemaVersion = schemaList.findIndex(s => s.version > 0) >= 0
      ? Math.max(...schemaList.map(s => s.version).filter(v => v <= targetSchemaVersion))
      : 1;

    // Apply up/down migrations in order
    const relevantSchemas = currentSchemaVersion < targetSchemaVersion
      ? schemaList.filter(s => s.version <= targetSchemaVersion)
      : schemaList.filter(s => s.version > targetSchemaVersion).reverse();

    const direction = currentSchemaVersion < targetSchemaVersion ? 'up' : 'down';

    for (const sv of relevantSchemas) {
      const migrations = direction === 'up' ? sv.migrationsUp : sv.migrationsDown;
      for (const migration of migrations) {
        data = this.applyMigration(data, migration, direction);
        logger.debug('Migration applied', { entityId, migrationId: migration.id, direction });
      }
    }

    // Apply schema defaults for missing required fields
    data = this.applySchemaDefaults(data, targetSchema.schema);

    return this.save(
      latest.entityType, entityId, data, 'system',
      `Migrated to schema v${targetSchemaVersion}`, ['migration'],
    );
  }

  getStats(): VersioningStats {
    let totalVersions = 0;
    let storageBytes = 0;
    let oldestVersion = Date.now();

    for (const history of this.store.values()) {
      totalVersions += history.length;
      for (const v of history) {
        storageBytes += estimateBytes(v);
        if (v.timestamp < oldestVersion) oldestVersion = v.timestamp;
      }
    }

    const totalEntities = this.store.size;
    const avgVersionsPerEntity = totalEntities > 0 ? totalVersions / totalEntities : 0;

    return { totalVersions, totalEntities, avgVersionsPerEntity, storageBytes, oldestVersion };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private computeDiff(
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
  ): DataDiff {
    const added: Record<string, unknown> = {};
    const removed: Record<string, unknown> = {};
    const modified: Record<string, [unknown, unknown]> = {};

    // Fields in new but not old
    for (const key of Object.keys(newData)) {
      if (!(key in oldData)) {
        added[key] = newData[key];
      } else if (!this.deepEqual(oldData[key], newData[key])) {
        modified[key] = [oldData[key], newData[key]];
      }
    }

    // Fields in old but not new
    for (const key of Object.keys(oldData)) {
      if (!(key in newData)) {
        removed[key] = oldData[key];
      }
    }

    return { added, removed, modified };
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(k => this.deepEqual(aObj[k], bObj[k]));
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
  }

  private getHistory(entityId: string): DataVersion[] {
    if (!this.store.has(entityId)) this.store.set(entityId, []);
    return this.store.get(entityId)!;
  }

  /** Three-way merge: branch wins over main on conflict, respects branch deletions. */
  private threeWayMerge(
    base: Record<string, unknown>,
    main: Record<string, unknown>,
    branch: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...main };
    for (const key of new Set([...Object.keys(base), ...Object.keys(main), ...Object.keys(branch)])) {
      const mainChanged = (key in main) && (!( key in base) || !this.deepEqual(base[key], main[key]));
      const branchChanged = (key in branch) && (!(key in base) || !this.deepEqual(base[key], branch[key]));
      if (branchChanged) {
        if (mainChanged) logger.warn('Merge conflict – preferring branch value', { key });
        result[key] = branch[key];
      } else if (!(key in branch) && (key in base)) {
        delete result[key];
      }
    }
    return result;
  }

  private applyMigration(
    data: Record<string, unknown>,
    migration: Migration,
    direction: 'up' | 'down',
  ): Record<string, unknown> {
    if (!migration.reversible && direction === 'down') {
      logger.warn('Non-reversible migration skipped for down direction', { id: migration.id });
      return data;
    }
    const result = this.deepClone(data);
    for (const raw of migration.transform.split(',').map(s => s.trim()).filter(Boolean)) {
      const [field, action, value] = raw.split(':');
      if (!field || !action) continue;
      const eff = direction === 'down'
        ? (action === 'add' ? 'remove' : action === 'remove' ? 'add' : action)
        : action;
      if (eff === 'rename' && value && field in result) { result[value] = result[field]; delete result[field]; }
      else if (eff === 'remove') { delete result[field]; }
      else if ((eff === 'add' || eff === 'default') && !(field in result)) { result[field] = this.parseTransformValue(value ?? ''); }
      else if (eff === 'set') { result[field] = this.parseTransformValue(value ?? ''); }
      else if (eff === 'cast_number' && field in result) { result[field] = Number(result[field]); }
      else if (eff === 'cast_string' && field in result) { result[field] = String(result[field]); }
    }
    return result;
  }

  private parseTransformValue(value: string): unknown {
    if (value === 'null') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    return (!isNaN(num) && value.trim() !== '') ? num : value;
  }

  private applySchemaDefaults(data: Record<string, unknown>, schema: Record<string, FieldSchema>): Record<string, unknown> {
    const result = { ...data };
    for (const [field, def] of Object.entries(schema)) {
      if (!def.deprecated && def.required && !(field in result)) {
        result[field] = def.defaultValue ?? (() => {
          const defaults: Record<FieldSchema['type'], unknown> = { string: '', number: 0, boolean: false, array: [], object: {} };
          return defaults[def.type];
        })();
      }
    }
    return result;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__dataVersioningEngine__';

export function getDataVersioningEngine(): DataVersioningEngine {
  const g = globalThis as unknown as Record<string, DataVersioningEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new DataVersioningEngine();
    logger.info('DataVersioningEngine initialised');
  }
  return g[GLOBAL_KEY];
}

export { DataVersioningEngine };
