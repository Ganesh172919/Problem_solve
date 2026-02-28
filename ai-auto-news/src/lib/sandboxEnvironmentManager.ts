import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type SandboxStatus = 'creating' | 'active' | 'paused' | 'expired' | 'destroyed';

interface ResourceLimits {
  maxCpuTimeMs: number;
  maxMemoryMb: number;
  maxApiCalls: number;
  maxStorageMb: number;
  maxConcurrentRequests: number;
}

interface ResourceUsage {
  cpuTimeMs: number;
  memoryMb: number;
  apiCalls: number;
  storageMb: number;
  concurrentRequests: number;
}

interface SandboxSnapshot {
  id: string;
  sandboxId: string;
  name: string;
  createdAt: number;
  dataSnapshot: Record<string, unknown>;
  resourceUsageAtSnapshot: ResourceUsage;
}

interface MockDataTemplate {
  name: string;
  schema: Record<string, string>;
  count: number;
}

interface SandboxEnvironment {
  id: string;
  developerId: string;
  name: string;
  status: SandboxStatus;
  resourceLimits: ResourceLimits;
  resourceUsage: ResourceUsage;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  snapshots: SandboxSnapshot[];
  templateId: string | null;
  metadata: Record<string, unknown>;
}

interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  resourceLimits: ResourceLimits;
  ttlMs: number;
  preloadedData: Record<string, unknown>;
  mockDataTemplates: MockDataTemplate[];
  createdAt: number;
}

interface SandboxMetrics {
  totalSandboxes: number;
  activeSandboxes: number;
  expiredSandboxes: number;
  totalApiCalls: number;
  totalSnapshots: number;
  averageLifetimeMs: number;
}

interface SandboxManagerConfig {
  defaultTtlMs: number;
  maxSandboxesPerDeveloper: number;
  maxSnapshotsPerSandbox: number;
  cleanupIntervalMs: number;
  defaultResourceLimits: ResourceLimits;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxCpuTimeMs: 60000,
  maxMemoryMb: 256,
  maxApiCalls: 10000,
  maxStorageMb: 100,
  maxConcurrentRequests: 10,
};

const DEFAULT_CONFIG: SandboxManagerConfig = {
  defaultTtlMs: 86400000, // 24 hours
  maxSandboxesPerDeveloper: 5,
  maxSnapshotsPerSandbox: 10,
  cleanupIntervalMs: 60000,
  defaultResourceLimits: { ...DEFAULT_RESOURCE_LIMITS },
};

function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

// ─── Mock Data Generator ──────────────────────────────────────────────────────

function generateMockValue(type: string, index: number): unknown {
  switch (type) {
    case 'string':
      return `mock_string_${index}`;
    case 'number':
      return Math.floor(Math.random() * 10000);
    case 'boolean':
      return index % 2 === 0;
    case 'email':
      return `user${index}@example.com`;
    case 'uuid':
      return `${generateId()}-${generateId()}`;
    case 'date':
      return new Date(Date.now() - Math.random() * 86400000 * 365).toISOString();
    case 'url':
      return `https://example.com/resource/${index}`;
    case 'integer':
      return index * 10 + Math.floor(Math.random() * 10);
    case 'float':
      return Math.round(Math.random() * 1000) / 100;
    case 'phone':
      return `+1555${String(index).padStart(7, '0')}`;
    case 'address':
      return `${100 + index} Mock Street, City ${index % 50}, ST ${10000 + index}`;
    default:
      return `mock_${type}_${index}`;
  }
}

function generateMockDataset(template: MockDataTemplate): unknown[] {
  const records: unknown[] = [];
  for (let i = 0; i < template.count; i++) {
    const record: Record<string, unknown> = {};
    for (const [field, type] of Object.entries(template.schema)) {
      record[field] = generateMockValue(type, i);
    }
    records.push(record);
  }
  return records;
}

// ─── SandboxEnvironmentManager ────────────────────────────────────────────────

export class SandboxEnvironmentManager {
  private sandboxes: Map<string, SandboxEnvironment> = new Map();
  private templates: Map<string, SandboxTemplate> = new Map();
  private config: SandboxManagerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lifetimeSum = 0;
  private destroyedCount = 0;

  constructor(config?: Partial<SandboxManagerConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      defaultResourceLimits: { ...DEFAULT_RESOURCE_LIMITS, ...config?.defaultResourceLimits },
    };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    logger.info('SandboxEnvironmentManager initialized', {
      defaultTtlMs: this.config.defaultTtlMs,
      maxPerDeveloper: this.config.maxSandboxesPerDeveloper,
    });
  }

  // ── Sandbox Lifecycle ─────────────────────────────────────────────────────

  /**
   * Create a new isolated sandbox environment.
   */
  createSandbox(
    developerId: string,
    name: string,
    options?: {
      templateId?: string;
      resourceLimits?: Partial<ResourceLimits>;
      ttlMs?: number;
      metadata?: Record<string, unknown>;
    },
  ): SandboxEnvironment {
    if (!developerId || !name) throw new Error('SandboxEnvironmentManager: developerId and name are required');

    const activeSandboxes = Array.from(this.sandboxes.values())
      .filter((s) => s.developerId === developerId && (s.status === 'active' || s.status === 'creating'));

    if (activeSandboxes.length >= this.config.maxSandboxesPerDeveloper) {
      throw new Error(
        `SandboxEnvironmentManager: developer "${developerId}" has reached max sandboxes (${this.config.maxSandboxesPerDeveloper})`,
      );
    }

    const template = options?.templateId ? this.templates.get(options.templateId) : null;
    const now = Date.now();
    const ttl = options?.ttlMs ?? template?.ttlMs ?? this.config.defaultTtlMs;
    const limits: ResourceLimits = {
      ...this.config.defaultResourceLimits,
      ...template?.resourceLimits,
      ...options?.resourceLimits,
    };

    const id = generateId();
    const sandbox: SandboxEnvironment = {
      id,
      developerId,
      name,
      status: 'creating',
      resourceLimits: limits,
      resourceUsage: {
        cpuTimeMs: 0,
        memoryMb: 0,
        apiCalls: 0,
        storageMb: 0,
        concurrentRequests: 0,
      },
      data: template ? { ...template.preloadedData } : {},
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttl,
      lastAccessedAt: now,
      snapshots: [],
      templateId: options?.templateId ?? null,
      metadata: options?.metadata ?? {},
    };

    // Generate mock data if template has data templates
    if (template?.mockDataTemplates.length) {
      for (const mockTemplate of template.mockDataTemplates) {
        sandbox.data[mockTemplate.name] = generateMockDataset(mockTemplate);
      }
    }

    sandbox.status = 'active';
    this.sandboxes.set(id, sandbox);

    logger.info('SandboxEnvironmentManager: sandbox created', {
      sandboxId: id,
      developerId,
      name,
      expiresIn: ttl,
    });
    return this.cloneSandbox(sandbox);
  }

  /**
   * Get a sandbox by ID.
   */
  getSandbox(sandboxId: string): SandboxEnvironment | null {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return null;

    this.checkExpiration(sandbox);
    sandbox.lastAccessedAt = Date.now();
    return this.cloneSandbox(sandbox);
  }

  /**
   * List sandboxes for a developer.
   */
  listSandboxes(developerId: string, statusFilter?: SandboxStatus): SandboxEnvironment[] {
    return Array.from(this.sandboxes.values())
      .filter((s) => {
        if (s.developerId !== developerId) return false;
        this.checkExpiration(s);
        if (statusFilter && s.status !== statusFilter) return false;
        return true;
      })
      .map((s) => this.cloneSandbox(s));
  }

  /**
   * Pause a sandbox to conserve resources.
   */
  pauseSandbox(sandboxId: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status !== 'active') return false;

    sandbox.status = 'paused';
    sandbox.updatedAt = Date.now();
    logger.info('SandboxEnvironmentManager: sandbox paused', { sandboxId });
    return true;
  }

  /**
   * Resume a paused sandbox.
   */
  resumeSandbox(sandboxId: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status !== 'paused') return false;

    this.checkExpiration(sandbox);
    if ((sandbox.status as string) === 'expired') return false;

    sandbox.status = 'active';
    sandbox.updatedAt = Date.now();
    logger.info('SandboxEnvironmentManager: sandbox resumed', { sandboxId });
    return true;
  }

  /**
   * Extend the expiration of a sandbox.
   */
  extendSandbox(sandboxId: string, additionalMs: number): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status === 'destroyed') return false;

    sandbox.expiresAt += additionalMs;
    sandbox.updatedAt = Date.now();

    if (sandbox.status === 'expired') {
      sandbox.status = 'active';
    }

    logger.info('SandboxEnvironmentManager: sandbox extended', {
      sandboxId,
      newExpiresAt: sandbox.expiresAt,
    });
    return true;
  }

  /**
   * Destroy a sandbox and release all resources.
   */
  destroySandbox(sandboxId: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status === 'destroyed') return false;

    this.lifetimeSum += Date.now() - sandbox.createdAt;
    this.destroyedCount++;

    sandbox.status = 'destroyed';
    sandbox.data = {};
    sandbox.snapshots = [];
    sandbox.updatedAt = Date.now();
    sandbox.resourceUsage.concurrentRequests = 0;

    logger.info('SandboxEnvironmentManager: sandbox destroyed', { sandboxId });
    return true;
  }

  // ── Resource Management ───────────────────────────────────────────────────

  /**
   * Record resource usage for a sandbox. Returns false if limit is exceeded.
   */
  recordUsage(
    sandboxId: string,
    usage: Partial<Pick<ResourceUsage, 'cpuTimeMs' | 'memoryMb' | 'apiCalls' | 'storageMb'>>,
  ): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status !== 'active') return false;

    const u = sandbox.resourceUsage;
    const l = sandbox.resourceLimits;

    if (usage.cpuTimeMs) u.cpuTimeMs += usage.cpuTimeMs;
    if (usage.memoryMb) u.memoryMb = Math.max(u.memoryMb, usage.memoryMb);
    if (usage.apiCalls) u.apiCalls += usage.apiCalls;
    if (usage.storageMb) u.storageMb = Math.max(u.storageMb, usage.storageMb);

    // Check limits
    if (u.cpuTimeMs > l.maxCpuTimeMs || u.apiCalls > l.maxApiCalls ||
        u.memoryMb > l.maxMemoryMb || u.storageMb > l.maxStorageMb) {
      logger.warn('SandboxEnvironmentManager: resource limit exceeded', {
        sandboxId,
        usage: u,
        limits: l,
      });
      sandbox.status = 'paused';
      sandbox.metadata.__pauseReason = 'resource_limit_exceeded';
      return false;
    }

    sandbox.lastAccessedAt = Date.now();
    return true;
  }

  /**
   * Get resource usage for a sandbox.
   */
  getResourceUsage(sandboxId: string): { usage: ResourceUsage; limits: ResourceLimits; percentages: Record<string, number> } | null {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return null;

    const u = sandbox.resourceUsage;
    const l = sandbox.resourceLimits;

    return {
      usage: { ...u },
      limits: { ...l },
      percentages: {
        cpuTime: Math.round((u.cpuTimeMs / l.maxCpuTimeMs) * 100),
        memory: Math.round((u.memoryMb / l.maxMemoryMb) * 100),
        apiCalls: Math.round((u.apiCalls / l.maxApiCalls) * 100),
        storage: Math.round((u.storageMb / l.maxStorageMb) * 100),
      },
    };
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────

  /**
   * Create a snapshot of the current sandbox state.
   */
  createSnapshot(sandboxId: string, name: string): SandboxSnapshot | null {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status === 'destroyed') return null;

    if (sandbox.snapshots.length >= this.config.maxSnapshotsPerSandbox) {
      // Remove the oldest snapshot to make room
      sandbox.snapshots.shift();
    }

    const snapshot: SandboxSnapshot = {
      id: generateId(),
      sandboxId,
      name,
      createdAt: Date.now(),
      dataSnapshot: JSON.parse(JSON.stringify(sandbox.data)),
      resourceUsageAtSnapshot: { ...sandbox.resourceUsage },
    };

    sandbox.snapshots.push(snapshot);
    sandbox.updatedAt = Date.now();

    logger.info('SandboxEnvironmentManager: snapshot created', { sandboxId, snapshotId: snapshot.id, name });
    return { ...snapshot };
  }

  /**
   * Restore a sandbox from a snapshot.
   */
  restoreSnapshot(sandboxId: string, snapshotId: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status === 'destroyed') return false;

    const snapshot = sandbox.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return false;

    sandbox.data = JSON.parse(JSON.stringify(snapshot.dataSnapshot));
    sandbox.resourceUsage = { ...snapshot.resourceUsageAtSnapshot };
    sandbox.updatedAt = Date.now();

    if (sandbox.status === 'expired') {
      sandbox.status = 'active';
      sandbox.expiresAt = Date.now() + this.config.defaultTtlMs;
    }

    logger.info('SandboxEnvironmentManager: snapshot restored', { sandboxId, snapshotId });
    return true;
  }

  /**
   * List snapshots for a sandbox.
   */
  listSnapshots(sandboxId: string): SandboxSnapshot[] {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return [];
    return sandbox.snapshots.map((s) => ({ ...s }));
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  /**
   * Reset a sandbox to its initial state.
   */
  resetSandbox(sandboxId: string): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status === 'destroyed') return false;

    const template = sandbox.templateId ? this.templates.get(sandbox.templateId) : null;

    sandbox.data = template ? { ...template.preloadedData } : {};
    sandbox.resourceUsage = { cpuTimeMs: 0, memoryMb: 0, apiCalls: 0, storageMb: 0, concurrentRequests: 0 };
    sandbox.status = 'active';
    sandbox.updatedAt = Date.now();
    sandbox.expiresAt = Date.now() + this.config.defaultTtlMs;

    // Re-generate mock data if template has data templates
    if (template?.mockDataTemplates.length) {
      for (const mockTemplate of template.mockDataTemplates) {
        sandbox.data[mockTemplate.name] = generateMockDataset(mockTemplate);
      }
    }

    logger.info('SandboxEnvironmentManager: sandbox reset', { sandboxId });
    return true;
  }

  // ── Mock Data Generation ──────────────────────────────────────────────────

  /**
   * Generate mock data and inject it into a sandbox.
   */
  generateMockData(sandboxId: string, template: MockDataTemplate): unknown[] {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox || sandbox.status === 'destroyed') throw new Error('SandboxEnvironmentManager: sandbox not found or destroyed');

    const dataset = generateMockDataset(template);
    sandbox.data[template.name] = dataset;
    sandbox.updatedAt = Date.now();

    logger.info('SandboxEnvironmentManager: mock data generated', {
      sandboxId,
      name: template.name,
      count: dataset.length,
    });
    return dataset;
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  /**
   * Create a reusable sandbox configuration template.
   */
  createTemplate(
    name: string,
    options?: {
      description?: string;
      resourceLimits?: Partial<ResourceLimits>;
      ttlMs?: number;
      preloadedData?: Record<string, unknown>;
      mockDataTemplates?: MockDataTemplate[];
    },
  ): SandboxTemplate {
    const id = generateId();
    const template: SandboxTemplate = {
      id,
      name,
      description: options?.description ?? '',
      resourceLimits: { ...this.config.defaultResourceLimits, ...options?.resourceLimits },
      ttlMs: options?.ttlMs ?? this.config.defaultTtlMs,
      preloadedData: options?.preloadedData ?? {},
      mockDataTemplates: options?.mockDataTemplates ?? [],
      createdAt: Date.now(),
    };

    this.templates.set(id, template);
    logger.info('SandboxEnvironmentManager: template created', { templateId: id, name });
    return { ...template };
  }

  /**
   * Get a template by ID.
   */
  getTemplate(templateId: string): SandboxTemplate | null {
    const template = this.templates.get(templateId);
    return template ? { ...template } : null;
  }

  /**
   * List all templates.
   */
  listTemplates(): SandboxTemplate[] {
    return Array.from(this.templates.values()).map((t) => ({ ...t }));
  }

  /**
   * Delete a template.
   */
  deleteTemplate(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): SandboxMetrics {
    let active = 0;
    let expired = 0;
    let totalApiCalls = 0;
    let totalSnapshots = 0;

    for (const sandbox of this.sandboxes.values()) {
      this.checkExpiration(sandbox);
      if (sandbox.status === 'active' || sandbox.status === 'paused') active++;
      if (sandbox.status === 'expired') expired++;
      totalApiCalls += sandbox.resourceUsage.apiCalls;
      totalSnapshots += sandbox.snapshots.length;
    }

    return {
      totalSandboxes: this.sandboxes.size,
      activeSandboxes: active,
      expiredSandboxes: expired,
      totalApiCalls,
      totalSnapshots,
      averageLifetimeMs: this.destroyedCount > 0 ? Math.round(this.lifetimeSum / this.destroyedCount) : 0,
    };
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sandboxes.clear();
    this.templates.clear();
    logger.info('SandboxEnvironmentManager destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private checkExpiration(sandbox: SandboxEnvironment): void {
    if ((sandbox.status === 'active' || sandbox.status === 'paused') && sandbox.expiresAt <= Date.now()) {
      sandbox.status = 'expired';
      sandbox.updatedAt = Date.now();
      logger.info('SandboxEnvironmentManager: sandbox expired', { sandboxId: sandbox.id });
    }
  }

  private cloneSandbox(sandbox: SandboxEnvironment): SandboxEnvironment {
    return {
      ...sandbox,
      resourceLimits: { ...sandbox.resourceLimits },
      resourceUsage: { ...sandbox.resourceUsage },
      data: { ...sandbox.data },
      snapshots: sandbox.snapshots.map((s) => ({ ...s })),
      metadata: { ...sandbox.metadata },
    };
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, sandbox] of this.sandboxes) {
      this.checkExpiration(sandbox);

      // Remove destroyed sandboxes older than 1 hour
      if (sandbox.status === 'destroyed' && sandbox.updatedAt < now - 3600000) {
        this.sandboxes.delete(id);
        cleaned++;
      }

      // Remove expired sandboxes older than TTL
      if (sandbox.status === 'expired' && sandbox.expiresAt < now - this.config.defaultTtlMs) {
        this.lifetimeSum += now - sandbox.createdAt;
        this.destroyedCount++;
        this.sandboxes.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('SandboxEnvironmentManager: cleanup completed', { cleaned });
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getSandboxEnvironmentManager(): SandboxEnvironmentManager {
  const g = globalThis as unknown as Record<string, SandboxEnvironmentManager>;
  if (!g.__sandboxEnvironmentManager__) {
    g.__sandboxEnvironmentManager__ = new SandboxEnvironmentManager();
  }
  return g.__sandboxEnvironmentManager__;
}
