import { describe, it, expect, beforeEach } from '@jest/globals';
import { getPluginMarketplaceEngine } from '@/lib/pluginMarketplaceEngine';
import type { Plugin, PluginReview } from '@/lib/pluginMarketplaceEngine';

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: 'p1', name: 'TestPlugin', version: '1.0.0', author: 'dev',
    description: 'A test plugin for unit tests', category: 'analytics',
    permissions: ['read_data'], dependencies: [], entryPoint: 'index.js',
    config: {}, status: 'draft', downloads: 0, rating: 0, revenue: 0,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

describe('PluginMarketplaceEngine', () => {
  let engine: ReturnType<typeof getPluginMarketplaceEngine>;

  beforeEach(() => {
    delete (globalThis as any).__pluginMarketplaceEngine__;
    engine = getPluginMarketplaceEngine();
  });

  it('registerPlugin registers and returns plugin with status draft', () => {
    const result = engine.registerPlugin(makePlugin());
    expect(result.id).toBe('p1');
    expect(result.status).toBe('draft');
    expect(result.downloads).toBe(0);
  });

  it('registerPlugin throws on duplicate id', () => {
    engine.registerPlugin(makePlugin());
    expect(() => engine.registerPlugin(makePlugin())).toThrow('already registered');
  });

  it('validatePlugin validates a registered plugin', () => {
    engine.registerPlugin(makePlugin());
    const result = engine.validatePlugin('p1');
    expect(result.valid).toBe(true);
    expect(result.securityScore).toBeGreaterThan(0);
    expect(result.performanceScore).toBeGreaterThan(0);
  });

  it('publishPlugin changes status to published', () => {
    engine.registerPlugin(makePlugin());
    const published = engine.publishPlugin('p1');
    expect(published.status).toBe('published');
  });

  it('installPlugin installs for a tenant', () => {
    engine.registerPlugin(makePlugin());
    engine.publishPlugin('p1');
    const inst = engine.installPlugin('p1', 'tenant1');
    expect(inst.pluginId).toBe('p1');
    expect(inst.tenantId).toBe('tenant1');
    expect(inst.status).toBe('installed');
  });

  it('uninstallPlugin removes installation', () => {
    engine.registerPlugin(makePlugin());
    engine.publishPlugin('p1');
    engine.installPlugin('p1', 'tenant1');
    engine.uninstallPlugin('p1', 'tenant1');
    expect(engine.getInstalledPlugins('tenant1')).toHaveLength(0);
  });

  it('searchPlugins finds plugins by query text', () => {
    engine.registerPlugin(makePlugin());
    engine.publishPlugin('p1');
    const result = engine.searchPlugins({ query: 'TestPlugin' });
    expect(result.plugins).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('addReview and getPluginReviews work correctly', () => {
    engine.registerPlugin(makePlugin());
    const review: PluginReview = {
      pluginId: 'p1', userId: 'u1', rating: 4,
      comment: 'Good plugin', timestamp: new Date(),
    };
    engine.addReview(review);
    const reviews = engine.getPluginReviews('p1');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].rating).toBe(4);
  });

  it('resolveDependencies returns correct order', () => {
    engine.registerPlugin(makePlugin({ id: 'dep1', name: 'DepPlugin', dependencies: [] }));
    engine.registerPlugin(makePlugin({ id: 'p2', name: 'MainPlugin', dependencies: ['dep1'] }));
    const order = engine.resolveDependencies('p2');
    expect(order).toEqual(['dep1', 'p2']);
  });

  it('getMarketplaceStats returns correct stats', () => {
    engine.registerPlugin(makePlugin());
    const stats = engine.getMarketplaceStats();
    expect(stats.totalPlugins).toBe(1);
    expect(stats.totalInstallations).toBe(0);
    expect(stats.categoryDistribution).toHaveProperty('analytics');
  });

  it('getInstalledPlugins returns tenant plugins', () => {
    engine.registerPlugin(makePlugin());
    engine.publishPlugin('p1');
    engine.installPlugin('p1', 'tenant1');
    const installed = engine.getInstalledPlugins('tenant1');
    expect(installed).toHaveLength(1);
    expect(installed[0].pluginId).toBe('p1');
  });
});
