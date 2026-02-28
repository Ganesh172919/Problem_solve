/**
 * API Evolution Agent
 *
 * Autonomous API versioning, migration planning, and backward-compatibility
 * enforcement agent. Analyses API spec diffs for breaking changes, plans
 * tenant migrations between versions, enforces deprecation policies, generates
 * migration guides, and monitors client adoption across versions.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface APISpec {
  version: string;
  endpoints: EndpointSpec[];
  schemas: Record<string, SchemaSpec>;
  deprecated: string[];           // endpoint paths that are deprecated
}

export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  requestSchema?: string;
  responseSchema: string;
  deprecated?: boolean;
  replacedBy?: string;
  addedIn: string;                // semver version
  removedIn?: string;
}

export interface SchemaSpec {
  fields: FieldSpec[];
  required: string[];
  description: string;
}

export interface FieldSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  required: boolean;
  deprecated?: boolean;
  addedIn: string;
  removedIn?: string;
  format?: string;
}

export interface BreakingChange {
  type:
    | 'endpoint_removed'
    | 'field_removed'
    | 'field_type_changed'
    | 'required_field_added'
    | 'endpoint_path_changed'
    | 'response_schema_changed';
  path: string;
  description: string;
  migrationGuide: string;
  severity: 'breaking' | 'deprecation' | 'enhancement';
}

export interface MigrationPlan {
  fromVersion: string;
  toVersion: string;
  steps: MigrationStep[];
  estimatedEffort: 'low' | 'medium' | 'high';
  automatable: boolean;
}

export interface MigrationStep {
  order: number;
  description: string;
  codeTransformation?: string;
  dataTransformation?: string;
  rollbackable: boolean;
}

export interface CompatibilityMatrix {
  versions: string[];
  matrix: Record<string, Record<string, 'compatible' | 'migration_needed' | 'incompatible'>>;
}

export interface APIHealthReport {
  version: string;
  deprecatedEndpoints: string[];
  brokenClients: number;
  adoptionRate: number;           // 0-1: fraction of tenants on this version
  migrationReadiness: 'ready' | 'needs_work' | 'blocked';
}

// ---------------------------------------------------------------------------
// Agent Class
// ---------------------------------------------------------------------------

export class APIEvolutionAgent {
  private specs = new Map<string, APISpec>();
  private breakingChangesCache = new Map<string, BreakingChange[]>();
  private clientAdoption = new Map<string, Record<string, number>>();  // versionId → { tenantId: requestCount }
  private healthReports = new Map<string, APIHealthReport>();
  private deprecationLog: Array<{ path: string; deprecatedAt: number; scheduledRemoval: number }> = [];
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startEvolutionMonitoring();
  }

  // -------------------------------------------------------------------------
  // analyzeSpec
  // -------------------------------------------------------------------------

  analyzeSpec(spec: APISpec): { breakingChanges: BreakingChange[]; warnings: string[] } {
    const warnings: string[] = [];
    const changes: BreakingChange[] = [];

    // Check for endpoints missing response schema
    for (const ep of spec.endpoints) {
      if (!spec.schemas[ep.responseSchema]) {
        warnings.push(`Endpoint ${ep.method} ${ep.path} references unknown responseSchema '${ep.responseSchema}'.`);
      }
      if (ep.requestSchema && !spec.schemas[ep.requestSchema]) {
        warnings.push(`Endpoint ${ep.method} ${ep.path} references unknown requestSchema '${ep.requestSchema}'.`);
      }
      if (ep.deprecated && !ep.replacedBy) {
        warnings.push(`Endpoint ${ep.method} ${ep.path} is deprecated but 'replacedBy' is not specified.`);
      }
    }

    // Check for required fields without a type
    for (const [schemaName, schema] of Object.entries(spec.schemas)) {
      for (const field of schema.fields) {
        if (!field.type) {
          warnings.push(`Schema '${schemaName}', field '${field.name}' is missing a type declaration.`);
        }
        if (field.required && field.deprecated) {
          changes.push({
            type: 'required_field_added',
            path: `${schemaName}.${field.name}`,
            description: `Field '${field.name}' in schema '${schemaName}' is both required and deprecated – contradictory state.`,
            migrationGuide: `Make the field optional before deprecating, then remove it in the next major version.`,
            severity: 'breaking',
          });
        }
      }
      for (const req of schema.required) {
        if (!schema.fields.find(f => f.name === req)) {
          warnings.push(`Schema '${schemaName}' lists '${req}' as required but no field with that name exists.`);
        }
      }
    }

    this.specs.set(spec.version, spec);

    logger.info('API spec analysed', {
      version: spec.version,
      endpoints: spec.endpoints.length,
      schemas: Object.keys(spec.schemas).length,
      warnings: warnings.length,
      issues: changes.length,
    });

    return { breakingChanges: changes, warnings };
  }

  // -------------------------------------------------------------------------
  // detectBreakingChanges
  // -------------------------------------------------------------------------

  detectBreakingChanges(oldSpec: APISpec, newSpec: APISpec): BreakingChange[] {
    const cacheKey = `${oldSpec.version}->${newSpec.version}`;
    const cached = this.breakingChangesCache.get(cacheKey);
    if (cached) return cached;

    const changes: BreakingChange[] = [];

    const oldEndpointMap = new Map(
      oldSpec.endpoints.map(ep => [`${ep.method}:${ep.path}`, ep]),
    );
    const newEndpointMap = new Map(
      newSpec.endpoints.map(ep => [`${ep.method}:${ep.path}`, ep]),
    );

    // Detect removed endpoints (breaking)
    for (const [key, oldEp] of oldEndpointMap) {
      if (!newEndpointMap.has(key)) {
        changes.push({
          type: 'endpoint_removed',
          path: `${oldEp.method} ${oldEp.path}`,
          description: `Endpoint removed without a replacement in v${newSpec.version}.`,
          migrationGuide: oldEp.replacedBy
            ? `Migrate calls to ${oldEp.replacedBy}. Update request/response shapes accordingly.`
            : `No replacement provided. Audit all consumers and remove or proxy this endpoint.`,
          severity: 'breaking',
        });
      }
    }

    // Detect response schema changes per endpoint
    for (const [key, newEp] of newEndpointMap) {
      const oldEp = oldEndpointMap.get(key);
      if (!oldEp) continue;

      if (oldEp.responseSchema !== newEp.responseSchema) {
        changes.push({
          type: 'response_schema_changed',
          path: `${newEp.method} ${newEp.path}`,
          description: `Response schema changed from '${oldEp.responseSchema}' to '${newEp.responseSchema}'.`,
          migrationGuide: `Update consumer code to handle the new shape '${newEp.responseSchema}'. Run contract tests before deploying.`,
          severity: 'breaking',
        });
      }
    }

    // Detect schema field changes
    for (const [schemaName, newSchema] of Object.entries(newSpec.schemas)) {
      const oldSchema = oldSpec.schemas[schemaName];
      if (!oldSchema) continue;

      const oldFieldMap = new Map(oldSchema.fields.map(f => [f.name, f]));
      const newFieldMap = new Map(newSchema.fields.map(f => [f.name, f]));

      // Removed fields
      for (const [fieldName, oldField] of oldFieldMap) {
        if (!newFieldMap.has(fieldName) && !oldField.deprecated) {
          changes.push({
            type: 'field_removed',
            path: `${schemaName}.${fieldName}`,
            description: `Field '${fieldName}' removed from schema '${schemaName}' without prior deprecation.`,
            migrationGuide: `Deprecate the field for one major version before removal. Update consumers to stop reading '${fieldName}'.`,
            severity: 'breaking',
          });
        }
      }

      // Type changes
      for (const [fieldName, newField] of newFieldMap) {
        const oldField = oldFieldMap.get(fieldName);
        if (oldField && oldField.type !== newField.type) {
          changes.push({
            type: 'field_type_changed',
            path: `${schemaName}.${fieldName}`,
            description: `Field '${fieldName}' type changed from '${oldField.type}' to '${newField.type}'.`,
            migrationGuide: `Add a version-specific transformation layer. Provide both types during a transition period.`,
            severity: 'breaking',
          });
        }
      }

      // Newly added required fields
      for (const req of newSchema.required) {
        if (!oldSchema.required.includes(req) && !oldSchema.fields.find(f => f.name === req)) {
          changes.push({
            type: 'required_field_added',
            path: `${schemaName}.${req}`,
            description: `Required field '${req}' added to schema '${schemaName}' — consumers that omit it will receive 422.`,
            migrationGuide: `Populate '${req}' in all write operations before upgrading to v${newSpec.version}.`,
            severity: 'breaking',
          });
        }
      }
    }

    this.breakingChangesCache.set(cacheKey, changes);

    logger.info('Breaking changes detected', {
      from: oldSpec.version,
      to: newSpec.version,
      count: changes.length,
    });

    return changes;
  }

  // -------------------------------------------------------------------------
  // planMigration
  // -------------------------------------------------------------------------

  planMigration(fromSpec: APISpec, toSpec: APISpec): MigrationPlan {
    const changes = this.detectBreakingChanges(fromSpec, toSpec);
    const steps: MigrationStep[] = [];
    let order = 1;

    if (changes.length === 0) {
      steps.push({
        order: order++,
        description: `No breaking changes detected between v${fromSpec.version} and v${toSpec.version}. Update version header and test.`,
        rollbackable: true,
      });
    }

    for (const change of changes) {
      switch (change.type) {
        case 'endpoint_removed':
          steps.push({
            order: order++,
            description: `Remove calls to removed endpoint: ${change.path}`,
            codeTransformation: change.migrationGuide,
            rollbackable: false,
          });
          break;

        case 'field_removed':
          steps.push({
            order: order++,
            description: `Stop reading field '${change.path}' from API responses`,
            codeTransformation: `Remove all accesses to response.${change.path.split('.').pop()} in consumer code.`,
            rollbackable: true,
          });
          break;

        case 'field_type_changed':
          steps.push({
            order: order++,
            description: `Update type handling for '${change.path}'`,
            codeTransformation: change.migrationGuide,
            dataTransformation: `SELECT CAST(${change.path.split('.').pop()} AS new_type) FROM relevant_table WHERE version < '${toSpec.version}';`,
            rollbackable: true,
          });
          break;

        case 'required_field_added':
          steps.push({
            order: order++,
            description: `Populate newly required field '${change.path}' in all write payloads`,
            codeTransformation: change.migrationGuide,
            rollbackable: true,
          });
          break;

        case 'response_schema_changed':
          steps.push({
            order: order++,
            description: `Update response parsing for ${change.path}`,
            codeTransformation: change.migrationGuide,
            rollbackable: true,
          });
          break;

        default:
          steps.push({
            order: order++,
            description: change.migrationGuide,
            rollbackable: true,
          });
      }
    }

    // Final validation step always present
    steps.push({
      order: order++,
      description: `Run full contract test suite and integration tests against v${toSpec.version} staging environment.`,
      rollbackable: true,
    });

    const breakingCount = changes.filter(c => c.severity === 'breaking').length;
    const estimatedEffort: MigrationPlan['estimatedEffort'] =
      breakingCount === 0 ? 'low' : breakingCount <= 3 ? 'medium' : 'high';

    const automatable = changes.every(
      c => c.type === 'field_removed' || c.type === 'required_field_added',
    );

    const plan: MigrationPlan = {
      fromVersion: fromSpec.version,
      toVersion: toSpec.version,
      steps,
      estimatedEffort,
      automatable,
    };

    logger.info('Migration plan created', {
      from: fromSpec.version,
      to: toSpec.version,
      steps: steps.length,
      effort: estimatedEffort,
      automatable,
    });

    return plan;
  }

  // -------------------------------------------------------------------------
  // generateCompatibilityMatrix
  // -------------------------------------------------------------------------

  generateCompatibilityMatrix(specs: APISpec[]): CompatibilityMatrix {
    const versions = specs.map(s => s.version);
    const matrix: CompatibilityMatrix['matrix'] = {};

    for (const fromSpec of specs) {
      matrix[fromSpec.version] = {};
      for (const toSpec of specs) {
        if (fromSpec.version === toSpec.version) {
          matrix[fromSpec.version][toSpec.version] = 'compatible';
          continue;
        }
        const changes = this.detectBreakingChanges(fromSpec, toSpec);
        const breaking = changes.filter(c => c.severity === 'breaking').length;
        matrix[fromSpec.version][toSpec.version] =
          breaking === 0 ? 'compatible' : breaking <= 3 ? 'migration_needed' : 'incompatible';
      }
    }

    logger.info('Compatibility matrix generated', { versions });
    return { versions, matrix };
  }

  // -------------------------------------------------------------------------
  // enforceDeprecationPolicy
  // -------------------------------------------------------------------------

  enforceDeprecationPolicy(spec: APISpec, ageThresholdDays: number): EndpointSpec[] {
    const now = Date.now();
    const thresholdMs = ageThresholdDays * 24 * 3600_000;

    const violating: EndpointSpec[] = [];

    for (const ep of spec.endpoints) {
      if (!ep.deprecated) continue;

      const deprecationEntry = this.deprecationLog.find(d => d.path === ep.path);
      if (!deprecationEntry) {
        // Register deprecation
        this.deprecationLog.push({
          path: ep.path,
          deprecatedAt: now,
          scheduledRemoval: now + thresholdMs,
        });
        continue;
      }

      if (now - deprecationEntry.deprecatedAt > thresholdMs) {
        violating.push(ep);
        logger.warn('Deprecation policy violation – endpoint overdue for removal', {
          method: ep.method,
          path: ep.path,
          deprecatedAt: new Date(deprecationEntry.deprecatedAt).toISOString(),
          scheduledRemoval: new Date(deprecationEntry.scheduledRemoval).toISOString(),
        });
      }
    }

    return violating;
  }

  // -------------------------------------------------------------------------
  // generateMigrationGuide
  // -------------------------------------------------------------------------

  generateMigrationGuide(plan: MigrationPlan): string {
    const lines = [
      `# API Migration Guide: v${plan.fromVersion} → v${plan.toVersion}`,
      '',
      `**Estimated effort:** ${plan.estimatedEffort}  |  **Automatable:** ${plan.automatable ? 'Yes' : 'No'}`,
      '',
      `## Migration Steps`,
      '',
    ];

    for (const step of plan.steps) {
      lines.push(`### Step ${step.order}: ${step.description}`);
      if (step.codeTransformation) {
        lines.push('');
        lines.push('**Code transformation:**');
        lines.push('```typescript');
        lines.push(step.codeTransformation);
        lines.push('```');
      }
      if (step.dataTransformation) {
        lines.push('');
        lines.push('**Data migration SQL:**');
        lines.push('```sql');
        lines.push(step.dataTransformation);
        lines.push('```');
      }
      lines.push(`*Rollbackable: ${step.rollbackable ? 'Yes' : 'No'}*`);
      lines.push('');
    }

    lines.push('## Rollback Instructions');
    lines.push('');
    lines.push(`Pin your API client to version ${plan.fromVersion} by setting the \`X-API-Version: ${plan.fromVersion}\` header on all requests until migration is validated.`);
    lines.push('');
    lines.push(`Generated at: ${new Date().toISOString()}`);

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // monitorClientAdoption
  // -------------------------------------------------------------------------

  monitorClientAdoption(versionId: string): { usageByVersion: Record<string, number> } {
    // Aggregate request counts per version from the adoption log
    const usageByVersion: Record<string, number> = {};

    for (const [ver, tenantMap] of this.clientAdoption.entries()) {
      usageByVersion[ver] = Object.values(tenantMap).reduce((s, n) => s + n, 0);
    }

    // Ensure the requested version appears even if it has no traffic yet
    if (!usageByVersion[versionId]) usageByVersion[versionId] = 0;

    logger.info('Client adoption monitored', { versionId, usageByVersion });
    return { usageByVersion };
  }

  // -------------------------------------------------------------------------
  // suggestAPIImprovements
  // -------------------------------------------------------------------------

  suggestAPIImprovements(spec: APISpec): string[] {
    const suggestions: string[] = [];

    // Suggest pagination for collection endpoints
    for (const ep of spec.endpoints) {
      if (ep.method === 'GET' && ep.path.endsWith('s') && !ep.path.includes('{')) {
        suggestions.push(
          `${ep.method} ${ep.path}: Add cursor-based pagination parameters (\`after\`, \`limit\`) for scalability.`,
        );
      }
    }

    // Suggest versioning for long-lived endpoints
    if (!spec.version.startsWith('v')) {
      suggestions.push(`Adopt semantic versioning (e.g. 'v1.0.0') for spec version '${spec.version}'.`);
    }

    // Suggest replacing deprecated endpoints
    for (const dep of spec.deprecated) {
      const ep = spec.endpoints.find(e => e.path === dep);
      if (ep && !ep.replacedBy) {
        suggestions.push(`${dep}: Document the replacement endpoint in 'replacedBy' to assist client migration.`);
      }
    }

    // Field naming conventions
    for (const [schemaName, schema] of Object.entries(spec.schemas)) {
      for (const field of schema.fields) {
        if (field.name !== field.name.toLowerCase().replace(/ /g, '_') && !field.name.match(/^[a-z][a-zA-Z0-9]*$/)) {
          suggestions.push(`Schema '${schemaName}': Field '${field.name}' should use camelCase or snake_case consistently.`);
        }
      }
    }

    // Over-broad required field sets
    for (const [schemaName, schema] of Object.entries(spec.schemas)) {
      const requiredRatio = schema.required.length / Math.max(schema.fields.length, 1);
      if (requiredRatio > 0.8 && schema.fields.length > 5) {
        suggestions.push(`Schema '${schemaName}': ${(requiredRatio * 100).toFixed(0)}% of fields are required. Consider making non-critical fields optional to improve forward compatibility.`);
      }
    }

    return suggestions;
  }

  // -------------------------------------------------------------------------
  // runEvolutionCycle
  // -------------------------------------------------------------------------

  async runEvolutionCycle(currentSpec: APISpec): Promise<{
    recommendations: string[];
    deprecations: string[];
  }> {
    logger.info('Running API evolution cycle', { version: currentSpec.version });

    const { warnings } = this.analyzeSpec(currentSpec);
    const improvements = this.suggestAPIImprovements(currentSpec);
    const recommendations = [...warnings, ...improvements];

    const overdue = this.enforceDeprecationPolicy(currentSpec, 90);
    const deprecations = overdue.map(
      ep => `${ep.method} ${ep.path} has been deprecated >90 days. Schedule removal for next major release.`,
    );

    // Simulate async adoption metric refresh
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    const adoption = this.monitorClientAdoption(currentSpec.version);
    logger.info('Adoption snapshot', { adoption: adoption.usageByVersion });

    logger.info('Evolution cycle complete', {
      version: currentSpec.version,
      recommendations: recommendations.length,
      deprecations: deprecations.length,
    });

    return { recommendations, deprecations };
  }

  // -------------------------------------------------------------------------
  // getHealthReport
  // -------------------------------------------------------------------------

  getHealthReport(version: string): APIHealthReport {
    const cached = this.healthReports.get(version);
    if (cached) return cached;

    const spec = this.specs.get(version);
    const deprecatedEndpoints = spec?.endpoints
      .filter(ep => ep.deprecated)
      .map(ep => `${ep.method} ${ep.path}`) ?? [];

    const adoption = this.monitorClientAdoption(version);
    const totalRequests = Object.values(adoption.usageByVersion).reduce((s, n) => s + n, 0);
    const versionRequests = adoption.usageByVersion[version] ?? 0;
    const adoptionRate = totalRequests > 0 ? versionRequests / totalRequests : 0;

    const migrationReadiness: APIHealthReport['migrationReadiness'] =
      deprecatedEndpoints.length === 0
        ? 'ready'
        : deprecatedEndpoints.length <= 3
          ? 'needs_work'
          : 'blocked';

    const report: APIHealthReport = {
      version,
      deprecatedEndpoints,
      brokenClients: Math.floor(adoptionRate < 0.5 ? (1 - adoptionRate) * 10 : 0),
      adoptionRate,
      migrationReadiness,
    };

    this.healthReports.set(version, report);
    return report;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private startEvolutionMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      // Periodically refresh health reports for known specs
      this.specs.forEach((spec, version) => {
        this.healthReports.delete(version); // bust cache
        this.getHealthReport(version);
      });
    }, 3_600_000);
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
   
  var __apiEvolutionAgent__: APIEvolutionAgent | undefined;
}

export function getAPIEvolutionAgent(): APIEvolutionAgent {
  if (!globalThis.__apiEvolutionAgent__) {
    globalThis.__apiEvolutionAgent__ = new APIEvolutionAgent();
  }
  return globalThis.__apiEvolutionAgent__;
}
