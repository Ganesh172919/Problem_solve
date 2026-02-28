/**
 * Content Syndication Engine
 *
 * Provides:
 * - Content syndication to external platforms (RSS, REST API push)
 * - Multi-destination publishing with format transformation (JSON, XML, RSS)
 * - Syndication scheduling and partner management with API key storage
 * - Content licensing tracking and royalty calculations
 * - Cross-platform analytics aggregation
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type ContentFormat = 'json' | 'xml' | 'rss' | 'atom' | 'html' | 'markdown';

export interface SyndicationPartner {
  id: string;
  name: string;
  description?: string;
  apiEndpoint: string;
  apiKey: string; // stored encrypted
  formats: ContentFormat[];
  categories: string[];
  active: boolean;
  rateLimit: { requestsPerHour: number; requestsPerDay: number };
  revenueShare: number; // percentage 0-100
  contractStart: Date;
  contractEnd?: Date;
  lastSyncAt?: Date;
  stats: { totalSyndicated: number; totalRevenue: number; successRate: number };
}

export interface ContentItem {
  id: string;
  title: string;
  body: string;
  summary: string;
  author: string;
  publishedAt: Date;
  updatedAt?: Date;
  categories: string[];
  tags: string[];
  imageUrl?: string;
  canonicalUrl: string;
  wordCount: number;
  readTimeMinutes: number;
}

export interface SyndicationJob {
  id: string;
  contentId: string;
  partnerId: string;
  format: ContentFormat;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  partnerContentId?: string; // ID returned by partner
  royaltyOwed: number;
}

export interface LicenseAgreement {
  id: string;
  contentId: string;
  partnerId: string;
  licenseType: 'exclusive' | 'non-exclusive' | 'first-run' | 'reprint';
  territory: string[];
  startDate: Date;
  endDate?: Date;
  baseRoyalty: number; // USD per 1000 views
  minimumGuarantee: number;
  maximumCap?: number;
  usageRestrictions: string[];
  active: boolean;
}

export interface RoyaltyRecord {
  id: string;
  licenseId: string;
  contentId: string;
  partnerId: string;
  period: { start: Date; end: Date };
  views: number;
  calculatedRoyalty: number;
  minimumApplied: boolean;
  capApplied: boolean;
  status: 'pending' | 'invoiced' | 'paid';
  invoicedAt?: Date;
  paidAt?: Date;
}

export interface SyndicationSchedule {
  contentId: string;
  partnerIds: string[];
  format: ContentFormat;
  publishAt: Date;
  recurring?: { frequency: 'hourly' | 'daily' | 'weekly'; interval: number };
  timezone: string;
}

export interface SyndicationAnalytics {
  partnerId: string;
  partnerName: string;
  period: { start: Date; end: Date };
  contentsSyndicated: number;
  totalViews: number;
  totalClicks: number;
  ctr: number;
  avgTimeOnContent: number;
  topContent: Array<{ contentId: string; title: string; views: number }>;
  revenueGenerated: number;
  royaltiesOwed: number;
}

export interface RSSFeed {
  title: string;
  description: string;
  link: string;
  language: string;
  lastBuildDate: Date;
  ttl: number;
  items: RSSItem[];
  xml: string;
}

export interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: Date;
  guid: string;
  author?: string;
  category?: string[];
  enclosure?: { url: string; type: string; length: number };
}

export interface PartnerStatus {
  partnerId: string;
  partnerName: string;
  active: boolean;
  healthy: boolean;
  lastSyncAt?: Date;
  pendingJobs: number;
  failedJobs: number;
  dailyRequestsUsed: number;
  dailyRequestsLimit: number;
  rateUtilization: number;
  recentErrors: string[];
}

// ─── Content Syndication Engine ───────────────────────────────────────────────

class ContentSyndicationEngine {
  private partners = new Map<string, SyndicationPartner>();
  private jobs = new Map<string, SyndicationJob>();
  private licenses = new Map<string, LicenseAgreement>();
  private royalties = new Map<string, RoyaltyRecord>();
  private content = new Map<string, ContentItem>();
  private schedules: SyndicationSchedule[] = [];
  private scheduledTimers = new Map<string, NodeJS.Timeout>();
  private partnerRequestCounts = new Map<string, { hour: number; day: number; hourReset: number; dayReset: number }>();
  private readonly CACHE_TTL = 300;

  constructor() {
    this.seedSampleData();
    logger.info('ContentSyndicationEngine initialized');
  }

  // ─── Seeding ─────────────────────────────────────────────────────────────

  private seedSampleData(): void {
    const partnerDefs = [
      { id: 'partner_msn', name: 'MSN News', endpoint: 'https://api.msn.com/syndicate', revShare: 30 },
      { id: 'partner_ap', name: 'AP Content Services', endpoint: 'https://api.ap.org/content/v2', revShare: 45 },
      { id: 'partner_flipboard', name: 'Flipboard', endpoint: 'https://api.flipboard.com/publish', revShare: 20 },
      { id: 'partner_pocket', name: 'Pocket', endpoint: 'https://api.getpocket.com/v3/sync', revShare: 15 },
    ];

    for (const p of partnerDefs) {
      this.partners.set(p.id, {
        id: p.id,
        name: p.name,
        apiEndpoint: p.endpoint,
        apiKey: this.encryptApiKey(`key_${p.id}_${Math.random().toString(36).slice(2)}`),
        formats: ['json', 'rss'],
        categories: ['technology', 'business', 'science'],
        active: true,
        rateLimit: { requestsPerHour: 100, requestsPerDay: 500 },
        revenueShare: p.revShare,
        contractStart: new Date('2024-01-01'),
        stats: { totalSyndicated: Math.floor(100 + Math.random() * 900), totalRevenue: parseFloat((500 + Math.random() * 5000).toFixed(2)), successRate: 95 + Math.random() * 4 },
      });
    }

    // Seed content
    const topics = ['AI Breakthroughs', 'Climate Tech', 'Web3 Update', 'Startup Funding', 'Quantum Computing'];
    for (let i = 0; i < 20; i++) {
      const id = `content_${i.toString().padStart(3, '0')}`;
      const wordCount = Math.floor(400 + Math.random() * 1200);
      this.content.set(id, {
        id,
        title: `${topics[i % topics.length]}: Article ${i + 1}`,
        body: `Full article body for article ${i + 1}. `.repeat(Math.floor(wordCount / 7)),
        summary: `Summary for article ${i + 1} covering important developments in the field.`,
        author: `Author ${(i % 5) + 1}`,
        publishedAt: new Date(Date.now() - i * 86_400_000),
        categories: ['technology'],
        tags: ['tech', 'news', topics[i % topics.length].toLowerCase().replace(/ /g, '-')],
        canonicalUrl: `https://example.com/articles/${id}`,
        wordCount,
        readTimeMinutes: Math.ceil(wordCount / 200),
      });
    }

    // Seed licenses
    for (const [contentId] of this.content) {
      for (const [partnerId] of this.partners) {
        const licId = `lic_${contentId}_${partnerId}`;
        this.licenses.set(licId, {
          id: licId,
          contentId,
          partnerId,
          licenseType: 'non-exclusive',
          territory: ['US', 'CA', 'GB'],
          startDate: new Date('2024-01-01'),
          baseRoyalty: 0.5,
          minimumGuarantee: 5,
          maximumCap: 500,
          usageRestrictions: ['no-modification', 'attribution-required'],
          active: true,
        });
      }
    }
  }

  // ─── Encryption (simple obfuscation for demo) ─────────────────────────────

  private encryptApiKey(key: string): string {
    return Buffer.from(key).toString('base64');
  }

  private decryptApiKey(encrypted: string): string {
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }

  // ─── Partner Management ───────────────────────────────────────────────────

  addPartner(partner: Omit<SyndicationPartner, 'stats' | 'apiKey'> & { apiKey: string }): SyndicationPartner {
    const full: SyndicationPartner = {
      ...partner,
      apiKey: this.encryptApiKey(partner.apiKey),
      stats: { totalSyndicated: 0, totalRevenue: 0, successRate: 100 },
    };
    this.partners.set(full.id, full);
    this.partnerRequestCounts.set(full.id, { hour: 0, day: 0, hourReset: Date.now() + 3600_000, dayReset: Date.now() + 86_400_000 });
    logger.info('Partner added', { partnerId: full.id, name: full.name });
    return full;
  }

  removePartner(partnerId: string): boolean {
    const existed = this.partners.has(partnerId);
    this.partners.delete(partnerId);
    logger.info('Partner removed', { partnerId });
    return existed;
  }

  getPartnerStatus(partnerId: string): PartnerStatus | null {
    const partner = this.partners.get(partnerId);
    if (!partner) return null;

    const pendingJobs = Array.from(this.jobs.values()).filter(
      (j) => j.partnerId === partnerId && j.status === 'pending',
    ).length;
    const failedJobs = Array.from(this.jobs.values()).filter(
      (j) => j.partnerId === partnerId && j.status === 'failed',
    ).length;
    const recentErrors = Array.from(this.jobs.values())
      .filter((j) => j.partnerId === partnerId && j.status === 'failed' && j.errorMessage)
      .slice(-5)
      .map((j) => j.errorMessage!);

    const counts = this.partnerRequestCounts.get(partnerId) ?? { hour: 0, day: 0, hourReset: 0, dayReset: 0 };
    const dailyRequestsUsed = counts.day;
    const rateUtilization = parseFloat(
      ((dailyRequestsUsed / partner.rateLimit.requestsPerDay) * 100).toFixed(1),
    );

    return {
      partnerId,
      partnerName: partner.name,
      active: partner.active,
      healthy: partner.active && failedJobs < 10,
      lastSyncAt: partner.lastSyncAt,
      pendingJobs,
      failedJobs,
      dailyRequestsUsed,
      dailyRequestsLimit: partner.rateLimit.requestsPerDay,
      rateUtilization,
      recentErrors,
    };
  }

  // ─── Content Syndication ──────────────────────────────────────────────────

  async syndicateContent(contentId: string, partnerIds: string[], format: ContentFormat): Promise<SyndicationJob[]> {
    const content = this.content.get(contentId);
    if (!content) {
      logger.warn('Content not found for syndication', { contentId });
      return [];
    }

    const jobs: SyndicationJob[] = [];
    for (const partnerId of partnerIds) {
      const partner = this.partners.get(partnerId);
      if (!partner?.active) {
        logger.warn('Partner not active', { partnerId });
        continue;
      }

      if (!this.checkRateLimit(partnerId)) {
        logger.warn('Rate limit exceeded for partner', { partnerId });
        const job = this.createJob(contentId, partnerId, format, 'skipped');
        job.errorMessage = 'Rate limit exceeded';
        jobs.push(job);
        continue;
      }

      const job = this.createJob(contentId, partnerId, format, 'running');
      job.startedAt = new Date();

      try {
        const transformed = this.transformContent(content, format);
        // Simulate API push (in production, use fetch)
        const success = Math.random() > 0.05;
        if (!success) throw new Error('Partner API returned 503');

        job.status = 'success';
        job.completedAt = new Date();
        job.partnerContentId = `partner_${Date.now()}`;

        // Calculate royalty
        const license = this.findLicense(contentId, partnerId);
        job.royaltyOwed = license ? license.minimumGuarantee : 0;

        partner.stats.totalSyndicated++;
        partner.lastSyncAt = new Date();
        this.incrementRateLimit(partnerId);

        logger.info('Content syndicated successfully', { contentId, partnerId, format });
      } catch (err: unknown) {
        job.status = 'failed';
        job.errorMessage = err instanceof Error ? err.message : 'Unknown error';
        job.retryCount++;
        logger.error('Syndication failed', undefined, { contentId, partnerId, error: job.errorMessage });
      }

      this.jobs.set(job.id, job);
      jobs.push(job);
    }
    return jobs;
  }

  private createJob(
    contentId: string,
    partnerId: string,
    format: ContentFormat,
    status: SyndicationJob['status'],
  ): SyndicationJob {
    return {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      contentId,
      partnerId,
      format,
      status,
      scheduledAt: new Date(),
      retryCount: 0,
      maxRetries: 3,
      royaltyOwed: 0,
    };
  }

  private findLicense(contentId: string, partnerId: string): LicenseAgreement | undefined {
    return Array.from(this.licenses.values()).find(
      (l) => l.contentId === contentId && l.partnerId === partnerId && l.active,
    );
  }

  // ─── Rate Limiting ────────────────────────────────────────────────────────

  private checkRateLimit(partnerId: string): boolean {
    const partner = this.partners.get(partnerId);
    if (!partner) return false;
    const counts = this.partnerRequestCounts.get(partnerId) ?? { hour: 0, day: 0, hourReset: 0, dayReset: 0 };
    const now = Date.now();
    if (now > counts.hourReset) { counts.hour = 0; counts.hourReset = now + 3600_000; }
    if (now > counts.dayReset) { counts.day = 0; counts.dayReset = now + 86_400_000; }
    this.partnerRequestCounts.set(partnerId, counts);
    return counts.hour < partner.rateLimit.requestsPerHour && counts.day < partner.rateLimit.requestsPerDay;
  }

  private incrementRateLimit(partnerId: string): void {
    const counts = this.partnerRequestCounts.get(partnerId);
    if (counts) { counts.hour++; counts.day++; }
  }

  // ─── Scheduling ───────────────────────────────────────────────────────────

  schedulePublication(schedule: SyndicationSchedule): void {
    this.schedules.push(schedule);
    const delay = schedule.publishAt.getTime() - Date.now();
    if (delay < 0) {
      logger.warn('Scheduled publication time is in the past', { contentId: schedule.contentId });
      return;
    }

    const timerId = `${schedule.contentId}_${schedule.publishAt.getTime()}`;
    const timer = setTimeout(async () => {
      await this.syndicateContent(schedule.contentId, schedule.partnerIds, schedule.format);
      this.scheduledTimers.delete(timerId);

      if (schedule.recurring) {
        const intervalMs =
          schedule.recurring.frequency === 'hourly' ? 3_600_000 * schedule.recurring.interval
          : schedule.recurring.frequency === 'daily' ? 86_400_000 * schedule.recurring.interval
          : 604_800_000 * schedule.recurring.interval;
        schedule.publishAt = new Date(schedule.publishAt.getTime() + intervalMs);
        this.schedulePublication(schedule);
      }
    }, Math.min(delay, 2_147_483_647));

    this.scheduledTimers.set(timerId, timer);
    logger.info('Publication scheduled', {
      contentId: schedule.contentId,
      publishAt: schedule.publishAt.toISOString(),
      partners: schedule.partnerIds.length,
    });
  }

  cancelSchedule(contentId: string): number {
    let cancelled = 0;
    for (const [key, timer] of this.scheduledTimers) {
      if (key.startsWith(contentId)) {
        clearTimeout(timer);
        this.scheduledTimers.delete(key);
        cancelled++;
      }
    }
    return cancelled;
  }

  // ─── Format Transformation ────────────────────────────────────────────────

  transformContent(content: ContentItem, format: ContentFormat): string {
    switch (format) {
      case 'json':
        return JSON.stringify({
          id: content.id,
          title: content.title,
          summary: content.summary,
          body: content.body,
          author: content.author,
          publishedAt: content.publishedAt.toISOString(),
          categories: content.categories,
          tags: content.tags,
          canonicalUrl: content.canonicalUrl,
          wordCount: content.wordCount,
          readTimeMinutes: content.readTimeMinutes,
        }, null, 2);

      case 'rss':
        return this.toRSSItemXml(content);

      case 'xml':
        return this.toXml({
          article: {
            id: content.id,
            title: content.title,
            summary: content.summary,
            author: content.author,
            publishedAt: content.publishedAt.toISOString(),
            canonicalUrl: content.canonicalUrl,
            categories: { category: content.categories },
            body: { '#cdata': content.body },
          },
        });

      case 'atom':
        return this.toAtomEntry(content);

      case 'html':
        return `<!DOCTYPE html><html><head><title>${this.escapeXml(content.title)}</title></head><body><h1>${this.escapeXml(content.title)}</h1><p><em>By ${this.escapeXml(content.author)}</em></p><div class="content">${content.body}</div></body></html>`;

      case 'markdown':
        return `# ${content.title}\n\n*By ${content.author} — ${content.publishedAt.toDateString()}*\n\n${content.summary}\n\n${content.body}`;

      default:
        return content.body;
    }
  }

  private toRSSItemXml(content: ContentItem): string {
    return [
      '<item>',
      `  <title><![CDATA[${content.title}]]></title>`,
      `  <description><![CDATA[${content.summary}]]></description>`,
      `  <link>${this.escapeXml(content.canonicalUrl)}</link>`,
      `  <guid isPermaLink="true">${this.escapeXml(content.canonicalUrl)}</guid>`,
      `  <pubDate>${content.publishedAt.toUTCString()}</pubDate>`,
      `  <author>${this.escapeXml(content.author)}</author>`,
      ...content.categories.map((c) => `  <category>${this.escapeXml(c)}</category>`),
      '</item>',
    ].join('\n');
  }

  private toAtomEntry(content: ContentItem): string {
    return [
      '<entry>',
      `  <title type="html"><![CDATA[${content.title}]]></title>`,
      `  <id>${this.escapeXml(content.canonicalUrl)}</id>`,
      `  <link href="${this.escapeXml(content.canonicalUrl)}" rel="alternate"/>`,
      `  <published>${content.publishedAt.toISOString()}</published>`,
      `  <updated>${(content.updatedAt ?? content.publishedAt).toISOString()}</updated>`,
      `  <author><name>${this.escapeXml(content.author)}</name></author>`,
      `  <summary type="html"><![CDATA[${content.summary}]]></summary>`,
      `  <content type="html"><![CDATA[${content.body}]]></content>`,
      '</entry>',
    ].join('\n');
  }

  private toXml(obj: Record<string, unknown>, indent = 0): string {
    const pad = '  '.repeat(indent);
    let xml = '';
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'object' && val !== null && '#cdata' in (val as object)) {
        xml += `${pad}<${key}><![CDATA[${(val as Record<string, unknown>)['#cdata']}]]></${key}>\n`;
      } else if (Array.isArray(val)) {
        xml += val.map((v) => `${pad}<${key}>${this.escapeXml(String(v))}</${key}>`).join('\n') + '\n';
      } else if (typeof val === 'object' && val !== null) {
        xml += `${pad}<${key}>\n${this.toXml(val as Record<string, unknown>, indent + 1)}${pad}</${key}>\n`;
      } else {
        xml += `${pad}<${key}>${this.escapeXml(String(val))}</${key}>\n`;
      }
    }
    return xml;
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // ─── RSS Feed Generation ──────────────────────────────────────────────────

  generateRSSFeed(
    title: string,
    description: string,
    link: string,
    contentIds?: string[],
    maxItems = 20,
  ): RSSFeed {
    const cacheKey = `syndication:rss:${link}:${(contentIds ?? []).join(',')}`;
    const cached = cache.get<RSSFeed>(cacheKey);
    if (cached) return cached;

    const items: ContentItem[] = contentIds
      ? contentIds.map((id) => this.content.get(id)).filter(Boolean) as ContentItem[]
      : Array.from(this.content.values()).sort(
          (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
        );

    const rssItems: RSSItem[] = items.slice(0, maxItems).map((c) => ({
      title: c.title,
      description: c.summary,
      link: c.canonicalUrl,
      pubDate: c.publishedAt,
      guid: c.canonicalUrl,
      author: c.author,
      category: c.categories,
    }));

    const now = new Date();
    const itemsXml = rssItems.map((item) => [
      '    <item>',
      `      <title><![CDATA[${item.title}]]></title>`,
      `      <description><![CDATA[${item.description}]]></description>`,
      `      <link>${this.escapeXml(item.link)}</link>`,
      `      <guid isPermaLink="true">${this.escapeXml(item.guid)}</guid>`,
      `      <pubDate>${item.pubDate.toUTCString()}</pubDate>`,
      item.author ? `      <author>${this.escapeXml(item.author)}</author>` : '',
      ...(item.category ?? []).map((c) => `      <category>${this.escapeXml(c)}</category>`),
      '    </item>',
    ].filter(Boolean).join('\n')).join('\n');

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${this.escapeXml(title)}</title>`,
      `    <description>${this.escapeXml(description)}</description>`,
      `    <link>${this.escapeXml(link)}</link>`,
      `    <language>en-us</language>`,
      `    <lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
      `    <ttl>60</ttl>`,
      `    <atom:link href="${this.escapeXml(link)}/rss" rel="self" type="application/rss+xml"/>`,
      itemsXml,
      '  </channel>',
      '</rss>',
    ].join('\n');

    const feed: RSSFeed = {
      title,
      description,
      link,
      language: 'en-us',
      lastBuildDate: now,
      ttl: 60,
      items: rssItems,
      xml,
    };

    cache.set(cacheKey, feed, 600);
    return feed;
  }

  // ─── Licensing ────────────────────────────────────────────────────────────

  trackLicensing(agreement: Omit<LicenseAgreement, 'id'>): LicenseAgreement {
    const full: LicenseAgreement = {
      ...agreement,
      id: `lic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    this.licenses.set(full.id, full);
    logger.info('License agreement tracked', { licenseId: full.id, contentId: full.contentId, partnerId: full.partnerId });
    return full;
  }

  // ─── Royalty Calculations ─────────────────────────────────────────────────

  calculateRoyalties(partnerId: string, period: { start: Date; end: Date }, views: number): RoyaltyRecord[] {
    const records: RoyaltyRecord[] = [];
    const partnerLicenses = Array.from(this.licenses.values()).filter(
      (l) => l.partnerId === partnerId && l.active,
    );

    for (const license of partnerLicenses) {
      let calculatedRoyalty = (views / 1000) * license.baseRoyalty;
      let minimumApplied = false;
      let capApplied = false;

      if (calculatedRoyalty < license.minimumGuarantee) {
        calculatedRoyalty = license.minimumGuarantee;
        minimumApplied = true;
      }
      if (license.maximumCap !== undefined && calculatedRoyalty > license.maximumCap) {
        calculatedRoyalty = license.maximumCap;
        capApplied = true;
      }

      const record: RoyaltyRecord = {
        id: `roy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        licenseId: license.id,
        contentId: license.contentId,
        partnerId,
        period,
        views,
        calculatedRoyalty: parseFloat(calculatedRoyalty.toFixed(2)),
        minimumApplied,
        capApplied,
        status: 'pending',
      };

      this.royalties.set(record.id, record);
      records.push(record);
    }

    logger.info('Royalties calculated', { partnerId, records: records.length, period: `${period.start.toDateString()} – ${period.end.toDateString()}` });
    return records;
  }

  getTotalRoyaltiesOwed(partnerId?: string): number {
    let total = 0;
    for (const r of this.royalties.values()) {
      if ((!partnerId || r.partnerId === partnerId) && r.status !== 'paid') {
        total += r.calculatedRoyalty;
      }
    }
    return parseFloat(total.toFixed(2));
  }

  // ─── Analytics Aggregation ────────────────────────────────────────────────

  aggregateAnalytics(partnerId: string, period: { start: Date; end: Date }): SyndicationAnalytics {
    const cacheKey = `syndication:analytics:${partnerId}:${period.start.toISOString()}:${period.end.toISOString()}`;
    const cached = cache.get<SyndicationAnalytics>(cacheKey);
    if (cached) return cached;

    const partner = this.partners.get(partnerId);
    const partnerJobs = Array.from(this.jobs.values()).filter(
      (j) =>
        j.partnerId === partnerId &&
        j.completedAt &&
        j.completedAt >= period.start &&
        j.completedAt <= period.end &&
        j.status === 'success',
    );

    const contentsSyndicated = partnerJobs.length;
    // Simulate view/click data proportional to jobs
    const totalViews = partnerJobs.length * Math.floor(1000 + Math.random() * 5000);
    const totalClicks = Math.floor(totalViews * (0.02 + Math.random() * 0.05));
    const ctr = totalViews > 0 ? parseFloat(((totalClicks / totalViews) * 100).toFixed(2)) : 0;

    const topContent = partnerJobs.slice(0, 5).map((j) => {
      const c = this.content.get(j.contentId);
      return {
        contentId: j.contentId,
        title: c?.title ?? 'Unknown',
        views: Math.floor(1000 + Math.random() * 10000),
      };
    });

    const royaltiesOwed = this.getTotalRoyaltiesOwed(partnerId);
    const revenueGenerated = partner
      ? parseFloat(((royaltiesOwed * 100) / Math.max(partner.revenueShare, 1)).toFixed(2))
      : 0;

    const analytics: SyndicationAnalytics = {
      partnerId,
      partnerName: partner?.name ?? 'Unknown',
      period,
      contentsSyndicated,
      totalViews,
      totalClicks,
      ctr,
      avgTimeOnContent: Math.floor(60 + Math.random() * 180),
      topContent,
      revenueGenerated,
      royaltiesOwed,
    };

    cache.set(cacheKey, analytics, this.CACHE_TTL);
    return analytics;
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  addContent(item: ContentItem): void {
    this.content.set(item.id, item);
  }

  getPartners(): SyndicationPartner[] {
    return Array.from(this.partners.values()).map((p) => ({
      ...p,
      apiKey: '[REDACTED]',
    }));
  }

  getJobs(filters?: { partnerId?: string; status?: SyndicationJob['status'] }): SyndicationJob[] {
    let jobs = Array.from(this.jobs.values());
    if (filters?.partnerId) jobs = jobs.filter((j) => j.partnerId === filters.partnerId);
    if (filters?.status) jobs = jobs.filter((j) => j.status === filters.status);
    return jobs;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getContentSyndicationEngine(): ContentSyndicationEngine {
  if (!(globalThis as any).__contentSyndicationEngine__) {
    (globalThis as any).__contentSyndicationEngine__ = new ContentSyndicationEngine();
  }
  return (globalThis as any).__contentSyndicationEngine__;
}
