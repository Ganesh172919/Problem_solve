/**
 * Edge Cache Manager
 *
 * CDN and edge layer management:
 * - Edge node topology tracking
 * - Cache-Control header strategy generation
 * - Smart cache invalidation (tag-based, path-based, user-scope)
 * - Geo-routing decisions
 * - Cache hit/miss analytics
 * - Purge queue with batching
 * - Stale-while-revalidate management
 * - Vary header optimization
 * - Per-route TTL policies
 * - Edge warmup jobs
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type EdgeRegion =
  | 'us-east-1'
  | 'us-west-2'
  | 'eu-west-1'
  | 'eu-central-1'
  | 'ap-southeast-1'
  | 'ap-northeast-1'
  | 'sa-east-1';

export interface EdgeNode {
  id: string;
  region: EdgeRegion;
  endpoint: string;
  latencyMs: number;
  hitRate: number;
  requestsPerSecond: number;
  cacheSize: number; // bytes
  capacity: number; // bytes
  healthy: boolean;
  lastHealthCheck: Date;
}

export interface CachePolicy {
  route: string;
  ttlSeconds: number;
  staleTTLSeconds: number;
  tags: string[];
  varyHeaders: string[];
  publicCache: boolean;
  sMaxAge?: number;
  noStore?: boolean;
  mustRevalidate?: boolean;
}

export interface CacheTag {
  name: string;
  contentIds: string[];
  invalidatedAt?: Date;
}

export interface PurgeRequest {
  id: string;
  type: 'tag' | 'path' | 'prefix' | 'all';
  target: string;
  regions: EdgeRegion[];
  requestedAt: Date;
  completedAt?: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  affectedKeys: number;
}

export interface EdgeAnalytics {
  region: EdgeRegion;
  hitRate: number;
  bytesSaved: number;
  requestsServed: number;
  avgLatencyMs: number;
  topCachedPaths: Array<{ path: string; hits: number }>;
  bandwidthReductionPct: number;
}

const DEFAULT_POLICIES: CachePolicy[] = [
  {
    route: '/api/v1/posts',
    ttlSeconds: 60,
    staleTTLSeconds: 300,
    tags: ['posts'],
    varyHeaders: ['Accept-Language', 'Authorization'],
    publicCache: false,
  },
  {
    route: '/api/v1/search',
    ttlSeconds: 30,
    staleTTLSeconds: 120,
    tags: ['search', 'posts'],
    varyHeaders: ['Accept-Language'],
    publicCache: true,
  },
  {
    route: '/rss.xml',
    ttlSeconds: 600,
    staleTTLSeconds: 3600,
    tags: ['posts', 'rss'],
    varyHeaders: [],
    publicCache: true,
    sMaxAge: 600,
  },
  {
    route: '/sitemap.xml',
    ttlSeconds: 3600,
    staleTTLSeconds: 86400,
    tags: ['sitemap'],
    varyHeaders: [],
    publicCache: true,
    sMaxAge: 3600,
  },
  {
    route: '/api/metrics',
    ttlSeconds: 15,
    staleTTLSeconds: 60,
    tags: ['metrics'],
    varyHeaders: [],
    publicCache: false,
    noStore: false,
  },
  {
    route: '/api/health',
    ttlSeconds: 10,
    staleTTLSeconds: 30,
    tags: ['health'],
    varyHeaders: [],
    publicCache: true,
  },
];

const GEO_TO_REGION: Record<string, EdgeRegion> = {
  US: 'us-east-1',
  CA: 'us-east-1',
  MX: 'us-east-1',
  GB: 'eu-west-1',
  FR: 'eu-west-1',
  DE: 'eu-central-1',
  NL: 'eu-central-1',
  SG: 'ap-southeast-1',
  JP: 'ap-northeast-1',
  BR: 'sa-east-1',
  AU: 'ap-southeast-1',
};

const REGION_LATENCY: Record<EdgeRegion, number> = {
  'us-east-1': 15,
  'us-west-2': 25,
  'eu-west-1': 20,
  'eu-central-1': 22,
  'ap-southeast-1': 35,
  'ap-northeast-1': 40,
  'sa-east-1': 60,
};

export function buildCacheControlHeader(policy: CachePolicy): string {
  if (policy.noStore) return 'no-store';

  const directives: string[] = [];

  if (policy.publicCache) {
    directives.push('public');
  } else {
    directives.push('private');
  }

  directives.push(`max-age=${policy.ttlSeconds}`);

  if (policy.sMaxAge !== undefined) {
    directives.push(`s-maxage=${policy.sMaxAge}`);
  }

  if (policy.staleTTLSeconds > 0) {
    directives.push(`stale-while-revalidate=${policy.staleTTLSeconds}`);
    directives.push(`stale-if-error=${policy.staleTTLSeconds * 2}`);
  }

  if (policy.mustRevalidate) {
    directives.push('must-revalidate');
  }

  return directives.join(', ');
}

export function getCachePolicyForRoute(route: string): CachePolicy | null {
  const exact = DEFAULT_POLICIES.find((p) => p.route === route);
  if (exact) return exact;

  // Prefix matching
  const prefix = DEFAULT_POLICIES.find((p) => route.startsWith(p.route));
  return prefix ?? null;
}

export function resolveEdgeRegion(countryCode: string): EdgeRegion {
  return GEO_TO_REGION[countryCode.toUpperCase()] ?? 'us-east-1';
}

export function estimateEdgeLatency(region: EdgeRegion): number {
  return REGION_LATENCY[region];
}

const purgeQueue: PurgeRequest[] = [];
let purgeFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function enqueuePurge(
  type: PurgeRequest['type'],
  target: string,
  regions: EdgeRegion[] = Object.keys(REGION_LATENCY) as EdgeRegion[],
): PurgeRequest {
  const req: PurgeRequest = {
    id: `purge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    target,
    regions,
    requestedAt: new Date(),
    status: 'pending',
    affectedKeys: 0,
  };
  purgeQueue.push(req);
  logger.info('Cache purge enqueued', { id: req.id, type, target });

  if (!purgeFlushTimer) {
    purgeFlushTimer = setTimeout(() => {
      flushPurgeQueue().catch((err) =>
        logger.error('Purge queue flush error', undefined, { error: err }),
      );
      purgeFlushTimer = null;
    }, 500);
  }

  return req;
}

async function flushPurgeQueue(): Promise<void> {
  const batch = purgeQueue.splice(0, purgeQueue.length);
  if (batch.length === 0) return;

  logger.info('Flushing purge queue', { count: batch.length });

  for (const req of batch) {
    req.status = 'in_progress';
    try {
      // In production this would call CDN provider APIs (Cloudflare, Fastly, etc.)
      const simulated = simulatePurge(req);
      req.affectedKeys = simulated;
      req.completedAt = new Date();
      req.status = 'completed';
      logger.info('Cache purge completed', { id: req.id, affectedKeys: req.affectedKeys });
    } catch (err) {
      req.status = 'failed';
      logger.error('Cache purge failed', undefined, { id: req.id, error: err });
    }
  }
}

function simulatePurge(req: PurgeRequest): number {
  const cache = getCache();
  switch (req.type) {
    case 'tag':
      return invalidateByTag(req.target);
    case 'path':
      return invalidateByPath(req.target, cache);
    case 'prefix':
      return invalidateByPrefix(req.target, cache);
    case 'all':
      cache.clear();
      return -1; // all keys
    default:
      return 0;
  }
}

function invalidateByTag(tag: string): number {
  const cache = getCache();
  const tagKey = `edge:tag:${tag}`;
  const tagData = cache.get<CacheTag>(tagKey);
  if (!tagData) return 0;

  let count = 0;
  for (const contentId of tagData.contentIds) {
    cache.del(`edge:content:${contentId}`);
    count++;
  }
  tagData.invalidatedAt = new Date();
  cache.set(tagKey, tagData, 300);
  return count;
}

function invalidateByPath(path: string, cache: ReturnType<typeof getCache>): number {
  const key = `edge:path:${path}`;
  const existed = cache.get(key) !== undefined;
  cache.del(key);
  return existed ? 1 : 0;
}

function invalidateByPrefix(prefix: string, cache: ReturnType<typeof getCache>): number {
  // In real implementation this would use cache.keys() or a Redis SCAN
  logger.debug('Prefix invalidation', { prefix });
  return 0;
}

export function registerContentWithTags(contentId: string, tags: string[]): void {
  const cache = getCache();
  for (const tag of tags) {
    const tagKey = `edge:tag:${tag}`;
    const existing = cache.get<CacheTag>(tagKey) ?? { name: tag, contentIds: [] };
    if (!existing.contentIds.includes(contentId)) {
      existing.contentIds.push(contentId);
    }
    cache.set(tagKey, existing, 86400);
  }
}

export function invalidatePostContent(postSlug: string): void {
  enqueuePurge('tag', 'posts');
  enqueuePurge('path', `/api/v1/posts/${postSlug}`);
  enqueuePurge('path', `/post/${postSlug}`);
  enqueuePurge('tag', 'rss');
  enqueuePurge('tag', 'sitemap');
}

export function invalidateUserContent(userId: string): void {
  enqueuePurge('prefix', `/api/users/${userId}`);
  enqueuePurge('tag', `user:${userId}`);
}

const analyticsStore: Partial<Record<EdgeRegion, EdgeAnalytics>> = {};

export function recordCacheHit(region: EdgeRegion, path: string, bytesServed: number): void {
  if (!analyticsStore[region]) {
    analyticsStore[region] = {
      region,
      hitRate: 0,
      bytesSaved: 0,
      requestsServed: 0,
      avgLatencyMs: REGION_LATENCY[region],
      topCachedPaths: [],
      bandwidthReductionPct: 0,
    };
  }
  const a = analyticsStore[region]!;
  a.requestsServed += 1;
  a.bytesSaved += bytesServed;

  const existing = a.topCachedPaths.find((p) => p.path === path);
  if (existing) {
    existing.hits += 1;
  } else {
    a.topCachedPaths.push({ path, hits: 1 });
  }
  a.topCachedPaths.sort((x, y) => y.hits - x.hits);
  if (a.topCachedPaths.length > 20) a.topCachedPaths.length = 20;
}

export function recordCacheMiss(region: EdgeRegion): void {
  if (!analyticsStore[region]) return;
  const a = analyticsStore[region]!;
  const total = a.requestsServed + 1;
  a.hitRate = a.requestsServed / total;
}

export function getEdgeAnalytics(region: EdgeRegion): EdgeAnalytics | null {
  return analyticsStore[region] ?? null;
}

export function getAllEdgeAnalytics(): EdgeAnalytics[] {
  return Object.values(analyticsStore).filter(Boolean) as EdgeAnalytics[];
}

export function generateVaryHeader(policy: CachePolicy): string {
  if (policy.varyHeaders.length === 0) return '';
  return policy.varyHeaders.join(', ');
}

export async function warmEdgeCache(
  paths: string[],
  regions: EdgeRegion[],
  fetchFn: (path: string) => Promise<void>,
): Promise<{ warmed: number; failed: number }> {
  let warmed = 0;
  let failed = 0;

  for (const path of paths) {
    for (const region of regions) {
      try {
        await fetchFn(path);
        warmed++;
        logger.debug('Edge cache warmed', { path, region });
      } catch (err) {
        failed++;
        logger.warn('Edge cache warmup failed', { path, region, error: err });
      }
    }
  }

  logger.info('Edge cache warmup complete', { warmed, failed });
  return { warmed, failed };
}

export function getDefaultPolicies(): CachePolicy[] {
  return DEFAULT_POLICIES;
}

export function getPurgeQueueStatus(): { pending: number; inProgress: number } {
  return {
    pending: purgeQueue.filter((r) => r.status === 'pending').length,
    inProgress: purgeQueue.filter((r) => r.status === 'in_progress').length,
  };
}
