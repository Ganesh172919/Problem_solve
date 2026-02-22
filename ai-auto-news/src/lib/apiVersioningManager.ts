import { getLogger } from './logger';
import { getCache } from './cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VersionStatus = 'canary' | 'active' | 'deprecated' | 'sunset';

export type BreakingChangeCategory =
  | 'removed_endpoint'
  | 'removed_field'
  | 'changed_type'
  | 'changed_behavior'
  | 'auth_change'
  | 'rate_limit_change';

export interface APIVersion {
  version: string; // e.g. "v1", "v2", "2024-01-15"
  status: VersionStatus;
  releasedAt: string;
  deprecatedAt?: string;
  sunsetAt?: string;
  sunsetEnforcedAt?: string;
  description: string;
  baseUrl: string;
  changelogEntries: ChangelogEntry[];
  breakingChanges: BreakingChange[];
  migrationGuide?: MigrationGuide;
}

export interface ChangelogEntry {
  id: string;
  version: string;
  date: string;
  type: 'feature' | 'fix' | 'deprecation' | 'breaking' | 'security' | 'improvement';
  title: string;
  description: string;
  affectedEndpoints?: string[];
  relatedVersions?: string[];
}

export interface BreakingChange {
  id: string;
  category: BreakingChangeCategory;
  description: string;
  affectedEndpoint?: string;
  affectedField?: string;
  oldBehavior: string;
  newBehavior: string;
  mitigationSteps: string[];
  introducedInVersion: string;
}

export interface MigrationGuide {
  fromVersion: string;
  toVersion: string;
  estimatedEffortHours: number;
  steps: MigrationStep[];
  codeExamples: Array<{ title: string; before: string; after: string; language: string }>;
  testingChecklist: string[];
}

export interface MigrationStep {
  order: number;
  title: string;
  description: string;
  codeSnippet?: string;
  breakingChangesAddressed: string[];
}

export interface VersionCompatibilityReport {
  fromVersion: string;
  toVersion: string;
  compatible: boolean;
  breakingChanges: BreakingChange[];
  warnings: string[];
  recommendations: string[];
  migrationGuide?: MigrationGuide;
}

export interface ClientSDKVersion {
  clientId: string;
  sdkVersion: string;
  apiVersion: string;
  language: 'javascript' | 'python' | 'go' | 'java' | 'ruby' | 'php' | 'csharp' | 'other';
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
}

export interface VersionAdoptionMetrics {
  version: string;
  activeClients: number;
  requestShare: number; // 0-1
  uniqueEndpoints: number;
  adoptionTrend: 'growing' | 'stable' | 'declining';
  sdkVersions: Array<{ sdkVersion: string; count: number }>;
}

export interface CanaryConfig {
  canaryVersion: string;
  stableVersion: string;
  canaryTrafficPercent: number;
  stickyByClientId: boolean;
  enabledClientIds?: string[];
  startedAt: string;
  autoPromoteThreshold?: number;
  autoPromoteMetric?: string;
}

export interface SunsetEnforcement {
  version: string;
  sunsetAt: string;
  notificationsSentAt: string[];
  warningHeaderEnabled: boolean;
  blockRequestsAfterSunset: boolean;
  gracePeriodDays: number;
}

export interface VersionRoutingResult {
  resolvedVersion: string;
  isCanary: boolean;
  sunsetWarning?: string;
  deprecationWarning?: string;
  headers: Record<string, string>;
}

export interface VersionRegistrySnapshot {
  versions: APIVersion[];
  activeVersion: string;
  canaryConfig?: CanaryConfig;
  totalClients: number;
  adoptionByVersion: VersionAdoptionMetrics[];
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function semverCompare(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class APIVersioningManager {
  private readonly logger = getLogger();
  private readonly cache = getCache();
  private versions: Map<string, APIVersion> = new Map();
  private sdkClients: Map<string, ClientSDKVersion> = new Map();
  private canaryConfig: CanaryConfig | null = null;
  private sunsetEnforcements: Map<string, SunsetEnforcement> = new Map();

  // ── Version Registry ──────────────────────────────────────────────────────────

  registerVersion(version: Omit<APIVersion, 'changelogEntries' | 'breakingChanges'>): APIVersion {
    if (this.versions.has(version.version)) {
      throw new Error(`Version ${version.version} already registered`);
    }
    const apiVersion: APIVersion = {
      ...version,
      changelogEntries: [],
      breakingChanges: [],
    };
    this.versions.set(version.version, apiVersion);
    this.logger.info('APIVersioningManager: registered version', { version: version.version, status: version.status });
    return apiVersion;
  }

  getVersion(version: string): APIVersion | undefined {
    return this.versions.get(version);
  }

  listVersions(statusFilter?: VersionStatus[]): APIVersion[] {
    const all = [...this.versions.values()];
    if (!statusFilter) return all.sort((a, b) => semverCompare(b.version, a.version));
    return all.filter(v => statusFilter.includes(v.status)).sort((a, b) => semverCompare(b.version, a.version));
  }

  getActiveVersion(): APIVersion | undefined {
    return this.listVersions(['active'])[0];
  }

  // ── Deprecation Lifecycle ─────────────────────────────────────────────────────

  deprecateVersion(version: string, sunsetAt: string, gracePeriodDays = 90): void {
    const v = this.versions.get(version);
    if (!v) throw new Error(`Version ${version} not found`);
    if (v.status === 'sunset') throw new Error(`Version ${version} is already sunset`);

    v.status = 'deprecated';
    v.deprecatedAt = new Date().toISOString();
    v.sunsetAt = sunsetAt;
    v.sunsetEnforcedAt = new Date(new Date(sunsetAt).getTime() + gracePeriodDays * 86_400_000).toISOString();

    const enforcement: SunsetEnforcement = {
      version,
      sunsetAt,
      notificationsSentAt: [],
      warningHeaderEnabled: true,
      blockRequestsAfterSunset: false,
      gracePeriodDays,
    };
    this.sunsetEnforcements.set(version, enforcement);

    this.logger.info('APIVersioningManager: version deprecated', { version, sunsetAt, gracePeriodDays });
    this.cache.delete(`registry-snapshot`);
  }

  sunsetVersion(version: string): void {
    const v = this.versions.get(version);
    if (!v) throw new Error(`Version ${version} not found`);
    v.status = 'sunset';
    const enforcement = this.sunsetEnforcements.get(version);
    if (enforcement) enforcement.blockRequestsAfterSunset = true;
    this.logger.info('APIVersioningManager: version sunset', { version });
    this.cache.delete(`registry-snapshot`);
  }

  // ── Breaking Change Detection ─────────────────────────────────────────────────

  registerBreakingChange(versionId: string, change: Omit<BreakingChange, 'id' | 'introducedInVersion'>): BreakingChange {
    const v = this.versions.get(versionId);
    if (!v) throw new Error(`Version ${versionId} not found`);

    const bc: BreakingChange = { ...change, id: generateId(), introducedInVersion: versionId };
    v.breakingChanges.push(bc);
    this.logger.info('APIVersioningManager: registered breaking change', { versionId, category: change.category, endpoint: change.affectedEndpoint });
    return bc;
  }

  checkCompatibility(fromVersion: string, toVersion: string): VersionCompatibilityReport {
    const cacheKey = `compat:${fromVersion}:${toVersion}`;
    const cached = this.cache.get<VersionCompatibilityReport>(cacheKey);
    if (cached) return cached;

    const from = this.versions.get(fromVersion);
    const to = this.versions.get(toVersion);
    if (!from) throw new Error(`Version ${fromVersion} not found`);
    if (!to) throw new Error(`Version ${toVersion} not found`);

    // Collect all breaking changes introduced between from and to
    const allVersions = this.listVersions()
      .filter(v => semverCompare(v.version, fromVersion) > 0 && semverCompare(v.version, toVersion) <= 0);

    const breakingChanges = allVersions.flatMap(v => v.breakingChanges);
    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (to.status === 'deprecated') {
      warnings.push(`Target version ${toVersion} is deprecated. Consider migrating to ${this.getActiveVersion()?.version ?? 'latest'} instead.`);
    }
    if (to.status === 'sunset') {
      warnings.push(`Target version ${toVersion} has been sunset and is no longer supported.`);
    }
    if (breakingChanges.some(c => c.category === 'auth_change')) {
      recommendations.push('Authentication changes detected — review token scopes and re-authenticate all integrations.');
    }
    if (breakingChanges.some(c => c.category === 'rate_limit_change')) {
      recommendations.push('Rate limits have changed — update retry and backoff logic in client code.');
    }

    const report: VersionCompatibilityReport = {
      fromVersion,
      toVersion,
      compatible: breakingChanges.length === 0,
      breakingChanges,
      warnings,
      recommendations,
      migrationGuide: to.migrationGuide,
    };

    this.cache.set(cacheKey, report, 3600);
    return report;
  }

  // ── Migration Guide Generation ────────────────────────────────────────────────

  generateMigrationGuide(fromVersion: string, toVersion: string): MigrationGuide {
    const compat = this.checkCompatibility(fromVersion, toVersion);
    const stepMap: MigrationStep[] = [];
    let order = 1;

    if (compat.breakingChanges.some(c => c.category === 'auth_change')) {
      stepMap.push({
        order: order++,
        title: 'Update authentication credentials',
        description: 'Auth mechanisms have changed. Rotate keys and update all credential references.',
        breakingChangesAddressed: compat.breakingChanges.filter(c => c.category === 'auth_change').map(c => c.id),
      });
    }

    for (const bc of compat.breakingChanges.filter(c => c.category === 'removed_endpoint')) {
      stepMap.push({
        order: order++,
        title: `Replace removed endpoint: ${bc.affectedEndpoint ?? 'unknown'}`,
        description: bc.description,
        codeSnippet: `// Before (${fromVersion})\n// ${bc.oldBehavior}\n\n// After (${toVersion})\n// ${bc.newBehavior}`,
        breakingChangesAddressed: [bc.id],
      });
    }

    for (const bc of compat.breakingChanges.filter(c => c.category === 'removed_field' || c.category === 'changed_type')) {
      stepMap.push({
        order: order++,
        title: `Update field usage: ${bc.affectedField ?? bc.affectedEndpoint ?? 'unknown'}`,
        description: bc.description,
        breakingChangesAddressed: [bc.id],
      });
    }

    stepMap.push({
      order: order++,
      title: 'Update SDK version',
      description: `Upgrade client SDK to the version compatible with ${toVersion}.`,
      breakingChangesAddressed: [],
    });

    stepMap.push({
      order: order,
      title: 'Run integration tests',
      description: 'Execute full integration test suite against the new version endpoint.',
      breakingChangesAddressed: [],
    });

    const guide: MigrationGuide = {
      fromVersion,
      toVersion,
      estimatedEffortHours: Math.max(1, compat.breakingChanges.length * 4),
      steps: stepMap,
      codeExamples: compat.breakingChanges
        .filter(bc => bc.oldBehavior && bc.newBehavior)
        .slice(0, 5)
        .map(bc => ({
          title: bc.description,
          before: bc.oldBehavior,
          after: bc.newBehavior,
          language: 'typescript',
        })),
      testingChecklist: [
        'Verify authentication flow',
        'Test all modified endpoints',
        'Validate response schema changes',
        'Check error handling for new error codes',
        'Load test against new rate limits',
        'Verify webhook payloads if applicable',
      ],
    };

    const to = this.versions.get(toVersion);
    if (to) to.migrationGuide = guide;

    this.logger.info('APIVersioningManager: generated migration guide', { fromVersion, toVersion, steps: guide.steps.length });
    return guide;
  }

  // ── Changelog Management ──────────────────────────────────────────────────────

  addChangelogEntry(versionId: string, entry: Omit<ChangelogEntry, 'id' | 'version'>): ChangelogEntry {
    const v = this.versions.get(versionId);
    if (!v) throw new Error(`Version ${versionId} not found`);
    const full: ChangelogEntry = { ...entry, id: generateId(), version: versionId };
    v.changelogEntries.push(full);
    this.cache.delete('registry-snapshot');
    return full;
  }

  generateChangelog(fromVersion?: string, toVersion?: string): ChangelogEntry[] {
    let versions = this.listVersions();
    if (fromVersion) versions = versions.filter(v => semverCompare(v.version, fromVersion) > 0);
    if (toVersion) versions = versions.filter(v => semverCompare(v.version, toVersion) <= 0);
    return versions.flatMap(v => v.changelogEntries).sort((a, b) => b.date.localeCompare(a.date));
  }

  // ── SDK Client Tracking ───────────────────────────────────────────────────────

  trackClientRequest(clientId: string, sdkVersion: string, apiVersion: string, language: ClientSDKVersion['language']): void {
    const key = `${clientId}:${sdkVersion}:${apiVersion}`;
    const existing = this.sdkClients.get(key);
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      existing.requestCount++;
    } else {
      this.sdkClients.set(key, {
        clientId,
        sdkVersion,
        apiVersion,
        language,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        requestCount: 1,
      });
    }
  }

  getVersionAdoptionMetrics(): VersionAdoptionMetrics[] {
    const cacheKey = 'adoption-metrics';
    const cached = this.cache.get<VersionAdoptionMetrics[]>(cacheKey);
    if (cached) return cached;

    const clientsByVersion = new Map<string, Set<string>>();
    const requestsByVersion = new Map<string, number>();
    const sdkByVersion = new Map<string, Map<string, number>>();
    const endpointsByVersion = new Map<string, Set<string>>();

    for (const client of this.sdkClients.values()) {
      const v = client.apiVersion;
      if (!clientsByVersion.has(v)) clientsByVersion.set(v, new Set());
      clientsByVersion.get(v)!.add(client.clientId);
      requestsByVersion.set(v, (requestsByVersion.get(v) ?? 0) + client.requestCount);
      if (!sdkByVersion.has(v)) sdkByVersion.set(v, new Map());
      const sdkMap = sdkByVersion.get(v)!;
      sdkMap.set(client.sdkVersion, (sdkMap.get(client.sdkVersion) ?? 0) + 1);
    }

    const totalRequests = [...requestsByVersion.values()].reduce((s, v) => s + v, 0) || 1;

    const metrics: VersionAdoptionMetrics[] = [...this.versions.keys()].map(version => ({
      version,
      activeClients: clientsByVersion.get(version)?.size ?? 0,
      requestShare: Math.round(((requestsByVersion.get(version) ?? 0) / totalRequests) * 1000) / 1000,
      uniqueEndpoints: endpointsByVersion.get(version)?.size ?? 0,
      adoptionTrend: 'stable' as const,
      sdkVersions: [...(sdkByVersion.get(version)?.entries() ?? [])].map(([sdkVersion, count]) => ({ sdkVersion, count })),
    }));

    this.cache.set(cacheKey, metrics, 120);
    return metrics;
  }

  // ── Canary Routing ─────────────────────────────────────────────────────────────

  configureCanary(config: CanaryConfig): void {
    if (!this.versions.has(config.canaryVersion)) throw new Error(`Canary version ${config.canaryVersion} not registered`);
    if (!this.versions.has(config.stableVersion)) throw new Error(`Stable version ${config.stableVersion} not registered`);
    const canaryV = this.versions.get(config.canaryVersion)!;
    canaryV.status = 'canary';
    this.canaryConfig = config;
    this.logger.info('APIVersioningManager: canary configured', { canaryVersion: config.canaryVersion, stableVersion: config.stableVersion, traffic: config.canaryTrafficPercent });
  }

  resolveVersion(clientId: string, requestedVersion?: string): VersionRoutingResult {
    // Explicit version request
    if (requestedVersion && this.versions.has(requestedVersion)) {
      return this.buildRoutingResult(requestedVersion, clientId, false);
    }

    // Canary routing
    if (this.canaryConfig) {
      const cc = this.canaryConfig;
      const useCanary = cc.enabledClientIds?.includes(clientId) ||
        (!cc.stickyByClientId && Math.random() * 100 < cc.canaryTrafficPercent) ||
        (cc.stickyByClientId && this.hashClient(clientId) < cc.canaryTrafficPercent);
      if (useCanary) {
        return this.buildRoutingResult(cc.canaryVersion, clientId, true);
      }
      return this.buildRoutingResult(cc.stableVersion, clientId, false);
    }

    const active = this.getActiveVersion();
    if (!active) throw new Error('No active API version available');
    return this.buildRoutingResult(active.version, clientId, false);
  }

  private buildRoutingResult(version: string, _clientId: string, isCanary: boolean): VersionRoutingResult {
    const v = this.versions.get(version);
    if (!v) throw new Error(`Version ${version} not found`);

    const headers: Record<string, string> = { 'X-API-Version': version };
    let sunsetWarning: string | undefined;
    let deprecationWarning: string | undefined;

    if (v.status === 'deprecated' && v.sunsetAt) {
      const days = daysUntil(v.sunsetAt);
      deprecationWarning = `API version ${version} is deprecated and will be sunset in ${days} days. Migrate to ${this.getActiveVersion()?.version ?? 'latest'}.`;
      headers['Deprecation'] = v.deprecatedAt ?? 'true';
      headers['Sunset'] = v.sunsetAt;
      headers['Link'] = `<${this.getActiveVersion()?.baseUrl ?? '/api/latest'}>; rel="successor-version"`;
    }

    if (v.status === 'sunset') {
      const enforcement = this.sunsetEnforcements.get(version);
      if (enforcement?.blockRequestsAfterSunset) {
        sunsetWarning = `API version ${version} has been sunset and is no longer available.`;
      }
    }

    return { resolvedVersion: version, isCanary, sunsetWarning, deprecationWarning, headers };
  }

  private hashClient(clientId: string): number {
    let hash = 0;
    for (let i = 0; i < clientId.length; i++) hash = ((hash << 5) - hash + clientId.charCodeAt(i)) | 0;
    return Math.abs(hash) % 100;
  }

  // ── Sunset Enforcement ────────────────────────────────────────────────────────

  enforceSunsets(): string[] {
    const enforced: string[] = [];
    const now = new Date();
    for (const [version, enforcement] of this.sunsetEnforcements.entries()) {
      const v = this.versions.get(version);
      if (!v) continue;
      if (v.status !== 'sunset' && new Date(enforcement.sunsetAt) <= now) {
        this.sunsetVersion(version);
        enforced.push(version);
        this.logger.info('APIVersioningManager: auto-sunset enforced', { version });
      }
    }
    return enforced;
  }

  recordSunsetNotification(version: string): void {
    const enforcement = this.sunsetEnforcements.get(version);
    if (enforcement) {
      enforcement.notificationsSentAt.push(new Date().toISOString());
    }
  }

  // ── Registry Snapshot ─────────────────────────────────────────────────────────

  getRegistrySnapshot(): VersionRegistrySnapshot {
    const cacheKey = 'registry-snapshot';
    const cached = this.cache.get<VersionRegistrySnapshot>(cacheKey);
    if (cached) return cached;

    const activeVersion = this.getActiveVersion()?.version ?? 'unknown';
    const uniqueClients = new Set([...this.sdkClients.values()].map(c => c.clientId)).size;

    const snapshot: VersionRegistrySnapshot = {
      versions: this.listVersions(),
      activeVersion,
      canaryConfig: this.canaryConfig ?? undefined,
      totalClients: uniqueClients,
      adoptionByVersion: this.getVersionAdoptionMetrics(),
      generatedAt: new Date().toISOString(),
    };

    this.cache.set(cacheKey, snapshot, 60);
    return snapshot;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getAPIVersioningManager(): APIVersioningManager {
  if (!globalThis.__apiVersioningManager__) {
    globalThis.__apiVersioningManager__ = new APIVersioningManager();
  }
  return globalThis.__apiVersioningManager__ as APIVersioningManager;
}
