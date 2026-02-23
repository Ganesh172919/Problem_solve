import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChangeType = 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';

type BreakingLevel = 'none' | 'minor' | 'major';

type DeprecationStatus = 'announced' | 'active' | 'sunset' | 'removed';

type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';

interface ChangelogEntry {
  id: string;
  version: string;
  title: string;
  description: string;
  changeType: ChangeType;
  breakingLevel: BreakingLevel;
  affectedEndpoints: string[];
  migrationGuide: string | null;
  tags: string[];
  author: string;
  createdAt: number;
  publishedAt: number | null;
  published: boolean;
}

interface DeprecationRecord {
  id: string;
  endpoint: string;
  version: string;
  status: DeprecationStatus;
  announcedAt: number;
  sunsetDate: number;
  removedAt: number | null;
  replacement: string | null;
  migrationGuide: string | null;
  affectedConsumers: string[];
}

interface ChangeImpact {
  entryId: string;
  impactLevel: ImpactLevel;
  affectedApps: number;
  affectedEndpoints: string[];
  estimatedMigrationEffort: string;
  riskFactors: string[];
}

interface ChangelogSubscriber {
  id: string;
  email: string;
  versions: string[];
  changeTypes: ChangeType[];
  endpoints: string[];
  subscribedAt: number;
  active: boolean;
}

interface SubscriberNotification {
  subscriberId: string;
  entryId: string;
  email: string;
  sentAt: number;
  reason: string;
}

interface ChangelogSearchOptions {
  version?: string;
  changeType?: ChangeType;
  breaking?: boolean;
  fromDate?: number;
  toDate?: number;
  tag?: string;
  query?: string;
  endpoint?: string;
  limit?: number;
  offset?: number;
}

interface ChangelogMetrics {
  totalEntries: number;
  entriesByType: Record<ChangeType, number>;
  breakingChanges: number;
  activeDeprecations: number;
  subscriberCount: number;
  notificationsSent: number;
}

interface APIChangelogConfig {
  maxEntriesPerVersion: number;
  deprecationGracePeriodMs: number;
  notificationBatchSize: number;
  cleanupIntervalMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: APIChangelogConfig = {
  maxEntriesPerVersion: 100,
  deprecationGracePeriodMs: 7776000000, // 90 days
  notificationBatchSize: 50,
  cleanupIntervalMs: 300000,
};

function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ─── APIChangelogService ──────────────────────────────────────────────────────

export class APIChangelogService {
  private entries: Map<string, ChangelogEntry> = new Map();
  private deprecations: Map<string, DeprecationRecord> = new Map();
  private subscribers: Map<string, ChangelogSubscriber> = new Map();
  private notifications: SubscriberNotification[] = [];
  private config: APIChangelogConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<APIChangelogConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }

    logger.info('APIChangelogService initialized', {
      deprecationGracePeriodMs: this.config.deprecationGracePeriodMs,
    });
  }

  // ── Changelog Entries ─────────────────────────────────────────────────────

  /**
   * Add a new changelog entry for a version.
   */
  addEntry(
    version: string,
    title: string,
    options: {
      description?: string;
      changeType?: ChangeType;
      breakingLevel?: BreakingLevel;
      affectedEndpoints?: string[];
      migrationGuide?: string;
      tags?: string[];
      author?: string;
      publish?: boolean;
    } = {},
  ): ChangelogEntry {
    if (!version || !title) throw new Error('APIChangelogService: version and title are required');

    const versionEntries = Array.from(this.entries.values()).filter((e) => e.version === version);
    if (versionEntries.length >= this.config.maxEntriesPerVersion) {
      throw new Error(`APIChangelogService: version "${version}" has reached max entries (${this.config.maxEntriesPerVersion})`);
    }

    const id = generateId();
    const now = Date.now();
    const publish = options.publish ?? false;

    const entry: ChangelogEntry = {
      id,
      version,
      title,
      description: options.description ?? '',
      changeType: options.changeType ?? 'changed',
      breakingLevel: options.breakingLevel ?? 'none',
      affectedEndpoints: options.affectedEndpoints ?? [],
      migrationGuide: options.migrationGuide ?? null,
      tags: options.tags ?? [],
      author: options.author ?? 'system',
      createdAt: now,
      publishedAt: publish ? now : null,
      published: publish,
    };

    // Auto-generate migration guide for breaking changes without one
    if (entry.breakingLevel !== 'none' && !entry.migrationGuide) {
      entry.migrationGuide = this.generateMigrationGuide(entry);
    }

    this.entries.set(id, entry);

    if (publish) {
      this.notifySubscribers(entry);
    }

    logger.info('APIChangelogService: entry added', {
      id,
      version,
      title,
      changeType: entry.changeType,
      breaking: entry.breakingLevel !== 'none',
    });
    return { ...entry, affectedEndpoints: [...entry.affectedEndpoints], tags: [...entry.tags] };
  }

  /**
   * Publish an unpublished entry.
   */
  publishEntry(entryId: string): boolean {
    const entry = this.entries.get(entryId);
    if (!entry) return false;
    if (entry.published) return true;

    entry.published = true;
    entry.publishedAt = Date.now();
    this.notifySubscribers(entry);

    logger.info('APIChangelogService: entry published', { entryId, version: entry.version });
    return true;
  }

  /**
   * Update an existing changelog entry.
   */
  updateEntry(
    entryId: string,
    updates: {
      title?: string;
      description?: string;
      changeType?: ChangeType;
      breakingLevel?: BreakingLevel;
      affectedEndpoints?: string[];
      migrationGuide?: string;
      tags?: string[];
    },
  ): ChangelogEntry | null {
    const entry = this.entries.get(entryId);
    if (!entry) return null;

    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.description !== undefined) entry.description = updates.description;
    if (updates.changeType !== undefined) entry.changeType = updates.changeType;
    if (updates.breakingLevel !== undefined) entry.breakingLevel = updates.breakingLevel;
    if (updates.affectedEndpoints !== undefined) entry.affectedEndpoints = [...updates.affectedEndpoints];
    if (updates.migrationGuide !== undefined) entry.migrationGuide = updates.migrationGuide;
    if (updates.tags !== undefined) entry.tags = [...updates.tags];

    // Regenerate migration guide if now breaking but has no guide
    if (entry.breakingLevel !== 'none' && !entry.migrationGuide) {
      entry.migrationGuide = this.generateMigrationGuide(entry);
    }

    logger.info('APIChangelogService: entry updated', { entryId });
    return { ...entry, affectedEndpoints: [...entry.affectedEndpoints], tags: [...entry.tags] };
  }

  /**
   * Get a specific entry by ID.
   */
  getEntry(entryId: string): ChangelogEntry | null {
    const entry = this.entries.get(entryId);
    return entry ? { ...entry, affectedEndpoints: [...entry.affectedEndpoints], tags: [...entry.tags] } : null;
  }

  /**
   * Get all entries for a specific version.
   */
  getVersionEntries(version: string): ChangelogEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.version === version && e.published)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({ ...e, affectedEndpoints: [...e.affectedEndpoints], tags: [...e.tags] }));
  }

  /**
   * Get a complete changelog across all versions.
   */
  getFullChangelog(): Record<string, ChangelogEntry[]> {
    const result: Record<string, ChangelogEntry[]> = {};
    const published = Array.from(this.entries.values()).filter((e) => e.published);

    for (const entry of published) {
      if (!result[entry.version]) result[entry.version] = [];
      result[entry.version].push({
        ...entry,
        affectedEndpoints: [...entry.affectedEndpoints],
        tags: [...entry.tags],
      });
    }

    // Sort versions in descending order
    const sorted: Record<string, ChangelogEntry[]> = {};
    const versions = Object.keys(result).sort((a, b) => compareVersions(b, a));
    for (const v of versions) {
      sorted[v] = result[v].sort((a, b) => b.createdAt - a.createdAt);
    }

    return sorted;
  }

  // ── Search and Filtering ──────────────────────────────────────────────────

  /**
   * Search and filter changelog entries.
   */
  search(options: ChangelogSearchOptions): { entries: ChangelogEntry[]; total: number } {
    let results = Array.from(this.entries.values()).filter((e) => e.published);

    if (options.version) {
      results = results.filter((e) => e.version === options.version);
    }
    if (options.changeType) {
      results = results.filter((e) => e.changeType === options.changeType);
    }
    if (options.breaking !== undefined) {
      results = options.breaking
        ? results.filter((e) => e.breakingLevel !== 'none')
        : results.filter((e) => e.breakingLevel === 'none');
    }
    if (options.fromDate) {
      results = results.filter((e) => e.createdAt >= options.fromDate!);
    }
    if (options.toDate) {
      results = results.filter((e) => e.createdAt <= options.toDate!);
    }
    if (options.tag) {
      results = results.filter((e) => e.tags.includes(options.tag!));
    }
    if (options.endpoint) {
      results = results.filter((e) => e.affectedEndpoints.includes(options.endpoint!));
    }
    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    results.sort((a, b) => b.createdAt - a.createdAt);

    const total = results.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const paged = results.slice(offset, offset + limit);

    return {
      entries: paged.map((e) => ({ ...e, affectedEndpoints: [...e.affectedEndpoints], tags: [...e.tags] })),
      total,
    };
  }

  // ── Deprecation Management ────────────────────────────────────────────────

  /**
   * Announce a deprecation for an endpoint.
   */
  announceDeprecation(
    endpoint: string,
    version: string,
    options?: {
      sunsetDate?: number;
      replacement?: string;
      migrationGuide?: string;
      affectedConsumers?: string[];
    },
  ): DeprecationRecord {
    if (!endpoint || !version) throw new Error('APIChangelogService: endpoint and version are required');

    // Check for duplicate active deprecation
    for (const dep of this.deprecations.values()) {
      if (dep.endpoint === endpoint && dep.status !== 'removed') {
        throw new Error(`APIChangelogService: endpoint "${endpoint}" already has an active deprecation`);
      }
    }

    const id = generateId();
    const now = Date.now();

    const record: DeprecationRecord = {
      id,
      endpoint,
      version,
      status: 'announced',
      announcedAt: now,
      sunsetDate: options?.sunsetDate ?? now + this.config.deprecationGracePeriodMs,
      removedAt: null,
      replacement: options?.replacement ?? null,
      migrationGuide: options?.migrationGuide ?? null,
      affectedConsumers: options?.affectedConsumers ?? [],
    };

    this.deprecations.set(id, record);

    // Auto-create a changelog entry for the deprecation
    this.addEntry(version, `Deprecation: ${endpoint}`, {
      description: `Endpoint ${endpoint} has been deprecated. ${record.replacement ? `Use ${record.replacement} instead.` : 'No replacement provided.'}`,
      changeType: 'deprecated',
      breakingLevel: 'minor',
      affectedEndpoints: [endpoint],
      migrationGuide: record.migrationGuide ?? undefined,
      tags: ['deprecation'],
      publish: true,
    });

    logger.info('APIChangelogService: deprecation announced', {
      id,
      endpoint,
      sunsetDate: new Date(record.sunsetDate).toISOString(),
    });
    return { ...record };
  }

  /**
   * Advance a deprecation to its next status.
   */
  advanceDeprecation(deprecationId: string): DeprecationRecord | null {
    const record = this.deprecations.get(deprecationId);
    if (!record) return null;

    const transitions: Record<DeprecationStatus, DeprecationStatus | null> = {
      announced: 'active',
      active: 'sunset',
      sunset: 'removed',
      removed: null,
    };

    const nextStatus = transitions[record.status];
    if (!nextStatus) return null;

    record.status = nextStatus;
    if (nextStatus === 'removed') {
      record.removedAt = Date.now();
    }

    logger.info('APIChangelogService: deprecation advanced', {
      deprecationId,
      newStatus: nextStatus,
    });
    return { ...record };
  }

  /**
   * Get active deprecations.
   */
  getActiveDeprecations(): DeprecationRecord[] {
    const now = Date.now();

    // Auto-advance deprecations past their sunset date
    for (const record of this.deprecations.values()) {
      if (record.status === 'announced' && now >= record.sunsetDate - this.config.deprecationGracePeriodMs / 2) {
        record.status = 'active';
      }
      if (record.status === 'active' && now >= record.sunsetDate) {
        record.status = 'sunset';
      }
    }

    return Array.from(this.deprecations.values())
      .filter((d) => d.status !== 'removed')
      .map((d) => ({ ...d, affectedConsumers: [...d.affectedConsumers] }));
  }

  /**
   * Get deprecation timeline showing upcoming sunsets.
   */
  getDeprecationTimeline(): Array<{ endpoint: string; status: DeprecationStatus; sunsetDate: number; daysRemaining: number }> {
    const now = Date.now();
    const msPerDay = 86400000;

    return Array.from(this.deprecations.values())
      .filter((d) => d.status !== 'removed')
      .map((d) => ({
        endpoint: d.endpoint,
        status: d.status,
        sunsetDate: d.sunsetDate,
        daysRemaining: Math.max(0, Math.ceil((d.sunsetDate - now) / msPerDay)),
      }))
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  // ── Impact Assessment ─────────────────────────────────────────────────────

  /**
   * Assess the impact of a changelog entry.
   */
  assessImpact(entryId: string, totalApps?: number): ChangeImpact | null {
    const entry = this.entries.get(entryId);
    if (!entry) return null;

    const apps = totalApps ?? 100;
    const endpointCount = entry.affectedEndpoints.length;

    let impactLevel: ImpactLevel;
    let affectedAppEstimate: number;
    let effort: string;
    const riskFactors: string[] = [];

    if (entry.breakingLevel === 'major') {
      impactLevel = endpointCount > 3 ? 'critical' : 'high';
      affectedAppEstimate = Math.ceil(apps * 0.8);
      effort = endpointCount > 5 ? 'Multiple days' : 'Several hours';
      riskFactors.push('Breaking change requires all consumers to update');
      if (endpointCount > 3) riskFactors.push('Multiple endpoints affected increases risk');
    } else if (entry.breakingLevel === 'minor') {
      impactLevel = endpointCount > 5 ? 'high' : 'medium';
      affectedAppEstimate = Math.ceil(apps * 0.5);
      effort = 'A few hours';
      riskFactors.push('Minor breaking change may require code updates');
    } else if (entry.changeType === 'deprecated') {
      impactLevel = 'medium';
      affectedAppEstimate = Math.ceil(apps * 0.3);
      effort = 'Plan migration within grace period';
      riskFactors.push('Deprecated endpoints will be removed in a future version');
    } else if (entry.changeType === 'security') {
      impactLevel = 'high';
      affectedAppEstimate = Math.ceil(apps * 0.9);
      effort = 'Immediate update recommended';
      riskFactors.push('Security fix should be applied as soon as possible');
    } else {
      impactLevel = 'low';
      affectedAppEstimate = Math.ceil(apps * 0.1);
      effort = 'No action required';
    }

    if (!entry.migrationGuide && entry.breakingLevel !== 'none') {
      riskFactors.push('No migration guide provided');
    }

    return {
      entryId,
      impactLevel,
      affectedApps: affectedAppEstimate,
      affectedEndpoints: [...entry.affectedEndpoints],
      estimatedMigrationEffort: effort,
      riskFactors,
    };
  }

  // ── Subscribers ───────────────────────────────────────────────────────────

  /**
   * Subscribe to changelog notifications.
   */
  subscribe(
    email: string,
    options?: { versions?: string[]; changeTypes?: ChangeType[]; endpoints?: string[] },
  ): ChangelogSubscriber {
    if (!email) throw new Error('APIChangelogService: email is required');

    // Check for existing subscription
    for (const sub of this.subscribers.values()) {
      if (sub.email === email && sub.active) {
        // Update existing subscription
        if (options?.versions) sub.versions = [...options.versions];
        if (options?.changeTypes) sub.changeTypes = [...options.changeTypes];
        if (options?.endpoints) sub.endpoints = [...options.endpoints];
        return { ...sub };
      }
    }

    const id = generateId();
    const subscriber: ChangelogSubscriber = {
      id,
      email,
      versions: options?.versions ?? [],
      changeTypes: options?.changeTypes ?? [],
      endpoints: options?.endpoints ?? [],
      subscribedAt: Date.now(),
      active: true,
    };

    this.subscribers.set(id, subscriber);
    logger.info('APIChangelogService: subscriber added', { id, email });
    return { ...subscriber };
  }

  /**
   * Unsubscribe from changelog notifications.
   */
  unsubscribe(subscriberId: string): boolean {
    const sub = this.subscribers.get(subscriberId);
    if (!sub) return false;

    sub.active = false;
    logger.info('APIChangelogService: subscriber removed', { subscriberId });
    return true;
  }

  /**
   * Get notification history.
   */
  getNotificationHistory(limit?: number): SubscriberNotification[] {
    const entries = this.notifications.slice(-(limit ?? 100));
    return entries.map((n) => ({ ...n }));
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): ChangelogMetrics {
    const entriesByType: Record<ChangeType, number> = {
      added: 0,
      changed: 0,
      deprecated: 0,
      removed: 0,
      fixed: 0,
      security: 0,
    };

    let breakingChanges = 0;

    for (const entry of this.entries.values()) {
      entriesByType[entry.changeType]++;
      if (entry.breakingLevel !== 'none') breakingChanges++;
    }

    const activeDeprecations = Array.from(this.deprecations.values())
      .filter((d) => d.status !== 'removed').length;

    const activeSubscribers = Array.from(this.subscribers.values())
      .filter((s) => s.active).length;

    return {
      totalEntries: this.entries.size,
      entriesByType,
      breakingChanges,
      activeDeprecations,
      subscriberCount: activeSubscribers,
      notificationsSent: this.notifications.length,
    };
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
    this.deprecations.clear();
    this.subscribers.clear();
    this.notifications.length = 0;
    logger.info('APIChangelogService destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private generateMigrationGuide(entry: ChangelogEntry): string {
    const lines: string[] = [
      `# Migration Guide: ${entry.title}`,
      '',
      `**Version:** ${entry.version}`,
      `**Breaking Level:** ${entry.breakingLevel}`,
      '',
      '## Summary',
      entry.description || 'No description provided.',
      '',
    ];

    if (entry.affectedEndpoints.length > 0) {
      lines.push('## Affected Endpoints');
      for (const ep of entry.affectedEndpoints) {
        lines.push(`- \`${ep}\``);
      }
      lines.push('');
    }

    lines.push('## Steps');
    if (entry.breakingLevel === 'major') {
      lines.push('1. Review the changes in this version carefully.');
      lines.push('2. Update your API client to handle the new behavior.');
      lines.push('3. Test thoroughly in a sandbox environment before deploying.');
      lines.push('4. Deploy the updated client to production.');
    } else {
      lines.push('1. Review the changes listed above.');
      lines.push('2. Update affected API calls if necessary.');
      lines.push('3. Test to verify compatibility.');
    }

    return lines.join('\n');
  }

  private notifySubscribers(entry: ChangelogEntry): void {
    const matchingSubscribers = Array.from(this.subscribers.values()).filter((sub) => {
      if (!sub.active) return false;

      // Match by version if subscriber specified versions
      if (sub.versions.length > 0 && !sub.versions.includes(entry.version)) return false;

      // Match by change type if subscriber specified types
      if (sub.changeTypes.length > 0 && !sub.changeTypes.includes(entry.changeType)) return false;

      // Match by endpoint if subscriber specified endpoints
      if (sub.endpoints.length > 0) {
        const hasOverlap = sub.endpoints.some((ep) => entry.affectedEndpoints.includes(ep));
        if (!hasOverlap && entry.affectedEndpoints.length > 0) return false;
      }

      return true;
    });

    const reason = `${entry.changeType} change in v${entry.version}: ${entry.title}`;
    let notified = 0;

    for (const sub of matchingSubscribers) {
      if (notified >= this.config.notificationBatchSize) break;

      this.notifications.push({
        subscriberId: sub.id,
        entryId: entry.id,
        email: sub.email,
        sentAt: Date.now(),
        reason,
      });
      notified++;
    }

    if (notified > 0) {
      logger.info('APIChangelogService: notifications sent', {
        entryId: entry.id,
        notified,
        total: matchingSubscribers.length,
      });
    }
  }

  private cleanup(): void {
    // Trim notification history to last 10000 entries
    if (this.notifications.length > 10000) {
      this.notifications.splice(0, this.notifications.length - 10000);
    }

    // Auto-advance overdue deprecations
    const now = Date.now();
    for (const record of this.deprecations.values()) {
      if (record.status === 'sunset' && now > record.sunsetDate + this.config.deprecationGracePeriodMs) {
        record.status = 'removed';
        record.removedAt = now;
        logger.info('APIChangelogService: deprecation auto-removed', { endpoint: record.endpoint });
      }
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getAPIChangelogService(): APIChangelogService {
  const g = globalThis as unknown as Record<string, APIChangelogService>;
  if (!g.__apiChangelogService__) {
    g.__apiChangelogService__ = new APIChangelogService();
  }
  return g.__apiChangelogService__;
}
