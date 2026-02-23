import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppEnvironment = 'sandbox' | 'production';

type AppStatus = 'pending_review' | 'active' | 'suspended' | 'archived';

type KeyStatus = 'active' | 'rotated' | 'revoked';

type OnboardingStep = 'register' | 'verify_email' | 'create_app' | 'generate_key' | 'first_api_call' | 'completed';

interface DeveloperApp {
  id: string;
  developerId: string;
  name: string;
  description: string;
  status: AppStatus;
  environment: AppEnvironment;
  createdAt: number;
  updatedAt: number;
  callbackUrls: string[];
  metadata: Record<string, unknown>;
}

interface ApiKey {
  id: string;
  appId: string;
  key: string;
  prefix: string;
  status: KeyStatus;
  environment: AppEnvironment;
  scopes: string[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  rotatedFromId: string | null;
}

interface UsageSummary {
  appId: string;
  period: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  topEndpoints: Array<{ endpoint: string; count: number }>;
  rateLimitHits: number;
}

interface ApiEndpointDoc {
  id: string;
  path: string;
  method: string;
  summary: string;
  description: string;
  version: string;
  deprecated: boolean;
  deprecationDate: number | null;
  parameters: Array<{ name: string; in: string; required: boolean; type: string; description: string }>;
  tags: string[];
}

interface RateLimitConfig {
  appId: string;
  environment: AppEnvironment;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
  currentUsage: { minute: number; hour: number; day: number };
  resetTimestamps: { minute: number; hour: number; day: number };
}

interface OnboardingState {
  developerId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  startedAt: number;
  lastActivityAt: number;
  metadata: Record<string, unknown>;
}

interface DeveloperPortalConfig {
  maxAppsPerDeveloper: number;
  maxKeysPerApp: number;
  keyExpirationMs: number | null;
  defaultRateLimitPerMinute: number;
  defaultRateLimitPerHour: number;
  defaultRateLimitPerDay: number;
  usageRetentionDays: number;
  cleanupIntervalMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DeveloperPortalConfig = {
  maxAppsPerDeveloper: 10,
  maxKeysPerApp: 5,
  keyExpirationMs: null,
  defaultRateLimitPerMinute: 60,
  defaultRateLimitPerHour: 1000,
  defaultRateLimitPerDay: 10000,
  usageRetentionDays: 90,
  cleanupIntervalMs: 300000,
};

const ONBOARDING_ORDER: OnboardingStep[] = [
  'register',
  'verify_email',
  'create_app',
  'generate_key',
  'first_api_call',
  'completed',
];

function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

function generateApiKey(): string {
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    parts.push(Math.random().toString(36).substring(2, 10));
  }
  return parts.join('');
}

// ─── DeveloperPortalAPI ───────────────────────────────────────────────────────

export class DeveloperPortalAPI {
  private apps: Map<string, DeveloperApp> = new Map();
  private apiKeys: Map<string, ApiKey> = new Map();
  private usageRecords: Map<string, UsageSummary[]> = new Map();
  private endpointDocs: Map<string, ApiEndpointDoc> = new Map();
  private rateLimits: Map<string, RateLimitConfig> = new Map();
  private onboardingStates: Map<string, OnboardingState> = new Map();
  private config: DeveloperPortalConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<DeveloperPortalConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    logger.info('DeveloperPortalAPI initialized', {
      maxAppsPerDeveloper: this.config.maxAppsPerDeveloper,
      maxKeysPerApp: this.config.maxKeysPerApp,
    });
  }

  // ── App Registration ──────────────────────────────────────────────────────

  /**
   * Register a new developer application.
   */
  registerApp(
    developerId: string,
    name: string,
    options?: { description?: string; environment?: AppEnvironment; callbackUrls?: string[]; metadata?: Record<string, unknown> },
  ): DeveloperApp {
    if (!developerId || !name) throw new Error('DeveloperPortalAPI: developerId and name are required');

    const devApps = Array.from(this.apps.values()).filter((a) => a.developerId === developerId && a.status !== 'archived');
    if (devApps.length >= this.config.maxAppsPerDeveloper) {
      throw new Error(`DeveloperPortalAPI: developer "${developerId}" has reached max apps (${this.config.maxAppsPerDeveloper})`);
    }

    const duplicate = devApps.find((a) => a.name === name);
    if (duplicate) {
      throw new Error(`DeveloperPortalAPI: app name "${name}" already exists for this developer`);
    }

    const id = generateId();
    const now = Date.now();
    const app: DeveloperApp = {
      id,
      developerId,
      name,
      description: options?.description ?? '',
      status: 'active',
      environment: options?.environment ?? 'sandbox',
      createdAt: now,
      updatedAt: now,
      callbackUrls: options?.callbackUrls ?? [],
      metadata: options?.metadata ?? {},
    };

    this.apps.set(id, app);
    this.initializeRateLimit(id, app.environment);

    logger.info('DeveloperPortalAPI: app registered', { appId: id, developerId, name });
    return { ...app };
  }

  /**
   * Get an app by ID.
   */
  getApp(appId: string): DeveloperApp | null {
    const app = this.apps.get(appId);
    return app ? { ...app } : null;
  }

  /**
   * List apps for a developer.
   */
  listApps(developerId: string): DeveloperApp[] {
    return Array.from(this.apps.values())
      .filter((a) => a.developerId === developerId)
      .map((a) => ({ ...a }));
  }

  /**
   * Update an app's details.
   */
  updateApp(
    appId: string,
    updates: { name?: string; description?: string; callbackUrls?: string[]; metadata?: Record<string, unknown> },
  ): DeveloperApp | null {
    const app = this.apps.get(appId);
    if (!app) return null;
    if (app.status === 'archived') throw new Error('DeveloperPortalAPI: cannot update archived app');

    if (updates.name !== undefined) app.name = updates.name;
    if (updates.description !== undefined) app.description = updates.description;
    if (updates.callbackUrls !== undefined) app.callbackUrls = [...updates.callbackUrls];
    if (updates.metadata !== undefined) app.metadata = { ...app.metadata, ...updates.metadata };
    app.updatedAt = Date.now();

    logger.info('DeveloperPortalAPI: app updated', { appId });
    return { ...app };
  }

  /**
   * Suspend an app.
   */
  suspendApp(appId: string, reason?: string): boolean {
    const app = this.apps.get(appId);
    if (!app || app.status === 'archived') return false;

    app.status = 'suspended';
    app.updatedAt = Date.now();
    app.metadata.__suspensionReason = reason ?? 'No reason provided';

    // Revoke all active keys
    for (const key of this.apiKeys.values()) {
      if (key.appId === appId && key.status === 'active') {
        key.status = 'revoked';
      }
    }

    logger.warn('DeveloperPortalAPI: app suspended', { appId, reason });
    return true;
  }

  /**
   * Promote an app from sandbox to production.
   */
  promoteToProduction(appId: string): DeveloperApp | null {
    const app = this.apps.get(appId);
    if (!app) return null;
    if (app.status !== 'active') throw new Error('DeveloperPortalAPI: only active apps can be promoted');
    if (app.environment === 'production') throw new Error('DeveloperPortalAPI: app is already in production');

    app.environment = 'production';
    app.updatedAt = Date.now();
    this.initializeRateLimit(appId, 'production');

    logger.info('DeveloperPortalAPI: app promoted to production', { appId });
    return { ...app };
  }

  // ── API Key Lifecycle ─────────────────────────────────────────────────────

  /**
   * Create a new API key for an app.
   */
  createApiKey(
    appId: string,
    scopes: string[],
    options?: { expiresInMs?: number },
  ): ApiKey {
    const app = this.apps.get(appId);
    if (!app) throw new Error(`DeveloperPortalAPI: app "${appId}" not found`);
    if (app.status !== 'active') throw new Error('DeveloperPortalAPI: app must be active to create keys');

    const activeKeys = Array.from(this.apiKeys.values())
      .filter((k) => k.appId === appId && k.status === 'active');
    if (activeKeys.length >= this.config.maxKeysPerApp) {
      throw new Error(`DeveloperPortalAPI: app "${appId}" has reached max keys (${this.config.maxKeysPerApp})`);
    }

    const rawKey = generateApiKey();
    const prefix = rawKey.substring(0, 8);
    const now = Date.now();
    const id = generateId();

    const key: ApiKey = {
      id,
      appId,
      key: rawKey,
      prefix,
      status: 'active',
      environment: app.environment,
      scopes: [...scopes],
      createdAt: now,
      expiresAt: options?.expiresInMs ? now + options.expiresInMs : this.config.keyExpirationMs ? now + this.config.keyExpirationMs : null,
      lastUsedAt: null,
      rotatedFromId: null,
    };

    this.apiKeys.set(id, key);
    logger.info('DeveloperPortalAPI: API key created', { keyId: id, appId, prefix });
    return { ...key };
  }

  /**
   * Rotate an API key: revoke the old one and create a new one with the same scopes.
   */
  rotateApiKey(keyId: string): ApiKey | null {
    const oldKey = this.apiKeys.get(keyId);
    if (!oldKey || oldKey.status !== 'active') return null;

    oldKey.status = 'rotated';

    const newKey = this.createApiKey(oldKey.appId, oldKey.scopes);
    const newKeyRecord = this.apiKeys.get(newKey.id);
    if (newKeyRecord) {
      newKeyRecord.rotatedFromId = keyId;
    }

    logger.info('DeveloperPortalAPI: API key rotated', { oldKeyId: keyId, newKeyId: newKey.id });
    return newKey;
  }

  /**
   * Revoke an API key.
   */
  revokeApiKey(keyId: string): boolean {
    const key = this.apiKeys.get(keyId);
    if (!key || key.status === 'revoked') return false;

    key.status = 'revoked';
    logger.info('DeveloperPortalAPI: API key revoked', { keyId });
    return true;
  }

  /**
   * List API keys for an app (returns masked keys).
   */
  listApiKeys(appId: string): Array<Omit<ApiKey, 'key'> & { maskedKey: string }> {
    return Array.from(this.apiKeys.values())
      .filter((k) => k.appId === appId)
      .map((k) => {
        const { key, ...rest } = k;
        return { ...rest, maskedKey: key.substring(0, 8) + '****' + key.substring(key.length - 4) };
      });
  }

  // ── Usage Dashboard ───────────────────────────────────────────────────────

  /**
   * Record an API usage event for an app.
   */
  recordUsage(appId: string, endpoint: string, success: boolean, latencyMs: number): void {
    const app = this.apps.get(appId);
    if (!app) return;

    const period = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    const records = this.usageRecords.get(appId) ?? [];

    let current = records.find((r) => r.period === period);
    if (!current) {
      current = {
        appId,
        period,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        topEndpoints: [],
        rateLimitHits: 0,
      };
      records.push(current);
      this.usageRecords.set(appId, records);
    }

    current.totalRequests++;
    if (success) current.successfulRequests++;
    else current.failedRequests++;

    // Update rolling average latency
    current.averageLatencyMs = Math.round(
      (current.averageLatencyMs * (current.totalRequests - 1) + latencyMs) / current.totalRequests,
    );

    // Track top endpoints
    const epEntry = current.topEndpoints.find((e) => e.endpoint === endpoint);
    if (epEntry) {
      epEntry.count++;
    } else {
      current.topEndpoints.push({ endpoint, count: 1 });
    }

    // Keep top 20 endpoints sorted by count
    current.topEndpoints.sort((a, b) => b.count - a.count);
    if (current.topEndpoints.length > 20) current.topEndpoints.length = 20;

    this.updateRateLimitUsage(appId);
  }

  /**
   * Get usage summary for an app within a date range.
   */
  getUsageSummary(appId: string, fromDate?: string, toDate?: string): UsageSummary[] {
    const records = this.usageRecords.get(appId) ?? [];
    return records
      .filter((r) => {
        if (fromDate && r.period < fromDate) return false;
        if (toDate && r.period > toDate) return false;
        return true;
      })
      .map((r) => ({ ...r, topEndpoints: [...r.topEndpoints] }));
  }

  // ── API Documentation Registry ───────────────────────────────────────────

  /**
   * Register an API endpoint in the documentation registry.
   */
  registerEndpoint(doc: Omit<ApiEndpointDoc, 'id'>): ApiEndpointDoc {
    const id = generateId();
    const entry: ApiEndpointDoc = { ...doc, id, parameters: [...doc.parameters], tags: [...doc.tags] };
    this.endpointDocs.set(id, entry);
    logger.info('DeveloperPortalAPI: endpoint documented', { path: doc.path, method: doc.method });
    return { ...entry };
  }

  /**
   * List documented endpoints, optionally filtered by version or tag.
   */
  listEndpoints(filters?: { version?: string; tag?: string; deprecated?: boolean }): ApiEndpointDoc[] {
    let docs = Array.from(this.endpointDocs.values());

    if (filters?.version) docs = docs.filter((d) => d.version === filters.version);
    if (filters?.tag) docs = docs.filter((d) => d.tags.includes(filters.tag!));
    if (filters?.deprecated !== undefined) docs = docs.filter((d) => d.deprecated === filters.deprecated);

    return docs.map((d) => ({ ...d, parameters: [...d.parameters], tags: [...d.tags] }));
  }

  // ── Rate Limit Visibility ─────────────────────────────────────────────────

  /**
   * Get current rate limit status for an app.
   */
  getRateLimitStatus(appId: string): RateLimitConfig | null {
    const rl = this.rateLimits.get(appId);
    return rl ? { ...rl, currentUsage: { ...rl.currentUsage }, resetTimestamps: { ...rl.resetTimestamps } } : null;
  }

  // ── Onboarding Flow ───────────────────────────────────────────────────────

  /**
   * Start the onboarding flow for a developer.
   */
  startOnboarding(developerId: string): OnboardingState {
    if (this.onboardingStates.has(developerId)) {
      return { ...this.onboardingStates.get(developerId)! };
    }

    const now = Date.now();
    const state: OnboardingState = {
      developerId,
      currentStep: 'register',
      completedSteps: [],
      startedAt: now,
      lastActivityAt: now,
      metadata: {},
    };

    this.onboardingStates.set(developerId, state);
    logger.info('DeveloperPortalAPI: onboarding started', { developerId });
    return { ...state };
  }

  /**
   * Advance the onboarding to the next step.
   */
  completeOnboardingStep(developerId: string, step: OnboardingStep): OnboardingState | null {
    const state = this.onboardingStates.get(developerId);
    if (!state) return null;

    if (state.currentStep !== step) {
      throw new Error(`DeveloperPortalAPI: expected step "${state.currentStep}", got "${step}"`);
    }

    state.completedSteps.push(step);
    state.lastActivityAt = Date.now();

    const currentIdx = ONBOARDING_ORDER.indexOf(step);
    if (currentIdx < ONBOARDING_ORDER.length - 1) {
      state.currentStep = ONBOARDING_ORDER[currentIdx + 1];
    }

    logger.info('DeveloperPortalAPI: onboarding step completed', { developerId, step, nextStep: state.currentStep });
    return { ...state, completedSteps: [...state.completedSteps] };
  }

  /**
   * Get onboarding state for a developer.
   */
  getOnboardingState(developerId: string): OnboardingState | null {
    const state = this.onboardingStates.get(developerId);
    return state ? { ...state, completedSteps: [...state.completedSteps] } : null;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.apps.clear();
    this.apiKeys.clear();
    this.usageRecords.clear();
    this.endpointDocs.clear();
    this.rateLimits.clear();
    this.onboardingStates.clear();
    logger.info('DeveloperPortalAPI destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private initializeRateLimit(appId: string, environment: AppEnvironment): void {
    const multiplier = environment === 'production' ? 5 : 1;
    const now = Date.now();

    const rl: RateLimitConfig = {
      appId,
      environment,
      requestsPerMinute: this.config.defaultRateLimitPerMinute * multiplier,
      requestsPerHour: this.config.defaultRateLimitPerHour * multiplier,
      requestsPerDay: this.config.defaultRateLimitPerDay * multiplier,
      burstLimit: this.config.defaultRateLimitPerMinute * multiplier * 2,
      currentUsage: { minute: 0, hour: 0, day: 0 },
      resetTimestamps: {
        minute: now + 60000,
        hour: now + 3600000,
        day: now + 86400000,
      },
    };

    this.rateLimits.set(appId, rl);
  }

  private updateRateLimitUsage(appId: string): void {
    const rl = this.rateLimits.get(appId);
    if (!rl) return;

    const now = Date.now();

    if (now >= rl.resetTimestamps.minute) {
      rl.currentUsage.minute = 0;
      rl.resetTimestamps.minute = now + 60000;
    }
    if (now >= rl.resetTimestamps.hour) {
      rl.currentUsage.hour = 0;
      rl.resetTimestamps.hour = now + 3600000;
    }
    if (now >= rl.resetTimestamps.day) {
      rl.currentUsage.day = 0;
      rl.resetTimestamps.day = now + 86400000;
    }

    rl.currentUsage.minute++;
    rl.currentUsage.hour++;
    rl.currentUsage.day++;
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.usageRetentionDays * 86400000;
    let removed = 0;

    for (const [appId, records] of this.usageRecords) {
      const cutoffDate = new Date(cutoff).toISOString().substring(0, 10);
      const filtered = records.filter((r) => r.period >= cutoffDate);
      if (filtered.length < records.length) {
        removed += records.length - filtered.length;
        this.usageRecords.set(appId, filtered);
      }
    }

    // Clean expired API keys
    for (const [id, key] of this.apiKeys) {
      if (key.expiresAt && key.expiresAt <= now && key.status === 'active') {
        key.status = 'revoked';
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('DeveloperPortalAPI: cleanup completed', { removed });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getDeveloperPortalAPI(): DeveloperPortalAPI {
  const g = globalThis as unknown as Record<string, DeveloperPortalAPI>;
  if (!g.__developerPortalAPI__) {
    g.__developerPortalAPI__ = new DeveloperPortalAPI();
  }
  return g.__developerPortalAPI__;
}
