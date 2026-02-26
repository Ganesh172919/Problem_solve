/**
 * API Marketplace
 *
 * Platform for discovering, publishing, subscribing to, and managing
 * APIs with usage tracking, monetization, and developer portal support.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface APIListing {
  id: string;
  name: string;
  version: string;
  description: string;
  category: APICategory;
  publisherId: string;
  endpoints: APIEndpoint[];
  pricing: APIPricing;
  documentation: APIDocumentation;
  status: 'draft' | 'published' | 'deprecated' | 'retired';
  rating: number;
  reviewCount: number;
  subscriberCount: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type APICategory =
  | 'ai_ml'
  | 'data'
  | 'communication'
  | 'analytics'
  | 'security'
  | 'content'
  | 'finance'
  | 'infrastructure'
  | 'integration'
  | 'developer_tools';

export interface APIEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description: string;
  parameters: EndpointParameter[];
  requestBody?: { contentType: string; schema: Record<string, unknown> };
  responses: EndpointResponse[];
  rateLimit: number;
  authenticated: boolean;
}

export interface EndpointParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required: boolean;
  type: string;
  description: string;
}

export interface EndpointResponse {
  status: number;
  description: string;
  schema: Record<string, unknown>;
}

export interface APIPricing {
  model: 'free' | 'freemium' | 'paid' | 'pay_per_call' | 'subscription';
  freeTierLimit?: number;
  plans: APIPlan[];
}

export interface APIPlan {
  id: string;
  name: string;
  callsPerMonth: number;
  pricePerMonth: number;
  pricePerExtraCall: number;
  features: string[];
  sla: string;
}

export interface APIDocumentation {
  overview: string;
  gettingStarted: string;
  authentication: string;
  examples: APIExample[];
  changelog: ChangelogEntry[];
}

export interface APIExample {
  title: string;
  description: string;
  language: string;
  code: string;
  response: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  breaking: boolean;
}

export interface APISubscription {
  id: string;
  apiId: string;
  subscriberId: string;
  planId: string;
  apiKey: string;
  status: 'active' | 'suspended' | 'cancelled' | 'expired';
  callsUsed: number;
  callsLimit: number;
  startDate: number;
  endDate: number;
  autoRenew: boolean;
}

export interface APIReview {
  id: string;
  apiId: string;
  reviewerId: string;
  rating: number;
  title: string;
  content: string;
  helpful: number;
  verified: boolean;
  createdAt: number;
}

export interface APIAnalytics {
  apiId: string;
  period: string;
  totalCalls: number;
  uniqueSubscribers: number;
  avgResponseTimeMs: number;
  errorRate: number;
  revenue: number;
  popularEndpoints: { path: string; calls: number }[];
  geographicDistribution: Record<string, number>;
}

export interface MarketplaceSearch {
  query?: string;
  category?: APICategory;
  pricingModel?: string;
  minRating?: number;
  tags?: string[];
  sortBy?: 'rating' | 'popularity' | 'newest' | 'price_low' | 'price_high';
  page: number;
  pageSize: number;
}

export interface MarketplaceSearchResult {
  listings: APIListing[];
  totalCount: number;
  page: number;
  pageSize: number;
  facets: {
    categories: Record<string, number>;
    pricingModels: Record<string, number>;
    topTags: { tag: string; count: number }[];
  };
}

export class APIMarketplace {
  private listings: Map<string, APIListing> = new Map();
  private subscriptions: Map<string, APISubscription[]> = new Map();
  private reviews: Map<string, APIReview[]> = new Map();
  private analytics: Map<string, APIAnalytics[]> = new Map();
  private apiKeyIndex: Map<string, string> = new Map();

  publishAPI(params: {
    name: string;
    version: string;
    description: string;
    category: APICategory;
    publisherId: string;
    endpoints: APIEndpoint[];
    pricing: APIPricing;
    documentation: APIDocumentation;
    tags: string[];
  }): APIListing {
    const listing: APIListing = {
      id: `api_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      ...params,
      status: 'published',
      rating: 0,
      reviewCount: 0,
      subscriberCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.listings.set(listing.id, listing);
    logger.info('API published', { apiId: listing.id, name: listing.name });
    return listing;
  }

  updateAPI(apiId: string, updates: Partial<APIListing>): APIListing | null {
    const listing = this.listings.get(apiId);
    if (!listing) return null;

    Object.assign(listing, updates, { updatedAt: Date.now() });
    return listing;
  }

  deprecateAPI(apiId: string): boolean {
    const listing = this.listings.get(apiId);
    if (!listing) return false;

    listing.status = 'deprecated';
    listing.updatedAt = Date.now();
    return true;
  }

  subscribe(params: {
    apiId: string;
    subscriberId: string;
    planId: string;
  }): APISubscription | null {
    const listing = this.listings.get(params.apiId);
    if (!listing || listing.status !== 'published') return null;

    const plan = listing.pricing.plans.find((p) => p.id === params.planId);
    if (!plan) return null;

    const apiKeyRaw = `mk_${Date.now()}_${Math.random().toString(36).substring(2, 16)}`;

    const subscription: APISubscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      apiId: params.apiId,
      subscriberId: params.subscriberId,
      planId: params.planId,
      apiKey: apiKeyRaw,
      status: 'active',
      callsUsed: 0,
      callsLimit: plan.callsPerMonth,
      startDate: Date.now(),
      endDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
      autoRenew: true,
    };

    const existing = this.subscriptions.get(params.subscriberId) || [];
    existing.push(subscription);
    this.subscriptions.set(params.subscriberId, existing);

    this.apiKeyIndex.set(apiKeyRaw, subscription.id);

    listing.subscriberCount++;
    listing.updatedAt = Date.now();

    logger.info('API subscription created', {
      subscriptionId: subscription.id,
      apiId: params.apiId,
      subscriberId: params.subscriberId,
    });

    return subscription;
  }

  cancelSubscription(subscriptionId: string, subscriberId: string): boolean {
    const subs = this.subscriptions.get(subscriberId);
    if (!subs) return false;

    const sub = subs.find((s) => s.id === subscriptionId);
    if (!sub) return false;

    sub.status = 'cancelled';
    sub.autoRenew = false;

    const listing = this.listings.get(sub.apiId);
    if (listing) {
      listing.subscriberCount = Math.max(0, listing.subscriberCount - 1);
    }

    return true;
  }

  recordAPICall(apiKey: string): { allowed: boolean; remaining: number } | null {
    const subscriptionId = this.apiKeyIndex.get(apiKey);
    if (!subscriptionId) return null;

    for (const subs of this.subscriptions.values()) {
      const sub = subs.find((s) => s.id === subscriptionId);
      if (sub) {
        if (sub.status !== 'active') {
          return { allowed: false, remaining: 0 };
        }

        if (sub.callsUsed >= sub.callsLimit) {
          return { allowed: false, remaining: 0 };
        }

        sub.callsUsed++;
        return { allowed: true, remaining: sub.callsLimit - sub.callsUsed };
      }
    }

    return null;
  }

  addReview(params: {
    apiId: string;
    reviewerId: string;
    rating: number;
    title: string;
    content: string;
  }): APIReview | null {
    const listing = this.listings.get(params.apiId);
    if (!listing) return null;

    const rating = Math.max(1, Math.min(5, params.rating));
    const review: APIReview = {
      id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      apiId: params.apiId,
      reviewerId: params.reviewerId,
      rating,
      title: params.title,
      content: params.content,
      helpful: 0,
      verified: false,
      createdAt: Date.now(),
    };

    const existing = this.reviews.get(params.apiId) || [];
    existing.push(review);
    this.reviews.set(params.apiId, existing);

    listing.reviewCount = existing.length;
    listing.rating =
      existing.reduce((sum, r) => sum + r.rating, 0) / existing.length;
    listing.updatedAt = Date.now();

    return review;
  }

  search(query: MarketplaceSearch): MarketplaceSearchResult {
    let results = Array.from(this.listings.values()).filter(
      (l) => l.status === 'published',
    );

    if (query.query) {
      const lowerQuery = query.query.toLowerCase();
      results = results.filter(
        (l) =>
          l.name.toLowerCase().includes(lowerQuery) ||
          l.description.toLowerCase().includes(lowerQuery) ||
          l.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
      );
    }

    if (query.category) {
      results = results.filter((l) => l.category === query.category);
    }

    if (query.pricingModel) {
      results = results.filter((l) => l.pricing.model === query.pricingModel);
    }

    if (query.minRating) {
      results = results.filter((l) => l.rating >= query.minRating!);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((l) => query.tags!.some((t) => l.tags.includes(t)));
    }

    switch (query.sortBy) {
      case 'rating':
        results.sort((a, b) => b.rating - a.rating);
        break;
      case 'popularity':
        results.sort((a, b) => b.subscriberCount - a.subscriberCount);
        break;
      case 'newest':
        results.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'price_low':
        results.sort((a, b) => {
          const aMin = Math.min(...a.pricing.plans.map((p) => p.pricePerMonth), Infinity);
          const bMin = Math.min(...b.pricing.plans.map((p) => p.pricePerMonth), Infinity);
          return aMin - bMin;
        });
        break;
      case 'price_high':
        results.sort((a, b) => {
          const aMax = Math.max(...a.pricing.plans.map((p) => p.pricePerMonth), 0);
          const bMax = Math.max(...b.pricing.plans.map((p) => p.pricePerMonth), 0);
          return bMax - aMax;
        });
        break;
    }

    const categories: Record<string, number> = {};
    const pricingModels: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};

    for (const listing of results) {
      categories[listing.category] = (categories[listing.category] || 0) + 1;
      pricingModels[listing.pricing.model] = (pricingModels[listing.pricing.model] || 0) + 1;
      for (const tag of listing.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const totalCount = results.length;
    const start = (query.page - 1) * query.pageSize;
    const pageResults = results.slice(start, start + query.pageSize);

    return {
      listings: pageResults,
      totalCount,
      page: query.page,
      pageSize: query.pageSize,
      facets: { categories, pricingModels, topTags },
    };
  }

  getAPIDetails(apiId: string): {
    listing: APIListing;
    reviews: APIReview[];
    recentAnalytics: APIAnalytics | null;
  } | null {
    const listing = this.listings.get(apiId);
    if (!listing) return null;

    const reviews = this.reviews.get(apiId) || [];
    const analyticsHistory = this.analytics.get(apiId) || [];
    const recentAnalytics = analyticsHistory.length > 0 ? analyticsHistory[analyticsHistory.length - 1] : null;

    return { listing, reviews, recentAnalytics };
  }

  getSubscriptions(subscriberId: string): APISubscription[] {
    return this.subscriptions.get(subscriberId) || [];
  }

  getPublisherAPIs(publisherId: string): APIListing[] {
    return Array.from(this.listings.values()).filter((l) => l.publisherId === publisherId);
  }

  getFeaturedAPIs(limit: number = 10): APIListing[] {
    return Array.from(this.listings.values())
      .filter((l) => l.status === 'published')
      .sort((a, b) => b.rating * b.subscriberCount - a.rating * a.subscriberCount)
      .slice(0, limit);
  }

  getCategoryStats(): Record<APICategory, { count: number; avgRating: number; totalSubscribers: number }> {
    const stats: Record<string, { count: number; totalRating: number; totalSubscribers: number }> = {};

    for (const listing of this.listings.values()) {
      if (!stats[listing.category]) {
        stats[listing.category] = { count: 0, totalRating: 0, totalSubscribers: 0 };
      }
      stats[listing.category].count++;
      stats[listing.category].totalRating += listing.rating;
      stats[listing.category].totalSubscribers += listing.subscriberCount;
    }

    const result: Record<string, { count: number; avgRating: number; totalSubscribers: number }> = {};
    for (const [category, data] of Object.entries(stats)) {
      result[category] = {
        count: data.count,
        avgRating: data.count > 0 ? parseFloat((data.totalRating / data.count).toFixed(2)) : 0,
        totalSubscribers: data.totalSubscribers,
      };
    }

    return result as Record<APICategory, { count: number; avgRating: number; totalSubscribers: number }>;
  }

  getMarketplaceOverview(): {
    totalAPIs: number;
    totalSubscriptions: number;
    totalReviews: number;
    avgRating: number;
    topCategories: { category: string; count: number }[];
    recentlyPublished: APIListing[];
  } {
    const listings = Array.from(this.listings.values());
    const published = listings.filter((l) => l.status === 'published');

    let totalSubscriptions = 0;
    for (const subs of this.subscriptions.values()) {
      totalSubscriptions += subs.filter((s) => s.status === 'active').length;
    }

    let totalReviews = 0;
    for (const reviews of this.reviews.values()) {
      totalReviews += reviews.length;
    }

    const avgRating =
      published.length > 0
        ? published.reduce((sum, l) => sum + l.rating, 0) / published.length
        : 0;

    const categoryCount: Record<string, number> = {};
    for (const l of published) {
      categoryCount[l.category] = (categoryCount[l.category] || 0) + 1;
    }

    const topCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    const recentlyPublished = published
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);

    return {
      totalAPIs: published.length,
      totalSubscriptions,
      totalReviews,
      avgRating: parseFloat(avgRating.toFixed(2)),
      topCategories,
      recentlyPublished,
    };
  }
}

let marketplaceInstance: APIMarketplace | null = null;

export function getAPIMarketplace(): APIMarketplace {
  if (!marketplaceInstance) {
    marketplaceInstance = new APIMarketplace();
  }
  return marketplaceInstance;
}
