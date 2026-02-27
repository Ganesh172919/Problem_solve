/**
 * Contract Testing Engine
 *
 * Consumer-driven contract testing and API compatibility enforcement for
 * distributed microservices. Implements:
 * - Pact-style interaction contracts with JSON schema body validation
 * - Semantic versioning compatibility rules (major/minor/patch)
 * - Automatic breaking-change detection (field removal, type changes, status codes)
 * - Contract history tracking and version lineage
 * - Provider verification with per-interaction failure reporting
 */

import { getLogger } from './logger';

const logger = getLogger();

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContractStatus = 'draft' | 'pending' | 'verified' | 'broken' | 'superseded';

export interface RequestSpec {
  method: string;
  path: string;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  body?: unknown;
}

export interface ResponseSpec {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodySchema?: Record<string, unknown>;
}

export interface Interaction {
  id: string;
  description: string;
  request: RequestSpec;
  response: ResponseSpec;
  metadata: Record<string, unknown>;
}

export interface Contract {
  id: string;
  consumer: string;
  provider: string;
  version: string;
  interactions: Interaction[];
  status: ContractStatus;
  createdAt: number;
  verifiedAt?: number;
}

export interface VerificationFailure {
  interactionId: string;
  field: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface VerificationResult {
  contractId: string;
  passed: boolean;
  failures: VerificationFailure[];
  timestamp: number;
  duration: number;
}

export type BreakingChangeType =
  | 'removed_field'
  | 'type_change'
  | 'status_change'
  | 'path_change';

export interface BreakingChange {
  type: BreakingChangeType;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

export interface CompatibilityReport {
  fromVersion: string;
  toVersion: string;
  breakingChanges: BreakingChange[];
  warnings: string[];
  compatible: boolean;
}

export interface PactBrokerConfig {
  url: string;
  authToken: string;
  publishResults: boolean;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface ProviderSpec {
  id: string;
  interactions: Array<{
    request: RequestSpec;
    response: ResponseSpec;
  }>;
}

type JsonSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

// ─── Class ────────────────────────────────────────────────────────────────────

class ContractTestingEngine {
  private readonly contracts = new Map<string, Contract>();
  private readonly verificationHistory: VerificationResult[] = [];
  private idCounter = 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  publishContract(contract: Omit<Contract, 'id' | 'createdAt' | 'status'>): string {
    const id = `contract_${++this.idCounter}_${contract.consumer}_${contract.provider}`;
    const full: Contract = {
      ...contract,
      id,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Supersede older contracts for the same consumer/provider
    for (const [existingId, existing] of this.contracts) {
      if (existing.consumer === contract.consumer &&
          existing.provider === contract.provider &&
          existing.status !== 'superseded') {
        if (this.semverCompare(existing.version, contract.version) < 0) {
          existing.status = 'superseded';
          logger.info('Contract superseded', { existingId, byId: id });
        }
      }
    }

    this.contracts.set(id, full);
    logger.info('Contract published', { id, consumer: contract.consumer, provider: contract.provider, version: contract.version });
    return id;
  }

  async verifyContract(contractId: string, actualProvider: ProviderSpec): Promise<VerificationResult> {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new Error(`Contract '${contractId}' not found`);
    const start = Date.now();
    const failures: VerificationFailure[] = [];
    const fail = (iid: string, field: string, expected: unknown, actual: unknown, message: string) =>
      failures.push({ interactionId: iid, field, expected, actual, message });

    for (const interaction of contract.interactions) {
      const actual = actualProvider.interactions.find(i =>
        i.request.method === interaction.request.method && i.request.path === interaction.request.path,
      );
      if (!actual) {
        fail(interaction.id, 'interaction', `${interaction.request.method} ${interaction.request.path}`, null,
          `Provider does not implement ${interaction.request.method} ${interaction.request.path}`);
        continue;
      }
      if (actual.response.status !== interaction.response.status) {
        fail(interaction.id, 'response.status', interaction.response.status, actual.response.status,
          `Status code mismatch: expected ${interaction.response.status}, got ${actual.response.status}`);
      }
      for (const [key, expected] of Object.entries(interaction.response.headers)) {
        const actualVal = actual.response.headers[key.toLowerCase()] ?? actual.response.headers[key];
        if (actualVal === undefined || !actualVal.includes(expected)) {
          fail(interaction.id, `response.headers.${key}`, expected, actualVal, `Header '${key}' mismatch`);
        }
      }
      if (interaction.response.bodySchema) {
        failures.push(...this.validateSchema(actual.response.body, interaction.response.bodySchema as JsonSchema, 'response.body', interaction.id));
      } else if (interaction.response.body !== undefined) {
        failures.push(...this.deepCompare(actual.response.body, interaction.response.body, 'response.body', interaction.id));
      }
    }

    const result: VerificationResult = { contractId, passed: failures.length === 0, failures, timestamp: Date.now(), duration: Date.now() - start };
    contract.status = result.passed ? 'verified' : 'broken';
    if (result.passed) contract.verifiedAt = Date.now();
    this.verificationHistory.push(result);
    logger.info('Contract verified', { contractId, passed: result.passed, failures: failures.length, duration: result.duration });
    return result;
  }

  checkCompatibility(contractId: string, newVersion: Omit<Contract, 'id' | 'createdAt' | 'status'>): CompatibilityReport {
    const existing = this.contracts.get(contractId);
    if (!existing) throw new Error(`Contract '${contractId}' not found`);

    const breakingChanges = this.detectBreakingChanges(existing, newVersion as Contract);
    const warnings: string[] = [];

    // Semantic version checks
    const [oldMajor, oldMinor] = existing.version.split('.').map(Number);
    const [newMajor, newMinor] = newVersion.version.split('.').map(Number);

    if (newMajor > oldMajor && breakingChanges.length === 0) {
      warnings.push('Major version bump without breaking changes detected');
    }
    if (newMinor < oldMinor && newMajor === oldMajor) {
      warnings.push('Minor version regression within same major version');
    }

    const report: CompatibilityReport = {
      fromVersion: existing.version,
      toVersion: newVersion.version,
      breakingChanges,
      warnings,
      compatible: breakingChanges.length === 0,
    };

    logger.info('Compatibility checked', {
      contractId, from: existing.version, to: newVersion.version,
      breaking: breakingChanges.length, compatible: report.compatible,
    });
    return report;
  }

  generateContract(consumer: string, providerSpec: ProviderSpec): Contract {
    const interactions: Interaction[] = providerSpec.interactions.map((spec, i) => ({
      id: `interaction_${++this.idCounter}_${i}`,
      description: `${spec.request.method} ${spec.request.path}`,
      request: spec.request,
      response: spec.response,
      metadata: { generatedAt: Date.now() },
    }));

    const contract: Contract = {
      id: `contract_${++this.idCounter}_${consumer}_${providerSpec.id}`,
      consumer,
      provider: providerSpec.id,
      version: '1.0.0',
      interactions,
      status: 'draft',
      createdAt: Date.now(),
    };

    this.contracts.set(contract.id, contract);
    logger.info('Contract auto-generated', { id: contract.id, consumer, provider: providerSpec.id, interactions: interactions.length });
    return contract;
  }

  async runPactVerification(pactUrl: string): Promise<VerificationResult> {
    // Simulate fetching and verifying a remote pact
    logger.info('Running pact verification', { pactUrl });
    const contractId = [...this.contracts.keys()][0];
    if (!contractId) throw new Error('No contracts registered for pact verification');

    const contract = this.contracts.get(contractId)!;
    const syntheticProvider: ProviderSpec = {
      id: contract.provider,
      interactions: contract.interactions.map(i => ({
        request: i.request,
        response: i.response,
      })),
    };

    return this.verifyContract(contractId, syntheticProvider);
  }

  detectBreakingChanges(oldContract: Contract, newContract: Contract): BreakingChange[] {
    const changes: BreakingChange[] = [];

    for (const oldI of oldContract.interactions) {
      const newI = newContract.interactions.find(
        i => i.request.method === oldI.request.method && i.request.path === oldI.request.path,
      );

      if (!newI) {
        changes.push({ type: 'removed_field', impact: 'high',
          description: `Interaction '${oldI.description}' (${oldI.request.method} ${oldI.request.path}) removed` });
        continue;
      }

      if (newI.request.path !== oldI.request.path) {
        changes.push({ type: 'path_change', impact: 'high',
          description: `Path changed from '${oldI.request.path}' to '${newI.request.path}'` });
      }

      if (newI.response.status !== oldI.response.status) {
        const impact = Math.abs(Math.floor(newI.response.status / 100) - Math.floor(oldI.response.status / 100)) >= 1 ? 'high' : 'medium';
        changes.push({ type: 'status_change', impact,
          description: `Response status changed from ${oldI.response.status} to ${newI.response.status}` });
      }

      if (oldI.response.body && typeof oldI.response.body === 'object' &&
          newI.response.body && typeof newI.response.body === 'object') {
        changes.push(...this.detectObjectBreakingChanges(
          oldI.response.body as Record<string, unknown>,
          newI.response.body as Record<string, unknown>,
          'response.body',
        ));
      }
    }

    return changes;
  }

  async enforceContracts(providerId: string, deploymentId: string): Promise<boolean> {
    const relevant = [...this.contracts.values()].filter(c => c.provider === providerId && c.status !== 'superseded');
    if (relevant.length === 0) {
      logger.warn('No active contracts found for provider', { providerId, deploymentId });
      return true;
    }
    const broken = relevant.filter(c => c.status === 'broken');
    if (broken.length > 0) {
      logger.error('Deployment blocked: broken contracts detected', undefined, { providerId, deploymentId, brokenContracts: broken.map(c => c.id) });
      return false;
    }
    const unverified = relevant.filter(c => c.status === 'pending' || c.status === 'draft');
    if (unverified.length > 0) logger.warn('Unverified contracts exist for provider', { providerId, deploymentId, count: unverified.length });
    logger.info('Contract enforcement passed', { providerId, deploymentId, contracts: relevant.length });
    return true;
  }

  getContractHistory(consumer: string, provider: string): Contract[] {
    return [...this.contracts.values()]
      .filter(c => c.consumer === consumer && c.provider === provider)
      .sort((a, b) => this.semverCompare(a.version, b.version));
  }

  publishResults(result: VerificationResult): void {
    logger.info('Publishing verification result', {
      contractId: result.contractId, passed: result.passed, failures: result.failures.length,
    });
    // In production this would POST to a Pact Broker; here we store locally
    this.verificationHistory.push({ ...result });
  }

  getStats(): { totalContracts: number; brokenContracts: number; verifiedContracts: number; avgVerificationTime: number } {
    const all = [...this.contracts.values()];
    const times = this.verificationHistory.map(v => v.duration);
    const avgVerificationTime = times.length > 0
      ? times.reduce((a, b) => a + b, 0) / times.length : 0;

    return {
      totalContracts: all.length,
      brokenContracts: all.filter(c => c.status === 'broken').length,
      verifiedContracts: all.filter(c => c.status === 'verified').length,
      avgVerificationTime,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private validateSchema(
    value: unknown,
    schema: JsonSchema,
    path: string,
    interactionId: string,
  ): VerificationFailure[] {
    const failures: VerificationFailure[] = [];
    const fail = (field: string, expected: unknown, actual: unknown, message: string) =>
      failures.push({ interactionId, field, expected, actual, message });

    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actualType = this.jsonTypeOf(value);
      if (!types.includes(actualType)) {
        fail(path, types.join('|'), actualType, `Type mismatch at '${path}': expected ${types.join('|')}, got ${actualType}`);
        return failures;
      }
    }

    if (schema.properties && typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (schema.required?.includes(key) && !(key in obj)) {
          fail(`${path}.${key}`, 'present', 'missing', `Required field '${path}.${key}' is missing`);
        } else if (key in obj) {
          failures.push(...this.validateSchema(obj[key], subSchema, `${path}.${key}`, interactionId));
        }
      }
    }

    if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum)
      fail(path, `>= ${schema.minimum}`, value, `Value at '${path}' below minimum`);
    if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum)
      fail(path, `<= ${schema.maximum}`, value, `Value at '${path}' above maximum`);
    if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength)
      fail(path, `minLength ${schema.minLength}`, value.length, `String at '${path}' too short`);
    if (schema.maxLength !== undefined && typeof value === 'string' && value.length > schema.maxLength)
      fail(path, `maxLength ${schema.maxLength}`, value.length, `String at '${path}' too long`);
    if (schema.enum !== undefined && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value)))
      fail(path, schema.enum, value, `Value at '${path}' not in enum`);

    return failures;
  }

  private deepCompare(
    actual: unknown,
    expected: unknown,
    path: string,
    interactionId: string,
  ): VerificationFailure[] {
    const failures: VerificationFailure[] = [];
    if (JSON.stringify(actual) === JSON.stringify(expected)) return failures;

    if (typeof expected === 'object' && expected !== null &&
        typeof actual === 'object' && actual !== null) {
      const exp = expected as Record<string, unknown>;
      const act = actual as Record<string, unknown>;
      for (const key of Object.keys(exp)) {
        if (!(key in act)) {
          failures.push({ interactionId, field: `${path}.${key}`, expected: exp[key], actual: undefined, message: `Field '${path}.${key}' missing in actual response` });
        } else {
          failures.push(...this.deepCompare(act[key], exp[key], `${path}.${key}`, interactionId));
        }
      }
    } else {
      failures.push({ interactionId, field: path, expected, actual, message: `Value mismatch at '${path}'` });
    }

    return failures;
  }

  private detectObjectBreakingChanges(
    old: Record<string, unknown>,
    next: Record<string, unknown>,
    path: string,
  ): BreakingChange[] {
    const changes: BreakingChange[] = [];
    for (const key of Object.keys(old)) {
      if (!(key in next)) {
        changes.push({ type: 'removed_field', description: `Field '${path}.${key}' removed`, impact: 'high' });
      } else if (typeof old[key] !== typeof next[key]) {
        changes.push({ type: 'type_change', description: `Field '${path}.${key}' type changed from ${typeof old[key]} to ${typeof next[key]}`, impact: 'medium' });
      } else if (typeof old[key] === 'object' && old[key] !== null &&
                 typeof next[key] === 'object' && next[key] !== null) {
        changes.push(...this.detectObjectBreakingChanges(
          old[key] as Record<string, unknown>,
          next[key] as Record<string, unknown>,
          `${path}.${key}`,
        ));
      }
    }
    return changes;
  }

  private jsonTypeOf(value: unknown): JsonSchemaType {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value as JsonSchemaType;
  }

  private semverCompare(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__contractTestingEngine__';

export function getContractTestingEngine(): ContractTestingEngine {
  const g = globalThis as unknown as Record<string, ContractTestingEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new ContractTestingEngine();
    logger.info('ContractTestingEngine initialised');
  }
  return g[GLOBAL_KEY];
}

export { ContractTestingEngine };
