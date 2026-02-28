/**
 * Marketplace API — v2
 *
 * GET  /api/v2/marketplace  — List marketplace items with filtering
 * POST /api/v2/marketplace  — Submit a new marketplace listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getMarketplaceOrchestrator, {
  type ListingCategory,
  type ListingStatus,
  type PricingModel,
  type MarketplaceListing,
  type PricingConfig,
  type AppVersion,
} from '../../../../lib/marketplaceOrchestrator';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger();
const cache = getCache();

// ── Types ─────────────────────────────────────────────────────────────────────

interface ListQueryParams {
  category?: string;
  status?: string;
  pricingModel?: string;
  search?: string;
  featured?: string;
  page?: string;
  perPage?: string;
  sortBy?: 'installs' | 'rating' | 'newest' | 'name';
}

interface SubmitListingBody {
  name: string;
  tagline: string;
  description: string;
  longDescription?: string;
  category: ListingCategory;
  tags?: string[];
  developerName: string;
  pricingModel: PricingModel;
  priceUsd?: number;
  websiteUrl?: string;
  documentationUrl?: string;
  supportUrl?: string;
  privacyPolicyUrl?: string;
  repositoryUrl?: string;
  permissions?: string[];
  version?: string;
  changelog?: string;
  screenshots?: string[];
  iconUrl?: string;
}

interface ListingsResponse {
  success: boolean;
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: ListingItem[];
  facets: {
    categories: Array<{ value: string; count: number }>;
    pricingModels: Array<{ value: string; count: number }>;
  };
  metadata: {
    cachedAt?: string;
    responseTimeMs?: number;
  };
}

interface ListingItem {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  category: ListingCategory;
  tags: string[];
  developerName: string;
  status: ListingStatus;
  pricing: {
    model: PricingModel;
    basePrice?: number;
    currency: string;
  };
  latestVersion: string;
  rating?: number;
  ratingCount?: number;
  installCount?: number;
  featured: boolean;
  iconUrl?: string;
  websiteUrl?: string;
  permissions: string[];
  publishedAt?: string;
}

interface SubmitListingResponse {
  success: boolean;
  listingId: string;
  slug: string;
  status: ListingStatus;
  message: string;
  reviewEstimateHours: number;
  submittedAt: string;
}

// ── GET /api/v2/marketplace ───────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const params: ListQueryParams = {
      category: searchParams.get('category') ?? undefined,
      status: searchParams.get('status') ?? 'published',
      pricingModel: searchParams.get('pricingModel') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      featured: searchParams.get('featured') ?? undefined,
      page: searchParams.get('page') ?? '1',
      perPage: searchParams.get('perPage') ?? '20',
      sortBy: (searchParams.get('sortBy') ?? 'installs') as ListQueryParams['sortBy'],
    };

    const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(params.perPage ?? '20', 10) || 20));

    const cacheKey = `api:v2:marketplace:list:${JSON.stringify(params)}`;
    const cached = await cache.get<ListingsResponse>(cacheKey);
    if (cached) {
      logger.debug('Returning cached marketplace listings', { category: params.category, search: params.search });
      return NextResponse.json(cached, {
        headers: { 'X-Cache': 'HIT', 'X-Response-Time': `${Date.now() - startMs}ms` },
      });
    }

    const orchestrator = getMarketplaceOrchestrator();

    const VALID_STATUSES: ListingStatus[] = ['draft', 'review', 'published', 'suspended', 'deprecated', 'delisted'];
    const statusParam = VALID_STATUSES.includes(params.status as ListingStatus) ? (params.status as ListingStatus) : 'published';

    const searchResult = orchestrator.search({
      term: params.search,
      category: params.category as ListingCategory | undefined,
      pricingModel: params.pricingModel as PricingModel | undefined,
      featured: params.featured === 'true' ? true : params.featured === 'false' ? false : undefined,
      page,
      perPage,
      sortBy: params.sortBy === 'newest' ? 'newest'
        : params.sortBy === 'rating' ? 'rating'
        : params.sortBy === 'installs' ? 'installs'
        : 'relevance',
    });

    const items: ListingItem[] = searchResult.listings.map(listing => toListingItem(listing));

    const categoryFacets = buildCategoryFacets(searchResult.facets?.categories ?? {});
    const pricingFacets = buildPricingFacets(searchResult.facets?.pricingModels ?? {});

    const response: ListingsResponse = {
      success: true,
      total: searchResult.total,
      page,
      perPage,
      hasMore: page * perPage < searchResult.total,
      items,
      facets: {
        categories: categoryFacets,
        pricingModels: pricingFacets,
      },
      metadata: {
        responseTimeMs: Date.now() - startMs,
      },
    };

    await cache.set(cacheKey, response, 300); // cache 5 minutes
    logger.info('Marketplace listing GET complete', { total: searchResult.total, page, durationMs: Date.now() - startMs });

    return NextResponse.json(response, {
      headers: { 'X-Cache': 'MISS', 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error('Marketplace GET error', undefined, { error, durationMs: Date.now() - startMs });
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve marketplace listings', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── POST /api/v2/marketplace ──────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    let body: SubmitListingBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const validationError = validateListingBody(body);
    if (validationError) {
      return NextResponse.json(
        { success: false, error: validationError },
        { status: 400 },
      );
    }

    const orchestrator = getMarketplaceOrchestrator();

    const listingId = uuidv4();
    const slug = generateSlug(body.name);
    const now = new Date();

    const initialVersion: AppVersion = {
      version: body.version ?? '1.0.0',
      releasedAt: now,
      releaseNotes: body.changelog ?? 'Initial release',
      checksum: '',
      deprecated: false,
      downloadCount: 0,
    };

    const pricing: PricingConfig = {
      model: body.pricingModel,
      basePrice: body.priceUsd ?? 0,
      currency: 'USD',
      tiers: [],
      trialDays: body.pricingModel === 'freemium' ? 14 : undefined,
    };

    const listing: MarketplaceListing = {
      id: listingId,
      name: body.name,
      slug,
      tagline: body.tagline,
      description: body.description,
      longDescription: body.longDescription ?? body.description,
      category: body.category,
      tags: body.tags ?? [],
      developerId: `dev_${uuidv4()}`,
      developerName: body.developerName,
      status: 'review',
      pricing,
      latestVersion: initialVersion.version,
      versions: [initialVersion],
      screenshots: body.screenshots ?? [],
      iconUrl: body.iconUrl,
      websiteUrl: body.websiteUrl,
      documentationUrl: body.documentationUrl,
      supportUrl: body.supportUrl,
      privacyPolicyUrl: body.privacyPolicyUrl,
      repositoryUrl: body.repositoryUrl,
      permissions: body.permissions ?? [],
      dependencies: [],
      featured: false,
      featuredOrder: undefined,
      publishedAt: undefined,
      createdAt: now,
      updatedAt: now,
      stats: {
        totalInstalls: 0,
        activeInstalls: 0,
        totalDownloads: 0,
        avgRating: 0,
        reviewCount: 0,
        weeklyInstalls: 0,
        monthlyActiveUsers: 0,
        revenue: 0,
      },
      securityScan: {
        status: 'pending',
        scannedAt: now,
        issues: [],
        score: 0,
      },
    };

    orchestrator.createListing(listing);

    const response: SubmitListingResponse = {
      success: true,
      listingId,
      slug,
      status: 'review',
      message: 'Your listing has been submitted for review. Our team will review it within 1-3 business days.',
      reviewEstimateHours: 48,
      submittedAt: now.toISOString(),
    };

    logger.info('Marketplace listing submitted', { listingId, slug, developerName: body.developerName, durationMs: Date.now() - startMs });

    return NextResponse.json(response, {
      status: 201,
      headers: { 'X-Response-Time': `${Date.now() - startMs}ms` },
    });
  } catch (error) {
    logger.error('Marketplace POST error', undefined, { error, durationMs: Date.now() - startMs });
    return NextResponse.json(
      { success: false, error: 'Failed to submit marketplace listing', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toListingItem(listing: MarketplaceListing): ListingItem {
  return {
    id: listing.id,
    name: listing.name,
    slug: listing.slug,
    tagline: listing.tagline,
    category: listing.category,
    tags: listing.tags,
    developerName: listing.developerName,
    status: listing.status,
    pricing: {
      model: listing.pricing.model,
      basePrice: listing.pricing.basePrice,
      currency: listing.pricing.currency,
    },
    latestVersion: listing.latestVersion,
    rating: listing.stats.reviewCount > 0 ? Math.round(listing.stats.avgRating * 10) / 10 : undefined,
    ratingCount: listing.stats.reviewCount,
    installCount: listing.stats.totalInstalls,
    featured: listing.featured,
    iconUrl: listing.iconUrl,
    websiteUrl: listing.websiteUrl,
    permissions: listing.permissions,
    publishedAt: listing.publishedAt?.toISOString(),
  };
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 64);
}

function buildCategoryFacets(categories: Record<string, number>): Array<{ value: string; count: number }> {
  return Object.entries(categories)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function buildPricingFacets(pricingModels: Record<string, number>): Array<{ value: string; count: number }> {
  return Object.entries(pricingModels)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

const VALID_CATEGORIES: ListingCategory[] = [
  'analytics', 'automation', 'content', 'crm', 'communication',
  'developer-tools', 'finance', 'marketing', 'productivity',
  'security', 'social', 'storage', 'other',
];

const VALID_PRICING_MODELS: PricingModel[] = ['free', 'one-time', 'monthly', 'usage-based', 'freemium'];

function validateListingBody(body: SubmitListingBody): string | null {
  if (!body.name || body.name.trim().length < 3) return 'name is required and must be at least 3 characters';
  if (!body.tagline || body.tagline.trim().length < 10) return 'tagline is required and must be at least 10 characters';
  if (!body.description || body.description.trim().length < 20) return 'description is required and must be at least 20 characters';
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) return `category must be one of: ${VALID_CATEGORIES.join(', ')}`;
  if (!body.developerName || body.developerName.trim().length < 2) return 'developerName is required';
  if (!body.pricingModel || !VALID_PRICING_MODELS.includes(body.pricingModel)) return `pricingModel must be one of: ${VALID_PRICING_MODELS.join(', ')}`;
  if (body.priceUsd !== undefined && body.priceUsd < 0) return 'priceUsd must be non-negative';
  if (body.name.length > 80) return 'name must be 80 characters or less';
  if (body.tagline.length > 160) return 'tagline must be 160 characters or less';
  return null;
}
