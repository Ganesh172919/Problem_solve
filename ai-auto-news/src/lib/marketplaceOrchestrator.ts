/**
 * Marketplace Orchestrator
 *
 * Full marketplace for plugins, integrations, and third-party apps:
 * - Listing management (create, update, publish, delist)
 * - Review and rating system (verified purchases only)
 * - Revenue sharing: 70% developer / 30% platform
 * - Installation tracking and license management
 * - Dependency resolution between apps
 * - Semantic version management and compatibility checking
 * - Security scanning results tracking
 * - Featured placement and editorial curation
 * - Full-text search and category-based discovery
 * - Download and usage analytics per listing
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import crypto from 'crypto';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ListingCategory =
  | 'analytics' | 'automation' | 'content' | 'crm' | 'communication'
  | 'developer-tools' | 'finance' | 'marketing' | 'productivity'
  | 'security' | 'social' | 'storage' | 'other';

export type ListingStatus = 'draft' | 'review' | 'published' | 'suspended' | 'deprecated' | 'delisted';

export type PricingModel = 'free' | 'one-time' | 'monthly' | 'usage-based' | 'freemium';

export type InstallStatus = 'active' | 'inactive' | 'pending' | 'failed' | 'suspended';

export interface MarketplaceListing {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  longDescription: string;
  category: ListingCategory;
  tags: string[];
  developerId: string;
  developerName: string;
  status: ListingStatus;
  pricing: PricingConfig;
  latestVersion: string;
  versions: AppVersion[];
  screenshots: string[];
  iconUrl?: string;
  websiteUrl?: string;
  documentationUrl?: string;
  supportUrl?: string;
  privacyPolicyUrl?: string;
  repositoryUrl?: string;
  permissions: string[];
  dependencies: AppDependency[];
  stats: ListingStats;
  securityScan: SecurityScanResult;
  featured: boolean;
  featuredOrder?: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
}

export interface PricingConfig {
  model: PricingModel;
  basePrice?: number;
  currency: string;
  billingPeriod?: 'monthly' | 'yearly';
  trialDays?: number;
  tiers?: PricingTier[];
  usageMetric?: string;
  pricePerUnit?: number;
}

export interface PricingTier {
  name: string;
  price: number;
  features: string[];
  usageLimit?: number;
}

export interface AppVersion {
  version: string;              // semver
  releaseNotes: string;
  releasedAt: Date;
  minPlatformVersion?: string;
  deprecated: boolean;
  downloadCount: number;
  checksum: string;
}

export interface AppDependency {
  appId: string;
  name: string;
  versionRange: string;         // e.g. ">=1.0.0 <2.0.0"
  optional: boolean;
}

export interface ListingStats {
  totalInstalls: number;
  activeInstalls: number;
  totalDownloads: number;
  avgRating: number;
  reviewCount: number;
  weeklyInstalls: number;
  monthlyActiveUsers: number;
  revenue: number;              // total gross revenue
}

export interface SecurityScanResult {
  scannedAt: Date;
  status: 'pending' | 'passed' | 'warning' | 'failed';
  score: number;               // 0–100
  issues: SecurityIssue[];
  lastPassedAt?: Date;
}

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  description: string;
  remediation?: string;
}

export interface AppInstallation {
  id: string;
  listingId: string;
  tenantId: string;
  userId: string;
  version: string;
  status: InstallStatus;
  installedAt: Date;
  updatedAt: Date;
  config: Record<string, unknown>;
  licenseKey?: string;
  expiresAt?: Date;
  usageStats: InstallUsageStats;
}

export interface InstallUsageStats {
  apiCalls: number;
  lastActiveAt: Date | null;
  totalSessionMinutes: number;
  eventsProcessed: number;
}

export interface AppReview {
  id: string;
  listingId: string;
  reviewerId: string;
  reviewerName: string;
  rating: number;              // 1–5
  title: string;
  body: string;
  verified: boolean;           // verified purchase
  helpful: number;             // upvotes
  developerResponse?: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'published' | 'removed' | 'pending';
}

export interface RevenueShare {
  installationId: string;
  listingId: string;
  developerId: string;
  grossAmount: number;
  platformFee: number;          // 30%
  developerShare: number;       // 70%
  currency: string;
  period: string;               // 'YYYY-MM'
  status: 'pending' | 'processed' | 'paid' | 'disputed';
  createdAt: Date;
  paidAt?: Date;
}

export interface SearchQuery {
  term?: string;
  category?: ListingCategory;
  tags?: string[];
  minRating?: number;
  pricingModel?: PricingModel;
  featured?: boolean;
  sortBy?: 'relevance' | 'installs' | 'rating' | 'newest' | 'price';
  page?: number;
  perPage?: number;
}

export interface SearchResult {
  listings: MarketplaceListing[];
  total: number;
  page: number;
  perPage: number;
  facets: SearchFacets;
}

export interface SearchFacets {
  categories: Record<ListingCategory, number>;
  pricingModels: Record<PricingModel, number>;
  avgRatings: number[];
}

export interface MarketplaceStats {
  totalListings: number;
  publishedListings: number;
  featuredListings: number;
  totalInstalls: number;
  totalRevenue: number;
  totalDevelopers: number;
  avgRating: number;
  topCategories: { category: ListingCategory; count: number }[];
}

// ── Semver helpers ─────────────────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^[^0-9]*/, '');
  const parts = clean.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function semverCompare(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

function satisfiesVersionRange(version: string, range: string): boolean {
  // Support simple ">= X.X.X" and "< X.X.X" patterns
  const parts = range.split(/\s+/).filter(Boolean);
  for (const constraint of parts) {
    const op = constraint.match(/^([><=!]+)/)?.[1] ?? '=';
    const ver = constraint.replace(/^[><=!]+/, '');
    const cmp = semverCompare(version, ver);
    if (op === '>=' && cmp < 0) return false;
    if (op === '>' && cmp <= 0) return false;
    if (op === '<=' && cmp > 0) return false;
    if (op === '<' && cmp >= 0) return false;
    if (op === '=' && cmp !== 0) return false;
  }
  return true;
}

// ── MarketplaceOrchestrator ───────────────────────────────────────────────────

class MarketplaceOrchestrator {
  private listings: Map<string, MarketplaceListing> = new Map();
  private slugIndex: Map<string, string> = new Map();             // slug → id
  private installations: Map<string, AppInstallation> = new Map();
  private installsByTenant: Map<string, string[]> = new Map();    // tenantId → installIds
  private installsByListing: Map<string, string[]> = new Map();   // listingId → installIds
  private reviews: Map<string, AppReview[]> = new Map();          // listingId → reviews
  private revenueShares: RevenueShare[] = [];

  private readonly PLATFORM_FEE = 0.30;
  private readonly DEVELOPER_SHARE = 0.70;

  // ── Listing Management ─────────────────────────────────────────────────────

  createListing(listing: MarketplaceListing): void {
    if (this.slugIndex.has(listing.slug)) {
      throw new Error(`Slug '${listing.slug}' already taken`);
    }
    this.listings.set(listing.id, listing);
    this.slugIndex.set(listing.slug, listing.id);
    logger.info('Marketplace listing created', { listingId: listing.id, name: listing.name, developer: listing.developerId });
  }

  updateListing(listingId: string, updates: Partial<MarketplaceListing>): MarketplaceListing {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);

    // Slug change: update index
    if (updates.slug && updates.slug !== listing.slug) {
      this.slugIndex.delete(listing.slug);
      this.slugIndex.set(updates.slug, listingId);
    }

    Object.assign(listing, updates, { updatedAt: new Date() });
    cache.set(`mp:listing:${listingId}`, listing, 3600);
    return listing;
  }

  publishListing(listingId: string): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);
    if (listing.securityScan.status !== 'passed') {
      throw new Error('Cannot publish listing with failed security scan');
    }
    listing.status = 'published';
    listing.publishedAt = new Date();
    listing.updatedAt = new Date();
    logger.info('Listing published', { listingId, name: listing.name });
  }

  delistListing(listingId: string, reason: string): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);
    listing.status = 'delisted';
    listing.updatedAt = new Date();
    logger.warn('Listing delisted', { listingId, reason });
  }

  getListing(listingId: string): MarketplaceListing | null {
    const cached = cache.get<MarketplaceListing>(`mp:listing:${listingId}`);
    if (cached) return cached;
    const listing = this.listings.get(listingId) ?? null;
    if (listing) cache.set(`mp:listing:${listingId}`, listing, 3600);
    return listing;
  }

  getListingBySlug(slug: string): MarketplaceListing | null {
    const id = this.slugIndex.get(slug);
    return id ? this.getListing(id) : null;
  }

  // ── Version Management ─────────────────────────────────────────────────────

  publishVersion(listingId: string, version: AppVersion): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);

    // Prevent duplicate versions
    if (listing.versions.find((v) => v.version === version.version)) {
      throw new Error(`Version ${version.version} already exists for listing ${listingId}`);
    }

    listing.versions.push(version);
    listing.versions.sort((a, b) => semverCompare(b.version, a.version));
    listing.latestVersion = listing.versions[0].version;
    listing.updatedAt = new Date();

    logger.info('Version published', { listingId, version: version.version });
  }

  deprecateVersion(listingId: string, version: string): void {
    const listing = this.listings.get(listingId);
    const v = listing?.versions.find((v) => v.version === version);
    if (v) {
      v.deprecated = true;
      logger.info('Version deprecated', { listingId, version });
    }
  }

  getLatestCompatibleVersion(listingId: string, platformVersion?: string): AppVersion | null {
    const listing = this.listings.get(listingId);
    if (!listing) return null;
    for (const v of listing.versions) {
      if (v.deprecated) continue;
      if (platformVersion && v.minPlatformVersion) {
        if (semverCompare(platformVersion, v.minPlatformVersion) < 0) continue;
      }
      return v;
    }
    return null;
  }

  // ── Dependency Resolution ──────────────────────────────────────────────────

  resolveDependencies(listingId: string, installVersions?: Record<string, string>): {
    resolved: Record<string, string>;
    missing: string[];
    conflicts: string[];
  } {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);

    const resolved: Record<string, string> = {};
    const missing: string[] = [];
    const conflicts: string[] = [];

    for (const dep of listing.dependencies) {
      const depListing = this.listings.get(dep.appId);
      if (!depListing) {
        if (!dep.optional) missing.push(dep.appId);
        continue;
      }

      const installedVersion = installVersions?.[dep.appId];
      if (installedVersion) {
        if (!satisfiesVersionRange(installedVersion, dep.versionRange)) {
          conflicts.push(`${dep.name}: installed ${installedVersion} does not satisfy ${dep.versionRange}`);
        } else {
          resolved[dep.appId] = installedVersion;
        }
      } else {
        // Find a compatible version
        const compatible = depListing.versions.find(
          (v) => !v.deprecated && satisfiesVersionRange(v.version, dep.versionRange),
        );
        if (compatible) {
          resolved[dep.appId] = compatible.version;
        } else if (!dep.optional) {
          missing.push(`${dep.name} (${dep.versionRange})`);
        }
      }
    }

    return { resolved, missing, conflicts };
  }

  // ── Installation ───────────────────────────────────────────────────────────

  install(listingId: string, tenantId: string, userId: string, version?: string): AppInstallation {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);
    if (listing.status !== 'published') throw new Error(`Listing ${listingId} is not published`);

    // Resolve version
    const targetVersion = version ?? listing.latestVersion;
    const versionRecord = listing.versions.find((v) => v.version === targetVersion);
    if (!versionRecord) throw new Error(`Version ${targetVersion} not found`);

    // Check deps
    const deps = this.resolveDependencies(listingId);
    if (deps.missing.length > 0) {
      throw new Error(`Missing required dependencies: ${deps.missing.join(', ')}`);
    }

    const installation: AppInstallation = {
      id: crypto.randomUUID(),
      listingId,
      tenantId,
      userId,
      version: targetVersion,
      status: 'active',
      installedAt: new Date(),
      updatedAt: new Date(),
      config: {},
      usageStats: {
        apiCalls: 0,
        lastActiveAt: null,
        totalSessionMinutes: 0,
        eventsProcessed: 0,
      },
    };

    this.installations.set(installation.id, installation);

    const byTenant = this.installsByTenant.get(tenantId) ?? [];
    byTenant.push(installation.id);
    this.installsByTenant.set(tenantId, byTenant);

    const byListing = this.installsByListing.get(listingId) ?? [];
    byListing.push(installation.id);
    this.installsByListing.set(listingId, byListing);

    // Update stats
    listing.stats.totalInstalls++;
    listing.stats.activeInstalls++;
    versionRecord.downloadCount++;

    logger.info('App installed', { listingId, tenantId, version: targetVersion, installationId: installation.id });
    return installation;
  }

  uninstall(installationId: string): void {
    const install = this.installations.get(installationId);
    if (!install) throw new Error(`Installation ${installationId} not found`);
    install.status = 'inactive';
    install.updatedAt = new Date();
    const listing = this.listings.get(install.listingId);
    if (listing) listing.stats.activeInstalls = Math.max(0, listing.stats.activeInstalls - 1);
    logger.info('App uninstalled', { installationId, listingId: install.listingId });
  }

  getInstallation(installationId: string): AppInstallation | null {
    return this.installations.get(installationId) ?? null;
  }

  getTenantInstallations(tenantId: string): AppInstallation[] {
    const ids = this.installsByTenant.get(tenantId) ?? [];
    return ids.map((id) => this.installations.get(id)).filter(Boolean) as AppInstallation[];
  }

  updateInstallConfig(installationId: string, config: Record<string, unknown>): void {
    const install = this.installations.get(installationId);
    if (!install) throw new Error(`Installation ${installationId} not found`);
    install.config = { ...install.config, ...config };
    install.updatedAt = new Date();
  }

  // ── Usage Tracking ─────────────────────────────────────────────────────────

  recordUsage(installationId: string, apiCalls: number, sessionMinutes: number, events: number): void {
    const install = this.installations.get(installationId);
    if (!install || install.status !== 'active') return;
    install.usageStats.apiCalls += apiCalls;
    install.usageStats.totalSessionMinutes += sessionMinutes;
    install.usageStats.eventsProcessed += events;
    install.usageStats.lastActiveAt = new Date();

    const listing = this.listings.get(install.listingId);
    if (listing) listing.stats.monthlyActiveUsers = this.countMonthlyActiveUsers(install.listingId);
  }

  private countMonthlyActiveUsers(listingId: string): number {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const ids = this.installsByListing.get(listingId) ?? [];
    return ids.filter((id) => {
      const inst = this.installations.get(id);
      return inst?.status === 'active' && inst.usageStats.lastActiveAt && inst.usageStats.lastActiveAt > cutoff;
    }).length;
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  submitReview(review: AppReview): void {
    const listing = this.listings.get(review.listingId);
    if (!listing) throw new Error(`Listing ${review.listingId} not found`);

    // Verified purchase check
    if (review.verified) {
      const hasInstall = (this.installsByListing.get(review.listingId) ?? []).some((id) => {
        const inst = this.installations.get(id);
        return inst?.tenantId === review.reviewerId || inst?.userId === review.reviewerId;
      });
      if (!hasInstall) review.verified = false;
    }

    const all = this.reviews.get(review.listingId) ?? [];
    all.push(review);
    this.reviews.set(review.listingId, all);

    this.recomputeRating(review.listingId);
    logger.info('Review submitted', { listingId: review.listingId, rating: review.rating, verified: review.verified });
  }

  private recomputeRating(listingId: string): void {
    const all = (this.reviews.get(listingId) ?? []).filter((r) => r.status === 'published');
    const listing = this.listings.get(listingId);
    if (!listing || all.length === 0) return;
    listing.stats.avgRating = all.reduce((s, r) => s + r.rating, 0) / all.length;
    listing.stats.reviewCount = all.length;
  }

  getReviews(listingId: string, page = 1, perPage = 10): { reviews: AppReview[]; total: number } {
    const all = (this.reviews.get(listingId) ?? []).filter((r) => r.status === 'published');
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      reviews: all.slice((page - 1) * perPage, page * perPage),
      total: all.length,
    };
  }

  respondToReview(reviewId: string, listingId: string, response: string): void {
    const reviews = this.reviews.get(listingId) ?? [];
    const review = reviews.find((r) => r.id === reviewId);
    if (review) {
      review.developerResponse = response;
      review.updatedAt = new Date();
    }
  }

  // ── Revenue Sharing ────────────────────────────────────────────────────────

  processRevenue(installationId: string, grossAmount: number, currency = 'USD'): RevenueShare {
    const install = this.installations.get(installationId);
    if (!install) throw new Error(`Installation ${installationId} not found`);
    const listing = this.listings.get(install.listingId);
    if (!listing) throw new Error(`Listing ${install.listingId} not found`);

    const platformFee = grossAmount * this.PLATFORM_FEE;
    const developerShare = grossAmount * this.DEVELOPER_SHARE;

    const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    const share: RevenueShare = {
      installationId,
      listingId: install.listingId,
      developerId: listing.developerId,
      grossAmount,
      platformFee,
      developerShare,
      currency,
      period,
      status: 'pending',
      createdAt: new Date(),
    };

    this.revenueShares.push(share);
    listing.stats.revenue += grossAmount;

    logger.info('Revenue share recorded', {
      listingId: install.listingId,
      grossAmount,
      developerShare,
      platformFee,
    });
    return share;
  }

  getDeveloperRevenue(developerId: string, period?: string): { gross: number; fee: number; net: number; pending: number } {
    const shares = this.revenueShares.filter(
      (s) => s.developerId === developerId && (!period || s.period === period),
    );
    return {
      gross: shares.reduce((s, r) => s + r.grossAmount, 0),
      fee: shares.reduce((s, r) => s + r.platformFee, 0),
      net: shares.reduce((s, r) => s + r.developerShare, 0),
      pending: shares.filter((r) => r.status === 'pending').reduce((s, r) => s + r.developerShare, 0),
    };
  }

  // ── Featured Placement ─────────────────────────────────────────────────────

  setFeatured(listingId: string, featured: boolean, order?: number): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);
    listing.featured = featured;
    listing.featuredOrder = featured ? (order ?? 99) : undefined;
    listing.updatedAt = new Date();
    cache.set(`mp:listing:${listingId}`, listing, 3600);
    logger.info('Featured placement updated', { listingId, featured, order });
  }

  getFeaturedListings(): MarketplaceListing[] {
    return Array.from(this.listings.values())
      .filter((l) => l.featured && l.status === 'published')
      .sort((a, b) => (a.featuredOrder ?? 99) - (b.featuredOrder ?? 99));
  }

  // ── Search & Discovery ─────────────────────────────────────────────────────

  search(query: SearchQuery): SearchResult {
    const cacheKey = `mp:search:${JSON.stringify(query)}`;
    const cached = cache.get<SearchResult>(cacheKey);
    if (cached) return cached;

    let results = Array.from(this.listings.values()).filter((l) => l.status === 'published');

    if (query.term) {
      const term = query.term.toLowerCase();
      results = results.filter(
        (l) => l.name.toLowerCase().includes(term)
          || l.tagline.toLowerCase().includes(term)
          || l.description.toLowerCase().includes(term)
          || l.tags.some((t) => t.toLowerCase().includes(term)),
      );
    }

    if (query.category) results = results.filter((l) => l.category === query.category);
    if (query.tags?.length) results = results.filter((l) => query.tags!.every((t) => l.tags.includes(t)));
    if (query.minRating) results = results.filter((l) => l.stats.avgRating >= query.minRating!);
    if (query.pricingModel) results = results.filter((l) => l.pricing.model === query.pricingModel);
    if (query.featured !== undefined) results = results.filter((l) => l.featured === query.featured);

    // Sort
    switch (query.sortBy ?? 'relevance') {
      case 'installs': results.sort((a, b) => b.stats.totalInstalls - a.stats.totalInstalls); break;
      case 'rating': results.sort((a, b) => b.stats.avgRating - a.stats.avgRating); break;
      case 'newest': results.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)); break;
      case 'price': results.sort((a, b) => (a.pricing.basePrice ?? 0) - (b.pricing.basePrice ?? 0)); break;
      default: results.sort((a, b) => b.stats.totalInstalls - a.stats.totalInstalls); break;
    }

    const total = results.length;
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const pageResults = results.slice((page - 1) * perPage, page * perPage);

    // Facets
    const catFacets = {} as Record<ListingCategory, number>;
    const priceFacets = {} as Record<PricingModel, number>;
    for (const l of results) {
      catFacets[l.category] = (catFacets[l.category] ?? 0) + 1;
      priceFacets[l.pricing.model] = (priceFacets[l.pricing.model] ?? 0) + 1;
    }

    const result: SearchResult = {
      listings: pageResults,
      total,
      page,
      perPage,
      facets: { categories: catFacets, pricingModels: priceFacets, avgRatings: [] },
    };

    cache.set(cacheKey, result, 300);
    return result;
  }

  // ── Security Scanning ──────────────────────────────────────────────────────

  updateSecurityScan(listingId: string, result: SecurityScanResult): void {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);
    listing.securityScan = result;
    listing.updatedAt = new Date();

    if (result.status === 'failed') {
      if (listing.status === 'published') {
        listing.status = 'suspended';
        logger.error('Listing suspended due to failed security scan', undefined, { listingId, issues: result.issues.length });
      }
    } else if (result.status === 'passed') {
      result.lastPassedAt = new Date();
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getMarketplaceStats(): MarketplaceStats {
    const cacheKey = 'mp:stats';
    const cached = cache.get<MarketplaceStats>(cacheKey);
    if (cached) return cached;

    const published = Array.from(this.listings.values()).filter((l) => l.status === 'published');
    const totalInstalls = published.reduce((s, l) => s + l.stats.totalInstalls, 0);
    const totalRevenue = published.reduce((s, l) => s + l.stats.revenue, 0);
    const totalRating = published.filter((l) => l.stats.reviewCount > 0).reduce((s, l) => s + l.stats.avgRating, 0);
    const ratedCount = published.filter((l) => l.stats.reviewCount > 0).length;

    const catCounts = new Map<ListingCategory, number>();
    for (const l of published) catCounts.set(l.category, (catCounts.get(l.category) ?? 0) + 1);
    const topCategories = Array.from(catCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const developers = new Set(Array.from(this.listings.values()).map((l) => l.developerId));

    const stats: MarketplaceStats = {
      totalListings: this.listings.size,
      publishedListings: published.length,
      featuredListings: published.filter((l) => l.featured).length,
      totalInstalls,
      totalRevenue,
      totalDevelopers: developers.size,
      avgRating: ratedCount > 0 ? totalRating / ratedCount : 0,
      topCategories,
    };

    cache.set(cacheKey, stats, 3600);
    return stats;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__marketplaceOrchestrator__';

export function getMarketplaceOrchestrator(): MarketplaceOrchestrator {
  const g = globalThis as unknown as Record<string, MarketplaceOrchestrator>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new MarketplaceOrchestrator();
  }
  return g[GLOBAL_KEY];
}

export { MarketplaceOrchestrator };
export default getMarketplaceOrchestrator;
