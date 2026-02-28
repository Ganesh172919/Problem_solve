interface Plugin {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  authorUrl?: string;
  iconUrl?: string;
  category: string;
  tags: string[];
  price: number;
  pricingModel: 'free' | 'one-time' | 'subscription' | 'usage-based';
  downloads: number;
  rating: number;
  ratingCount: number;
  isVerified: boolean;
  isActive: boolean;
  manifest: PluginManifest;
  createdAt: Date;
  updatedAt: Date;
}

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  entryPoint: string;
  permissions: string[];
  dependencies?: Record<string, string>;
  hooks?: Record<string, string>;
  settings?: PluginSetting[];
  apiEndpoints?: PluginEndpoint[];
}

interface PluginSetting {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea';
  defaultValue?: any;
  required?: boolean;
  options?: Array<{ label: string; value: any }>;
}

interface PluginEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  handler: string;
  auth?: boolean;
}

interface PluginInstallation {
  id: string;
  pluginId: string;
  userId: string;
  isActive: boolean;
  config: Record<string, any>;
  installedAt: Date;
  updatedAt: Date;
}

interface PluginReview {
  id: string;
  pluginId: string;
  userId: string;
  rating: number;
  title?: string;
  content?: string;
  createdAt: Date;
}

export class PluginMarketplace {
  private plugins: Map<string, Plugin> = new Map();
  private installations: Map<string, PluginInstallation[]> = new Map();
  private reviews: Map<string, PluginReview[]> = new Map();

  /**
   * Register a new plugin
   */
  registerPlugin(plugin: Omit<Plugin, 'id' | 'downloads' | 'rating' | 'ratingCount' | 'createdAt' | 'updatedAt'>): Plugin {
    const id = `plugin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate manifest
    this.validateManifest(plugin.manifest);

    const newPlugin: Plugin = {
      id,
      downloads: 0,
      rating: 0,
      ratingCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...plugin,
    };

    this.plugins.set(id, newPlugin);
    console.log(`Plugin registered: ${newPlugin.name} (${newPlugin.slug})`);

    return newPlugin;
  }

  /**
   * Validate plugin manifest
   */
  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.name || !manifest.version || !manifest.entryPoint) {
      throw new Error('Invalid plugin manifest: missing required fields');
    }

    // Validate version format (semantic versioning)
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(manifest.version)) {
      throw new Error('Invalid version format. Use semantic versioning (e.g., 1.0.0)');
    }

    // Validate permissions
    const validPermissions = [
      'read:posts',
      'write:posts',
      'read:users',
      'read:analytics',
      'write:webhooks',
      'execute:ai',
      'read:config',
      'write:config',
    ];

    for (const permission of manifest.permissions) {
      if (!validPermissions.includes(permission)) {
        throw new Error(`Invalid permission: ${permission}`);
      }
    }
  }

  /**
   * Get plugin by slug
   */
  getPlugin(slug: string): Plugin | null {
    return Array.from(this.plugins.values()).find(p => p.slug === slug) || null;
  }

  /**
   * List plugins with filters
   */
  listPlugins(filters?: {
    category?: string;
    verified?: boolean;
    minRating?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }): Plugin[] {
    let plugins = Array.from(this.plugins.values());

    // Apply filters
    if (filters) {
      if (filters.category) {
        plugins = plugins.filter(p => p.category === filters.category);
      }
      if (filters.verified !== undefined) {
        plugins = plugins.filter(p => p.isVerified === filters.verified);
      }
      if (filters.minRating) {
        plugins = plugins.filter(p => p.rating >= (filters.minRating ?? 0));
      }
      if (filters.search) {
        const search = filters.search.toLowerCase();
        plugins = plugins.filter(
          p =>
            p.name.toLowerCase().includes(search) ||
            p.description.toLowerCase().includes(search) ||
            p.tags.some(t => t.toLowerCase().includes(search))
        );
      }
    }

    // Sort by rating and downloads
    plugins.sort((a, b) => {
      const scoreA = a.rating * 0.7 + Math.log(a.downloads + 1) * 0.3;
      const scoreB = b.rating * 0.7 + Math.log(b.downloads + 1) * 0.3;
      return scoreB - scoreA;
    });

    // Apply pagination
    if (filters?.offset) {
      plugins = plugins.slice(filters.offset);
    }
    if (filters?.limit) {
      plugins = plugins.slice(0, filters.limit);
    }

    return plugins;
  }

  /**
   * Install plugin for user
   */
  installPlugin(
    userId: string,
    pluginId: string,
    config: Record<string, any> = {}
  ): PluginInstallation {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin not found');
    }

    if (!plugin.isActive) {
      throw new Error('Plugin is not active');
    }

    // Check if already installed
    const userInstallations = this.installations.get(userId) || [];
    const existing = userInstallations.find(i => i.pluginId === pluginId);
    if (existing) {
      throw new Error('Plugin already installed');
    }

    // Validate config against plugin settings
    if (plugin.manifest.settings) {
      for (const setting of plugin.manifest.settings) {
        if (setting.required && config[setting.key] === undefined) {
          throw new Error(`Required setting missing: ${setting.key}`);
        }
      }
    }

    const installation: PluginInstallation = {
      id: `install_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pluginId,
      userId,
      isActive: true,
      config,
      installedAt: new Date(),
      updatedAt: new Date(),
    };

    userInstallations.push(installation);
    this.installations.set(userId, userInstallations);

    // Increment download count
    plugin.downloads++;

    console.log(`Plugin installed: ${plugin.name} for user ${userId}`);
    return installation;
  }

  /**
   * Uninstall plugin
   */
  uninstallPlugin(userId: string, pluginId: string): boolean {
    const userInstallations = this.installations.get(userId) || [];
    const index = userInstallations.findIndex(i => i.pluginId === pluginId);

    if (index === -1) {
      return false;
    }

    userInstallations.splice(index, 1);
    this.installations.set(userId, userInstallations);

    return true;
  }

  /**
   * Get user's installed plugins
   */
  getUserPlugins(userId: string): Array<Plugin & { installation: PluginInstallation }> {
    const userInstallations = this.installations.get(userId) || [];

    return userInstallations
      .map(installation => {
        const plugin = this.plugins.get(installation.pluginId);
        if (!plugin) return null;

        return {
          ...plugin,
          installation,
        };
      })
      .filter(p => p !== null) as Array<Plugin & { installation: PluginInstallation }>;
  }

  /**
   * Update plugin configuration
   */
  updatePluginConfig(
    userId: string,
    pluginId: string,
    config: Record<string, any>
  ): PluginInstallation | null {
    const userInstallations = this.installations.get(userId) || [];
    const installation = userInstallations.find(i => i.pluginId === pluginId);

    if (!installation) {
      return null;
    }

    installation.config = { ...installation.config, ...config };
    installation.updatedAt = new Date();

    return installation;
  }

  /**
   * Add plugin review
   */
  addReview(
    pluginId: string,
    userId: string,
    rating: number,
    title?: string,
    content?: string
  ): PluginReview {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error('Plugin not found');
    }

    const review: PluginReview = {
      id: `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pluginId,
      userId,
      rating,
      title,
      content,
      createdAt: new Date(),
    };

    const pluginReviews = this.reviews.get(pluginId) || [];

    // Check if user already reviewed
    const existingIndex = pluginReviews.findIndex(r => r.userId === userId);
    if (existingIndex !== -1) {
      // Update existing review
      pluginReviews[existingIndex] = review;
    } else {
      pluginReviews.push(review);
    }

    this.reviews.set(pluginId, pluginReviews);

    // Update plugin rating
    this.updatePluginRating(pluginId);

    return review;
  }

  /**
   * Update plugin average rating
   */
  private updatePluginRating(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    const reviews = this.reviews.get(pluginId) || [];

    if (!plugin || reviews.length === 0) {
      return;
    }

    const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
    plugin.rating = totalRating / reviews.length;
    plugin.ratingCount = reviews.length;
  }

  /**
   * Get plugin reviews
   */
  getPluginReviews(pluginId: string): PluginReview[] {
    return this.reviews.get(pluginId) || [];
  }

  /**
   * Get trending plugins
   */
  getTrendingPlugins(limit: number = 10): Plugin[] {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    return Array.from(this.plugins.values())
      .filter(p => p.createdAt.getTime() > thirtyDaysAgo)
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  /**
   * Get recommended plugins for user
   */
  getRecommendedPlugins(userId: string, limit: number = 5): Plugin[] {
    const installed = this.getUserPlugins(userId);
    const installedCategories = new Set(installed.map(p => p.category));

    // Recommend plugins in same categories
    return Array.from(this.plugins.values())
      .filter(
        p =>
          installedCategories.has(p.category) &&
          !installed.some(i => i.id === p.id) &&
          p.isActive
      )
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);
  }

  /**
   * Execute plugin hook
   */
  async executePluginHook(
    userId: string,
    hookName: string,
    context: any
  ): Promise<any[]> {
    const userPlugins = this.getUserPlugins(userId).filter(p => p.isActive);
    const results: any[] = [];

    for (const { manifest, installation } of userPlugins) {
      if (manifest.hooks && manifest.hooks[hookName]) {
        try {
          // In a real implementation, this would dynamically load and execute the plugin code
          console.log(`Executing hook ${hookName} for plugin with config:`, installation.config);
          // const result = await executePluginCode(manifest.hooks[hookName], context, installation.config);
          // results.push(result);
        } catch (error) {
          console.error(`Error executing plugin hook ${hookName}:`, error);
        }
      }
    }

    return results;
  }

  /**
   * Get marketplace statistics
   */
  getMarketplaceStats() {
    const plugins = Array.from(this.plugins.values());
    const totalDownloads = plugins.reduce((sum, p) => sum + p.downloads, 0);
    const totalReviews = Array.from(this.reviews.values()).reduce(
      (sum, reviews) => sum + reviews.length,
      0
    );

    return {
      totalPlugins: plugins.length,
      verifiedPlugins: plugins.filter(p => p.isVerified).length,
      totalDownloads,
      totalReviews,
      averageRating:
        plugins.reduce((sum, p) => sum + p.rating, 0) / plugins.length || 0,
      categories: Array.from(new Set(plugins.map(p => p.category))),
    };
  }
}

// Singleton instance
let marketplaceInstance: PluginMarketplace | null = null;

export function getPluginMarketplace(): PluginMarketplace {
  if (!marketplaceInstance) {
    marketplaceInstance = new PluginMarketplace();
  }
  return marketplaceInstance;
}

export type { Plugin, PluginManifest, PluginInstallation, PluginReview };
