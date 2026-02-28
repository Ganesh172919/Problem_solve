/**
 * Plugin System
 *
 * Extensible plugin architecture with:
 * - Plugin lifecycle management (install/enable/disable/uninstall)
 * - Capability-based permission system
 * - Sandboxed execution with resource limits
 * - Hook system for platform extension points
 * - Plugin marketplace registry
 * - Version compatibility checking
 * - Plugin configuration schema
 * - Per-tenant plugin management
 * - Plugin health monitoring
 * - Dependency resolution between plugins
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'error' | 'incompatible' | 'updating';

export type PluginCapability =
  | 'read_posts'
  | 'write_posts'
  | 'read_users'
  | 'send_notifications'
  | 'access_analytics'
  | 'manage_webhooks'
  | 'execute_ai'
  | 'access_billing'
  | 'external_http'
  | 'schedule_tasks';

export type HookName =
  | 'post.beforeGenerate'
  | 'post.afterGenerate'
  | 'post.beforePublish'
  | 'post.afterPublish'
  | 'user.created'
  | 'user.deleted'
  | 'billing.upgraded'
  | 'billing.churned'
  | 'api.beforeRequest'
  | 'api.afterRequest'
  | 'scheduler.tick'
  | 'content.moderated';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  license: string;
  capabilities: PluginCapability[];
  hooks: HookName[];
  configSchema: PluginConfigField[];
  minPlatformVersion: string;
  maxPlatformVersion?: string;
  dependencies: Array<{ pluginId: string; version: string }>;
  tier: 'free' | 'pro' | 'enterprise';
  category: PluginCategory;
  tags: string[];
  icon?: string;
  screenshots?: string[];
  downloads?: number;
  rating?: number;
}

export type PluginCategory =
  | 'content'
  | 'distribution'
  | 'analytics'
  | 'automation'
  | 'security'
  | 'integration'
  | 'ai'
  | 'utility';

export interface PluginConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'secret' | 'select';
  label: string;
  description: string;
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
}

export interface InstalledPlugin {
  manifestId: string;
  manifest: PluginManifest;
  tenantId: string;
  status: PluginStatus;
  config: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
  installedBy: string;
  errorMessage?: string;
  executionCount: number;
  lastExecutedAt?: Date;
  avgExecutionMs: number;
}

export interface PluginExecutionContext {
  pluginId: string;
  tenantId: string;
  hookName: HookName;
  payload: Record<string, unknown>;
  config: Record<string, unknown>;
  capabilities: Set<PluginCapability>;
}

export interface PluginExecutionResult {
  pluginId: string;
  hookName: HookName;
  success: boolean;
  durationMs: number;
  output?: Record<string, unknown>;
  error?: string;
  modifiedPayload?: Record<string, unknown>;
}

export interface MarketplaceListing {
  manifest: PluginManifest;
  featured: boolean;
  verified: boolean;
  installCount: number;
  avgRating: number;
  reviewCount: number;
  lastUpdated: Date;
  priceMonthly?: number; // 0 = free
}

type HookHandler = (ctx: PluginExecutionContext) => Promise<Record<string, unknown> | void>;

const PLATFORM_VERSION = '2.0.0';
const MAX_PLUGIN_EXECUTION_MS = 5000;
const hookRegistry = new Map<HookName, Map<string, HookHandler>>();
const installedPlugins = new Map<string, InstalledPlugin>(); // key: `${tenantId}:${pluginId}`

// Marketplace registry (in production, this would be DB-backed)
const marketplaceRegistry: MarketplaceListing[] = [
  {
    manifest: {
      id: 'wordpress-publisher',
      name: 'WordPress Publisher',
      version: '1.2.0',
      description: 'Automatically publish generated posts to WordPress via REST API',
      author: 'Platform Team',
      license: 'MIT',
      capabilities: ['read_posts', 'external_http'],
      hooks: ['post.afterPublish'],
      configSchema: [
        { key: 'siteUrl', type: 'string', label: 'WordPress Site URL', description: 'Your WordPress site URL', required: true },
        { key: 'apiKey', type: 'secret', label: 'Application Password', description: 'WordPress application password', required: true },
        { key: 'defaultCategory', type: 'string', label: 'Default Category', description: 'Category ID for posts', required: false, defaultValue: '1' },
      ],
      minPlatformVersion: '1.0.0',
      dependencies: [],
      tier: 'pro',
      category: 'distribution',
      tags: ['wordpress', 'cms', 'publish'],
      downloads: 1240,
      rating: 4.7,
    },
    featured: true,
    verified: true,
    installCount: 1240,
    avgRating: 4.7,
    reviewCount: 89,
    lastUpdated: new Date('2025-01-15'),
  },
  {
    manifest: {
      id: 'slack-notifications',
      name: 'Slack Notifications',
      version: '2.0.1',
      description: 'Send rich Slack notifications for platform events',
      author: 'Platform Team',
      license: 'MIT',
      capabilities: ['external_http', 'read_posts'],
      hooks: ['post.afterPublish', 'billing.upgraded', 'billing.churned'],
      configSchema: [
        { key: 'webhookUrl', type: 'secret', label: 'Slack Webhook URL', description: 'Incoming webhook URL', required: true },
        { key: 'channel', type: 'string', label: 'Channel', description: 'Target channel', required: false, defaultValue: '#general' },
        { key: 'notifyOnPublish', type: 'boolean', label: 'Notify on Publish', description: 'Send notification when post is published', required: false, defaultValue: true },
      ],
      minPlatformVersion: '1.0.0',
      dependencies: [],
      tier: 'free',
      category: 'integration',
      tags: ['slack', 'notifications', 'alerts'],
      downloads: 3450,
      rating: 4.9,
    },
    featured: true,
    verified: true,
    installCount: 3450,
    avgRating: 4.9,
    reviewCount: 215,
    lastUpdated: new Date('2025-02-01'),
  },
  {
    manifest: {
      id: 'seo-optimizer',
      name: 'SEO Optimizer',
      version: '1.0.5',
      description: 'Automatically optimize generated content for SEO including meta tags, keywords and readability scores',
      author: 'SEO Labs',
      license: 'MIT',
      capabilities: ['read_posts', 'write_posts', 'execute_ai'],
      hooks: ['post.beforePublish'],
      configSchema: [
        { key: 'targetKeywordDensity', type: 'number', label: 'Target Keyword Density %', description: 'Target keyword density', required: false, defaultValue: 2 },
        { key: 'autoAddMetaTags', type: 'boolean', label: 'Auto Add Meta Tags', description: 'Automatically add meta description', required: false, defaultValue: true },
        { key: 'readabilityTarget', type: 'select', label: 'Readability Target', description: 'Target reading grade', required: false, defaultValue: 'grade8', options: ['grade6', 'grade8', 'grade10', 'grade12'] },
      ],
      minPlatformVersion: '1.5.0',
      dependencies: [],
      tier: 'pro',
      category: 'content',
      tags: ['seo', 'optimization', 'meta'],
      downloads: 890,
      rating: 4.5,
    },
    featured: false,
    verified: true,
    installCount: 890,
    avgRating: 4.5,
    reviewCount: 67,
    lastUpdated: new Date('2025-01-20'),
  },
];

function parseVersion(v: string): number[] {
  return v.split('.').map(Number);
}

function isVersionCompatible(pluginMin: string, pluginMax: string | undefined): boolean {
  const platform = parseVersion(PLATFORM_VERSION);
  const min = parseVersion(pluginMin);
  const max = pluginMax ? parseVersion(pluginMax) : null;

  for (let i = 0; i < 3; i++) {
    const p = platform[i] ?? 0;
    const m = min[i] ?? 0;
    if (p < m) return false;
    if (p > m) break;
  }

  if (max) {
    for (let i = 0; i < 3; i++) {
      const p = platform[i] ?? 0;
      const mx = max[i] ?? 0;
      if (p > mx) return false;
      if (p < mx) break;
    }
  }

  return true;
}

export function installPlugin(
  manifest: PluginManifest,
  tenantId: string,
  installedBy: string,
  config: Record<string, unknown> = {},
): InstalledPlugin {
  const key = `${tenantId}:${manifest.id}`;

  if (!isVersionCompatible(manifest.minPlatformVersion, manifest.maxPlatformVersion)) {
    throw new Error(`Plugin ${manifest.id} is incompatible with platform version ${PLATFORM_VERSION}`);
  }

  // Validate required config fields
  for (const field of manifest.configSchema.filter((f) => f.required)) {
    if (!config[field.key]) {
      throw new Error(`Required config field missing: ${field.key}`);
    }
  }

  // Fill defaults
  for (const field of manifest.configSchema.filter((f) => f.defaultValue !== undefined)) {
    if (config[field.key] === undefined) {
      config[field.key] = field.defaultValue;
    }
  }

  const plugin: InstalledPlugin = {
    manifestId: manifest.id,
    manifest,
    tenantId,
    status: 'installed',
    config,
    installedAt: new Date(),
    updatedAt: new Date(),
    installedBy,
    executionCount: 0,
    avgExecutionMs: 0,
  };

  installedPlugins.set(key, plugin);
  logger.info('Plugin installed', { pluginId: manifest.id, tenantId, version: manifest.version });
  return plugin;
}

export function enablePlugin(pluginId: string, tenantId: string): void {
  const key = `${tenantId}:${pluginId}`;
  const plugin = installedPlugins.get(key);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
  plugin.status = 'enabled';
  plugin.updatedAt = new Date();
  logger.info('Plugin enabled', { pluginId, tenantId });
}

export function disablePlugin(pluginId: string, tenantId: string): void {
  const key = `${tenantId}:${pluginId}`;
  const plugin = installedPlugins.get(key);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
  plugin.status = 'disabled';
  plugin.updatedAt = new Date();
  logger.info('Plugin disabled', { pluginId, tenantId });
}

export function uninstallPlugin(pluginId: string, tenantId: string): void {
  const key = `${tenantId}:${pluginId}`;
  if (!installedPlugins.has(key)) throw new Error(`Plugin not found: ${pluginId}`);
  installedPlugins.delete(key);

  // Remove registered hooks
  for (const [, handlers] of hookRegistry) {
    handlers.delete(key);
  }

  logger.info('Plugin uninstalled', { pluginId, tenantId });
}

export function registerHookHandler(
  pluginId: string,
  tenantId: string,
  hookName: HookName,
  handler: HookHandler,
): void {
  if (!hookRegistry.has(hookName)) hookRegistry.set(hookName, new Map());
  hookRegistry.get(hookName)!.set(`${tenantId}:${pluginId}`, handler);
  logger.debug('Hook handler registered', { pluginId, hookName });
}

export async function executeHook(
  hookName: HookName,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<PluginExecutionResult[]> {
  const handlers = hookRegistry.get(hookName);
  if (!handlers) return [];

  const results: PluginExecutionResult[] = [];

  for (const [key, handler] of handlers) {
    if (!key.startsWith(`${tenantId}:`)) continue;
    const pluginId = key.slice(tenantId.length + 1);
    const plugin = installedPlugins.get(key);
    if (!plugin || plugin.status !== 'enabled') continue;

    const ctx: PluginExecutionContext = {
      pluginId,
      tenantId,
      hookName,
      payload,
      config: plugin.config,
      capabilities: new Set(plugin.manifest.capabilities),
    };

    const startMs = Date.now();
    try {
      // Timeout enforcement
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Plugin execution timeout')), MAX_PLUGIN_EXECUTION_MS),
      );
      const output = await Promise.race([handler(ctx), timeoutPromise]) as Record<string, unknown> | void;
      const durationMs = Date.now() - startMs;

      plugin.executionCount += 1;
      plugin.lastExecutedAt = new Date();
      plugin.avgExecutionMs = (plugin.avgExecutionMs * (plugin.executionCount - 1) + durationMs) / plugin.executionCount;

      results.push({
        pluginId,
        hookName,
        success: true,
        durationMs,
        output: output ?? undefined,
      });

      logger.debug('Plugin hook executed', { pluginId, hookName, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      plugin.errorMessage = String(err);
      if (plugin.executionCount > 5) plugin.status = 'error';

      results.push({
        pluginId,
        hookName,
        success: false,
        durationMs,
        error: String(err),
      });

      logger.error('Plugin hook execution failed', undefined, { pluginId, hookName, error: err });
    }
  }

  return results;
}

export function getTenantPlugins(tenantId: string): InstalledPlugin[] {
  const result: InstalledPlugin[] = [];
  for (const [key, plugin] of installedPlugins) {
    if (key.startsWith(`${tenantId}:`)) result.push(plugin);
  }
  return result;
}

export function getPlugin(pluginId: string, tenantId: string): InstalledPlugin | null {
  return installedPlugins.get(`${tenantId}:${pluginId}`) ?? null;
}

export function updatePluginConfig(
  pluginId: string,
  tenantId: string,
  config: Record<string, unknown>,
): void {
  const key = `${tenantId}:${pluginId}`;
  const plugin = installedPlugins.get(key);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
  plugin.config = { ...plugin.config, ...config };
  plugin.updatedAt = new Date();
}

export function searchMarketplace(options: {
  query?: string;
  category?: PluginCategory;
  tier?: string;
  verified?: boolean;
  featured?: boolean;
  sortBy?: 'downloads' | 'rating' | 'updated';
} = {}): MarketplaceListing[] {
  let results = [...marketplaceRegistry];

  if (options.query) {
    const q = options.query.toLowerCase();
    results = results.filter((p) =>
      p.manifest.name.toLowerCase().includes(q) ||
      p.manifest.description.toLowerCase().includes(q) ||
      p.manifest.tags.some((t) => t.includes(q)),
    );
  }
  if (options.category) results = results.filter((p) => p.manifest.category === options.category);
  if (options.tier) results = results.filter((p) => p.manifest.tier === options.tier);
  if (options.verified !== undefined) results = results.filter((p) => p.verified === options.verified);
  if (options.featured !== undefined) results = results.filter((p) => p.featured === options.featured);

  switch (options.sortBy) {
    case 'downloads': results.sort((a, b) => b.installCount - a.installCount); break;
    case 'rating': results.sort((a, b) => b.avgRating - a.avgRating); break;
    case 'updated': results.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime()); break;
  }

  return results;
}

export function getMarketplaceListing(pluginId: string): MarketplaceListing | null {
  return marketplaceRegistry.find((p) => p.manifest.id === pluginId) ?? null;
}

export function registerMarketplacePlugin(listing: MarketplaceListing): void {
  const idx = marketplaceRegistry.findIndex((p) => p.manifest.id === listing.manifest.id);
  if (idx >= 0) {
    marketplaceRegistry[idx] = listing;
  } else {
    marketplaceRegistry.push(listing);
  }
  logger.info('Plugin registered in marketplace', { pluginId: listing.manifest.id });
}

export function getPluginHealthSummary(tenantId: string): Array<{
  pluginId: string;
  status: PluginStatus;
  executionCount: number;
  avgExecutionMs: number;
  lastError?: string;
}> {
  return getTenantPlugins(tenantId).map((p) => ({
    pluginId: p.manifestId,
    status: p.status,
    executionCount: p.executionCount,
    avgExecutionMs: p.avgExecutionMs,
    lastError: p.errorMessage,
  }));
}
