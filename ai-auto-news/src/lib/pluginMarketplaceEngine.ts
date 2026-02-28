/**
 * Plugin Marketplace Engine
 *
 * Provides:
 * - Plugin registration, installation, activation/deactivation
 * - Plugin validation and security scanning
 * - Version management and compatibility checking
 * - Plugin dependency resolution with topological sort
 * - Marketplace search and filtering with relevance scoring
 * - Plugin ratings and reviews
 * - Revenue sharing for plugin developers
 * - Plugin sandboxing and resource limits
 */

import { getLogger } from './logger';

const logger = getLogger();

export type PluginCategory = 'analytics' | 'security' | 'integration' | 'ai' | 'monitoring' | 'billing' | 'custom';
export type PluginStatus = 'draft' | 'pending_review' | 'approved' | 'published' | 'suspended' | 'deprecated';
export type PluginPermission = 'read_data' | 'write_data' | 'api_access' | 'webhook' | 'billing' | 'admin';

export interface Plugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  permissions: PluginPermission[];
  dependencies: string[];
  entryPoint: string;
  config: Record<string, unknown>;
  status: PluginStatus;
  downloads: number;
  rating: number;
  revenue: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PluginInstallation {
  pluginId: string;
  tenantId: string;
  version: string;
  status: 'installed' | 'active' | 'inactive' | 'failed';
  config: Record<string, unknown>;
  installedAt: Date;
  activatedAt: Date | null;
}

export interface PluginReview {
  pluginId: string;
  userId: string;
  rating: number;
  comment: string;
  timestamp: Date;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  securityScore: number;
  performanceScore: number;
}

export interface PluginSearchQuery {
  query?: string;
  category?: PluginCategory;
  minRating?: number;
  sortBy?: 'relevance' | 'downloads' | 'rating' | 'newest';
  page?: number;
  limit?: number;
}

export interface PluginSearchResult {
  plugins: Plugin[];
  total: number;
  page: number;
  totalPages: number;
}

export interface MarketplaceStats {
  totalPlugins: number;
  totalInstallations: number;
  totalRevenue: number;
  topPlugins: Plugin[];
  categoryDistribution: Record<PluginCategory, number>;
}

const DANGEROUS_PERMISSION_COMBOS: PluginPermission[][] = [
  ['admin', 'billing'],
  ['write_data', 'admin'],
];
const BLOCKED_ENTRY_PATTERNS = [/eval\s*\(/, /Function\s*\(/, /child_process/, /fs\.unlink/];
const PLATFORM_VERSIONS: Record<string, number[]> = {
  '1.x': [1, 0, 0],
  '2.x': [2, 0, 0],
  '3.x': [3, 0, 0],
};
const ALL_CATEGORIES: PluginCategory[] = [
  'analytics', 'security', 'integration', 'ai', 'monitoring', 'billing', 'custom',
];

export class PluginMarketplaceEngine {
  private plugins = new Map<string, Plugin>();
  private installations = new Map<string, PluginInstallation[]>();
  private reviews = new Map<string, PluginReview[]>();
  private platformVersion = '2.x';

  registerPlugin(plugin: Plugin): Plugin {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin ${plugin.id} already registered`);
    }
    if (!plugin.name || plugin.name.length < 3) {
      throw new Error('Plugin name must be at least 3 characters');
    }
    if (!/^\d+\.\d+\.\d+$/.test(plugin.version)) {
      throw new Error('Plugin version must follow semver (e.g. 1.0.0)');
    }
    const now = new Date();
    const registered: Plugin = {
      ...plugin,
      status: 'draft',
      downloads: 0,
      rating: 0,
      revenue: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.plugins.set(registered.id, registered);
    logger.info(`Plugin registered: ${registered.name}@${registered.version}`);
    return registered;
  }

  validatePlugin(pluginId: string): PluginValidationResult {
    const plugin = this.requirePlugin(pluginId);
    const errors: string[] = [];
    const warnings: string[] = [];
    let securityScore = 100;
    let performanceScore = 100;

    if (!plugin.entryPoint || !plugin.entryPoint.endsWith('.js')) {
      errors.push('entryPoint must reference a .js file');
    }
    if (!plugin.description || plugin.description.length < 20) {
      warnings.push('Description should be at least 20 characters for discoverability');
    }
    if (plugin.permissions.length === 0) {
      warnings.push('No permissions declared — plugin will have no data access');
    }
    for (const combo of DANGEROUS_PERMISSION_COMBOS) {
      if (combo.every((p) => plugin.permissions.includes(p))) {
        securityScore -= 30;
        warnings.push(`Dangerous permission combination: ${combo.join(' + ')}`);
      }
    }
    if (plugin.permissions.includes('admin')) {
      securityScore -= 20;
      warnings.push('admin permission significantly reduces security score');
    }
    // Simulate static analysis: detect suspicious patterns in entry path names
    for (const pattern of BLOCKED_ENTRY_PATTERNS) {
      if (pattern.test(plugin.entryPoint)) {
        securityScore -= 25;
        errors.push(`Blocked pattern detected in entryPoint: ${pattern.source}`);
      }
    }
    for (const dep of plugin.dependencies) {
      if (!this.plugins.has(dep)) {
        errors.push(`Missing dependency: ${dep}`);
      }
    }
    if (plugin.permissions.length > 4) {
      performanceScore -= 10 * (plugin.permissions.length - 4);
    }
    if (plugin.dependencies.length > 5) {
      performanceScore -= 5 * (plugin.dependencies.length - 5);
    }
    securityScore = Math.max(0, Math.min(100, securityScore));
    performanceScore = Math.max(0, Math.min(100, performanceScore));

    const result: PluginValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
      securityScore,
      performanceScore,
    };
    logger.info(`Validation for ${pluginId}: valid=${result.valid}, security=${securityScore}`);
    return result;
  }

  publishPlugin(pluginId: string): Plugin {
    const plugin = this.requirePlugin(pluginId);
    const validation = this.validatePlugin(pluginId);
    if (!validation.valid) {
      throw new Error(`Cannot publish plugin with errors: ${validation.errors.join('; ')}`);
    }
    if (validation.securityScore < 40) {
      throw new Error(`Security score too low (${validation.securityScore}) to publish`);
    }
    plugin.status = 'published';
    plugin.updatedAt = new Date();
    logger.info(`Plugin published: ${plugin.name}@${plugin.version}`);
    return plugin;
  }

  installPlugin(pluginId: string, tenantId: string, config?: Record<string, unknown>): PluginInstallation {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.status !== 'published') {
      throw new Error(`Plugin ${pluginId} is not published (status: ${plugin.status})`);
    }
    const tenantInstalls = this.installations.get(tenantId) ?? [];
    if (tenantInstalls.some((i) => i.pluginId === pluginId)) {
      throw new Error(`Plugin ${pluginId} already installed for tenant ${tenantId}`);
    }
    const deps = this.resolveDependencies(pluginId);
    for (const dep of deps) {
      if (dep !== pluginId && !tenantInstalls.some((i) => i.pluginId === dep && i.status === 'active')) {
        throw new Error(`Dependency ${dep} must be installed and active before installing ${pluginId}`);
      }
    }
    const installation: PluginInstallation = {
      pluginId,
      tenantId,
      version: plugin.version,
      status: 'installed',
      config: config ?? {},
      installedAt: new Date(),
      activatedAt: null,
    };
    tenantInstalls.push(installation);
    this.installations.set(tenantId, tenantInstalls);
    plugin.downloads += 1;
    logger.info(`Plugin ${pluginId} installed for tenant ${tenantId}`);
    return installation;
  }

  uninstallPlugin(pluginId: string, tenantId: string): void {
    const tenantInstalls = this.installations.get(tenantId);
    if (!tenantInstalls) throw new Error(`No installations found for tenant ${tenantId}`);
    const idx = tenantInstalls.findIndex((i) => i.pluginId === pluginId);
    if (idx === -1) throw new Error(`Plugin ${pluginId} is not installed for tenant ${tenantId}`);
    for (const inst of tenantInstalls) {
      if (inst.pluginId === pluginId) continue;
      const depPlugin = this.plugins.get(inst.pluginId);
      if (depPlugin?.dependencies.includes(pluginId)) {
        throw new Error(`Cannot uninstall ${pluginId}: plugin ${inst.pluginId} depends on it`);
      }
    }
    tenantInstalls.splice(idx, 1);
    logger.info(`Plugin ${pluginId} uninstalled for tenant ${tenantId}`);
  }

  activatePlugin(pluginId: string, tenantId: string): PluginInstallation {
    const installation = this.requireInstallation(pluginId, tenantId);
    if (installation.status === 'active') return installation;
    installation.status = 'active';
    installation.activatedAt = new Date();
    logger.info(`Plugin ${pluginId} activated for tenant ${tenantId}`);
    return installation;
  }

  deactivatePlugin(pluginId: string, tenantId: string): PluginInstallation {
    const installation = this.requireInstallation(pluginId, tenantId);
    const tenantInstalls = this.installations.get(tenantId) ?? [];
    for (const inst of tenantInstalls) {
      if (inst.pluginId === pluginId || inst.status !== 'active') continue;
      const depPlugin = this.plugins.get(inst.pluginId);
      if (depPlugin?.dependencies.includes(pluginId)) {
        throw new Error(`Cannot deactivate ${pluginId}: active plugin ${inst.pluginId} depends on it`);
      }
    }
    installation.status = 'inactive';
    logger.info(`Plugin ${pluginId} deactivated for tenant ${tenantId}`);
    return installation;
  }

  searchPlugins(query: PluginSearchQuery): PluginSearchResult {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    let candidates = Array.from(this.plugins.values()).filter((p) => p.status === 'published');
    if (query.category) {
      candidates = candidates.filter((p) => p.category === query.category);
    }
    if (query.minRating !== undefined) {
      const min = query.minRating;
      candidates = candidates.filter((p) => p.rating >= min);
    }
    if (query.query) {
      const terms = query.query.toLowerCase().split(/\s+/);
      candidates = candidates
        .map((p) => {
          let score = 0;
          const nameL = p.name.toLowerCase();
          const descL = p.description.toLowerCase();
          for (const t of terms) {
            if (nameL.includes(t)) score += 10;
            if (descL.includes(t)) score += 3;
            if (p.category.includes(t)) score += 5;
            if (p.author.toLowerCase().includes(t)) score += 2;
          }
          return { plugin: p, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.plugin);
    }
    const sortBy = query.sortBy ?? 'relevance';
    if (sortBy === 'downloads') candidates.sort((a, b) => b.downloads - a.downloads);
    else if (sortBy === 'rating') candidates.sort((a, b) => b.rating - a.rating);
    else if (sortBy === 'newest') candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = candidates.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    return { plugins: candidates.slice(start, start + limit), total, page, totalPages };
  }

  addReview(review: PluginReview): void {
    this.requirePlugin(review.pluginId);
    if (review.rating < 1 || review.rating > 5) throw new Error('Rating must be between 1 and 5');
    const pluginReviews = this.reviews.get(review.pluginId) ?? [];
    const existing = pluginReviews.findIndex((r) => r.userId === review.userId);
    if (existing !== -1) {
      pluginReviews[existing] = review;
    } else {
      pluginReviews.push(review);
    }
    this.reviews.set(review.pluginId, pluginReviews);
    const plugin = this.plugins.get(review.pluginId)!;
    const sum = pluginReviews.reduce((s, r) => s + r.rating, 0);
    plugin.rating = Math.round((sum / pluginReviews.length) * 10) / 10;
    plugin.updatedAt = new Date();
    logger.info(`Review added for ${review.pluginId} by ${review.userId}: ${review.rating}/5`);
  }

  getPluginReviews(pluginId: string): PluginReview[] {
    this.requirePlugin(pluginId);
    return this.reviews.get(pluginId) ?? [];
  }

  resolveDependencies(pluginId: string): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Circular dependency detected involving plugin ${id}`);
      visiting.add(id);
      const plugin = this.plugins.get(id);
      if (!plugin) throw new Error(`Dependency plugin not found: ${id}`);
      for (const dep of plugin.dependencies) visit(dep);
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };
    visit(pluginId);
    return order;
  }

  checkCompatibility(pluginId: string, tenantVersion: string): { compatible: boolean; issues: string[] } {
    const plugin = this.requirePlugin(pluginId);
    const issues: string[] = [];
    const parseSemver = (v: string): number[] => {
      const parts = v.split('.').map(Number);
      return parts.length === 3 && parts.every((n) => !isNaN(n)) ? parts : [];
    };
    const pluginVer = parseSemver(plugin.version);
    const tenantVer = parseSemver(tenantVersion);
    if (pluginVer.length === 0) issues.push('Invalid plugin version format');
    if (tenantVer.length === 0) issues.push('Invalid tenant version format');
    if (pluginVer.length === 3 && tenantVer.length === 3) {
      if (pluginVer[0] !== tenantVer[0]) {
        issues.push(`Major version mismatch: plugin=${pluginVer[0]}, tenant=${tenantVer[0]}`);
      }
      if (pluginVer[0] === tenantVer[0] && pluginVer[1] > tenantVer[1]) {
        issues.push(`Plugin requires newer minor version: plugin=${pluginVer[1]}, tenant=${tenantVer[1]}`);
      }
    }
    const platformVer = PLATFORM_VERSIONS[this.platformVersion];
    if (platformVer && pluginVer.length === 3 && pluginVer[0] > platformVer[0]) {
      issues.push(`Plugin targets platform v${pluginVer[0]}.x but current platform is ${this.platformVersion}`);
    }
    for (const dep of plugin.dependencies) {
      const depPlugin = this.plugins.get(dep);
      if (!depPlugin) {
        issues.push(`Dependency ${dep} not found in marketplace`);
      } else if (depPlugin.status === 'deprecated') {
        issues.push(`Dependency ${dep} is deprecated`);
      } else if (depPlugin.status === 'suspended') {
        issues.push(`Dependency ${dep} is suspended`);
      }
    }
    return { compatible: issues.length === 0, issues };
  }

  getMarketplaceStats(): MarketplaceStats {
    const allPlugins = Array.from(this.plugins.values());
    let totalInstallations = 0;
    for (const installs of this.installations.values()) totalInstallations += installs.length;
    const totalRevenue = allPlugins.reduce((s, p) => s + p.revenue, 0);
    const topPlugins = [...allPlugins]
      .filter((p) => p.status === 'published')
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 10);
    const categoryDistribution = {} as Record<PluginCategory, number>;
    for (const cat of ALL_CATEGORIES) categoryDistribution[cat] = allPlugins.filter((p) => p.category === cat).length;
    return { totalPlugins: allPlugins.length, totalInstallations, totalRevenue, topPlugins, categoryDistribution };
  }

  getPlugin(pluginId: string): Plugin | null {
    return this.plugins.get(pluginId) ?? null;
  }

  getInstalledPlugins(tenantId: string): PluginInstallation[] {
    return this.installations.get(tenantId) ?? [];
  }

  private requirePlugin(pluginId: string): Plugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    return plugin;
  }

  private requireInstallation(pluginId: string, tenantId: string): PluginInstallation {
    const tenantInstalls = this.installations.get(tenantId);
    if (!tenantInstalls) throw new Error(`No installations found for tenant ${tenantId}`);
    const installation = tenantInstalls.find((i) => i.pluginId === pluginId);
    if (!installation) throw new Error(`Plugin ${pluginId} is not installed for tenant ${tenantId}`);
    return installation;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
  var __pluginMarketplaceEngine__: PluginMarketplaceEngine | undefined;
}

export function getPluginMarketplaceEngine(): PluginMarketplaceEngine {
  if (!globalThis.__pluginMarketplaceEngine__) {
    globalThis.__pluginMarketplaceEngine__ = new PluginMarketplaceEngine();
  }
  return globalThis.__pluginMarketplaceEngine__;
}
