/**
 * Content Distribution Agent
 *
 * Autonomous content distribution agent that:
 * - Distributes content to multiple channels (social, RSS, email, API partners)
 * - Calculates optimal timing for each channel (time-of-day, day-of-week scoring)
 * - Channel selection strategy (match content type to channel affinity)
 * - Format adaptation per platform (truncate, UTM params, platform-specific formatting)
 * - Engagement tracking per distribution, ROI calculation per channel
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';
import getContentSyndicationEngine from '../lib/contentSyndicationEngine';

const logger = getLogger();
const cache = getCache();

// ── Interfaces ────────────────────────────────────────────────────────────────

export type ChannelType = 'twitter' | 'linkedin' | 'facebook' | 'instagram' | 'rss' | 'email' | 'api_partner' | 'slack' | 'telegram' | 'webhook';

export interface ChannelConfig {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  maxCharacters?: number;
  supportsImages: boolean;
  supportsLinks: boolean;
  supportsMarkdown: boolean;
  contentAffinity: Record<string, number>;   // category -> 0-1 affinity score
  audienceSize: number;
  avgEngagementRate: number;                 // 0-1
  costPerPost: number;                       // USD
  peakHours: number[];                       // 0-23
  peakDays: number[];                        // 0-6 (0=Sun)
  utmSource: string;
  utmMedium: string;
  rateLimit: { postsPerHour: number; postsPerDay: number };
  credentials: Record<string, string>;       // API keys / tokens (opaque)
  lastPostedAt?: Date;
  totalPosts: number;
  totalEngagement: number;
  totalReach: number;
}

export interface DistributionTask {
  id: string;
  contentId: string;
  title: string;
  body: string;
  summary: string;
  imageUrl?: string;
  canonicalUrl: string;
  category: string;
  tags: string[];
  author: string;
  publishedAt: Date;
  targetChannels?: ChannelType[];            // if empty, auto-select
  scheduledAt?: Date;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'scheduled';
  priority: 'low' | 'medium' | 'high' | 'breaking';
  createdAt: Date;
  retryCount: number;
  errorMessage?: string;
}

export interface DistributionResult {
  taskId: string;
  contentId: string;
  channelId: string;
  channelType: ChannelType;
  status: 'success' | 'failed' | 'rate_limited' | 'skipped';
  formattedContent: string;
  postedAt?: Date;
  externalPostId?: string;
  errorMessage?: string;
  reachEstimate: number;
  engagementEstimate: number;
  utmUrl: string;
  durationMs: number;
}

export interface EngagementMetrics {
  channelId: string;
  contentId: string;
  impressions: number;
  clicks: number;
  likes: number;
  shares: number;
  comments: number;
  ctr: number;               // clicks / impressions
  engagementRate: number;    // (likes+shares+comments) / impressions
  reach: number;
  estimatedLeadsGenerated: number;
  estimatedConversions: number;
  measuredAt: Date;
}

export interface ROIReport {
  channelId: string;
  channelType: ChannelType;
  period: { start: Date; end: Date };
  totalPosts: number;
  totalCost: number;
  totalReach: number;
  totalClicks: number;
  totalEngagement: number;
  estimatedRevenue: number;
  roi: number;               // (revenue - cost) / cost * 100
  cpc: number;               // cost per click
  cpm: number;               // cost per 1000 impressions
  bestPerformingCategory: string;
  worstPerformingCategory: string;
  recommendations: string[];
}

export interface DistributionReport {
  agentId: string;
  runId: string;
  period: { start: Date; end: Date };
  tasksProcessed: number;
  distributionsAttempted: number;
  distributionsSucceeded: number;
  distributionsFailed: number;
  channelBreakdown: Record<ChannelType, { posts: number; reach: number; engagement: number }>;
  roiReports: ROIReport[];
  topContentByEngagement: Array<{ contentId: string; totalEngagement: number }>;
  errors: Array<{ contentId: string; channel: ChannelType; error: string }>;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class ContentDistributionAgent {
  private readonly agentId = 'content-distribution-agent';
  private syndication = getContentSyndicationEngine();
  private channels = new Map<string, ChannelConfig>();
  private queue: DistributionTask[] = [];
  private results = new Map<string, DistributionResult[]>();         // contentId -> results
  private engagementStore = new Map<string, EngagementMetrics[]>();  // channelId -> metrics
  private postCounts = new Map<string, { hour: number; day: number; hourReset: number; dayReset: number }>();
  private isRunning = false;
  private startedAt = new Date();
  private totalDistributed = 0;

  constructor() {
    this.initDefaultChannels();
    logger.info('ContentDistributionAgent initialized', { agentId: this.agentId });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Process queued distribution tasks and distribute to selected channels. */
  async run(tasks?: DistributionTask[]): Promise<DistributionReport> {
    if (this.isRunning) {
      logger.warn('ContentDistributionAgent already running', { agentId: this.agentId });
      return this.emptyReport();
    }

    this.isRunning = true;
    const runId = `dist_run_${Date.now()}`;
    const runStart = new Date();

    if (tasks?.length) {
      for (const t of tasks) this.queue.push(t);
    }

    logger.info('ContentDistributionAgent run started', { runId, queueSize: this.queue.length });

    const batch = this.queue.splice(0, 50);
    const errors: DistributionReport['errors'] = [];
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    const channelBreakdown: DistributionReport['channelBreakdown'] = {} as DistributionReport['channelBreakdown'];

    for (const task of batch) {
      task.status = 'processing';
      try {
        const results = await this.distributeContent(task);
        this.results.set(task.contentId, results);

        for (const res of results) {
          attempted++;
          if (res.status === 'success') {
            succeeded++;
            const ct = res.channelType;
            if (!channelBreakdown[ct]) channelBreakdown[ct] = { posts: 0, reach: 0, engagement: 0 };
            channelBreakdown[ct].posts++;
            channelBreakdown[ct].reach += res.reachEstimate;
            channelBreakdown[ct].engagement += res.engagementEstimate;
            this.totalDistributed++;
          } else if (res.status === 'failed') {
            failed++;
            errors.push({ contentId: task.contentId, channel: res.channelType, error: res.errorMessage ?? 'Unknown error' });
          }
        }

        task.status = 'completed';
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        task.status = 'failed';
        task.errorMessage = message;
        failed++;
        logger.error('Distribution task failed', undefined, { taskId: task.id, error: message });
      }
    }

    const completedAt = new Date();
    this.isRunning = false;

    const roiReports = this.calculateROI({ start: runStart, end: completedAt });
    const topContent = this.topContentByEngagement(10);

    const report: DistributionReport = {
      agentId: this.agentId,
      runId,
      period: { start: runStart, end: completedAt },
      tasksProcessed: batch.length,
      distributionsAttempted: attempted,
      distributionsSucceeded: succeeded,
      distributionsFailed: failed,
      channelBreakdown,
      roiReports,
      topContentByEngagement: topContent,
      errors,
    };

    logger.info('ContentDistributionAgent run completed', {
      runId,
      durationMs: completedAt.getTime() - runStart.getTime(),
      attempted,
      succeeded,
      failed,
    });

    return report;
  }

  /** Distribute a single task to the appropriate channels. */
  async distributeContent(task: DistributionTask): Promise<DistributionResult[]> {
    const channels = await this.selectChannels(task);
    if (channels.length === 0) {
      logger.warn('No eligible channels for content', { contentId: task.contentId, category: task.category });
      return [];
    }

    const optimalTime = this.calculateOptimalTiming(channels);
    logger.info('Distributing content', {
      contentId: task.contentId,
      channels: channels.map(c => c.type),
      scheduledTime: optimalTime,
    });

    const results: DistributionResult[] = [];

    for (const channel of channels) {
      const start = Date.now();
      const formatted = this.adaptContent(task, channel);
      const utmUrl = this.buildUtmUrl(task.canonicalUrl, channel, task.contentId);

      if (!this.checkRateLimit(channel.id)) {
        results.push({
          taskId: task.id, contentId: task.contentId,
          channelId: channel.id, channelType: channel.type,
          status: 'rate_limited', formattedContent: formatted,
          errorMessage: 'Channel rate limit exceeded',
          reachEstimate: 0, engagementEstimate: 0,
          utmUrl, durationMs: Date.now() - start,
        });
        continue;
      }

      try {
        // Simulate API call to channel
        const externalId = await this.postToChannel(channel, formatted, utmUrl, task.imageUrl);
        this.incrementRateLimit(channel.id);
        channel.lastPostedAt = new Date();
        channel.totalPosts++;

        const reachEstimate = Math.floor(channel.audienceSize * (0.05 + Math.random() * 0.15));
        const engagementEstimate = Math.floor(reachEstimate * channel.avgEngagementRate * (0.8 + Math.random() * 0.4));
        channel.totalReach += reachEstimate;
        channel.totalEngagement += engagementEstimate;

        // Simulate tracking engagement
        this.trackEngagement({
          channelId: channel.id,
          contentId: task.contentId,
          impressions: reachEstimate,
          clicks: Math.floor(reachEstimate * 0.025),
          likes: Math.floor(engagementEstimate * 0.6),
          shares: Math.floor(engagementEstimate * 0.2),
          comments: Math.floor(engagementEstimate * 0.2),
          ctr: 0.025,
          engagementRate: channel.avgEngagementRate,
          reach: reachEstimate,
          estimatedLeadsGenerated: Math.floor(reachEstimate * 0.001),
          estimatedConversions: Math.floor(reachEstimate * 0.0005),
          measuredAt: new Date(),
        });

        results.push({
          taskId: task.id, contentId: task.contentId,
          channelId: channel.id, channelType: channel.type,
          status: 'success', formattedContent: formatted,
          postedAt: new Date(), externalPostId: externalId,
          reachEstimate, engagementEstimate,
          utmUrl, durationMs: Date.now() - start,
        });

        logger.info('Content distributed successfully', {
          contentId: task.contentId,
          channel: channel.type,
          reachEstimate,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          taskId: task.id, contentId: task.contentId,
          channelId: channel.id, channelType: channel.type,
          status: 'failed', formattedContent: formatted,
          errorMessage: message, reachEstimate: 0, engagementEstimate: 0,
          utmUrl, durationMs: Date.now() - start,
        });
        logger.error('Channel distribution failed', undefined, { contentId: task.contentId, channel: channel.type, error: message });
      }
    }

    return results;
  }

  /** Calculate optimal posting time across a set of channels. */
  calculateOptimalTiming(channels: ChannelConfig[]): Date {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    // Score each hour in the next 24h
    const hourScores: number[] = new Array(24).fill(0);

    for (let h = 0; h < 24; h++) {
      const candidateHour = (currentHour + h) % 24;
      const candidateDay = (currentDay + Math.floor((currentHour + h) / 24)) % 7;

      for (const channel of channels) {
        const hourScore = channel.peakHours.includes(candidateHour) ? 1.5 : 0.7;
        const dayScore = channel.peakDays.includes(candidateDay) ? 1.3 : 0.8;
        hourScores[h] += hourScore * dayScore * channel.audienceSize;
      }
    }

    const bestOffset = hourScores.indexOf(Math.max(...hourScores));
    const optimalTime = new Date(now.getTime() + bestOffset * 3_600_000);

    logger.info('Optimal posting time calculated', {
      bestOffsetHours: bestOffset,
      optimalTime: optimalTime.toISOString(),
      channelCount: channels.length,
    });

    return optimalTime;
  }

  /** Select eligible channels for a given distribution task. */
  async selectChannels(task: DistributionTask): Promise<ChannelConfig[]> {
    const cacheKey = `dist:channels:${task.contentId}:${task.category}`;
    const cached = await cache.get<ChannelConfig[]>(cacheKey);
    if (cached) return cached;

    const eligible = [...this.channels.values()].filter(ch => {
      if (!ch.enabled) return false;
      if (task.targetChannels?.length && !task.targetChannels.includes(ch.type)) return false;
      if (!this.checkRateLimit(ch.id)) return false;
      return true;
    });

    // Score channels by affinity to content category
    const scored = eligible.map(ch => ({
      channel: ch,
      score: (ch.contentAffinity[task.category] ?? 0.3) * ch.avgEngagementRate * 100,
    }));

    scored.sort((a, b) => b.score - a.score);

    // Select top channels (max 5)
    const selected = scored.slice(0, 5).map(s => s.channel);

    await cache.set(cacheKey, selected, 300);
    logger.info('Channels selected', {
      contentId: task.contentId,
      category: task.category,
      selectedChannels: selected.map(c => c.type),
    });

    return selected;
  }

  /** Adapt content format for the target channel. */
  adaptContent(task: DistributionTask, channel: ChannelConfig): string {
    let content = '';

    switch (channel.type) {
      case 'twitter': {
        const maxLen = (channel.maxCharacters ?? 280) - 25; // reserve room for URL
        const snippet = task.summary.length > maxLen
          ? task.summary.slice(0, maxLen - 3) + '...'
          : task.summary;
        const tags = task.tags.slice(0, 3).map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
        content = `${snippet} ${tags}`.trim();
        break;
      }

      case 'linkedin': {
        content = `**${task.title}**\n\n${task.summary}\n\n` +
          task.tags.slice(0, 5).map(t => `#${t.replace(/\s+/g, '')}`).join(' ') +
          `\n\nRead more 👇`;
        if (content.length > (channel.maxCharacters ?? 3000)) {
          content = content.slice(0, (channel.maxCharacters ?? 3000) - 3) + '...';
        }
        break;
      }

      case 'facebook': {
        content = `${task.title}\n\n${task.summary}`;
        if (content.length > (channel.maxCharacters ?? 63_206)) {
          content = content.slice(0, (channel.maxCharacters ?? 63_206) - 3) + '...';
        }
        break;
      }

      case 'email': {
        content = `Subject: ${task.title}\n\n${task.body.slice(0, 800)}` +
          (task.body.length > 800 ? '...\n\n[Read the full article]' : '');
        break;
      }

      case 'rss':
      case 'api_partner': {
        content = JSON.stringify({
          title: task.title,
          summary: task.summary,
          body: task.body,
          author: task.author,
          publishedAt: task.publishedAt.toISOString(),
          tags: task.tags,
          category: task.category,
          imageUrl: task.imageUrl,
        });
        break;
      }

      case 'slack':
      case 'telegram': {
        const emoji = task.priority === 'breaking' ? '🚨' : task.category === 'technology' ? '💻' : '📰';
        content = `${emoji} *${task.title}*\n${task.summary.slice(0, 300)}`;
        if (task.summary.length > 300) content += '...';
        break;
      }

      case 'instagram': {
        const caption = `${task.title}\n\n${task.summary.slice(0, 200)}\n\n` +
          task.tags.slice(0, 10).map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
        content = caption.slice(0, channel.maxCharacters ?? 2200);
        break;
      }

      default:
        content = `${task.title}\n\n${task.summary}`;
    }

    return content;
  }

  /** Record engagement metrics for a distribution. */
  trackEngagement(metrics: EngagementMetrics): void {
    const existing = this.engagementStore.get(metrics.channelId) ?? [];
    existing.push(metrics);
    // Keep last 1000 entries per channel
    if (existing.length > 1000) existing.splice(0, existing.length - 1000);
    this.engagementStore.set(metrics.channelId, existing);
    logger.info('Engagement tracked', {
      channelId: metrics.channelId,
      contentId: metrics.contentId,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      engagementRate: metrics.engagementRate,
    });
  }

  /** Calculate ROI for all channels over a given period. */
  calculateROI(period: { start: Date; end: Date }): ROIReport[] {
    const reports: ROIReport[] = [];

    for (const channel of this.channels.values()) {
      const metrics = this.engagementStore.get(channel.id) ?? [];
      const periodMetrics = metrics.filter(
        m => m.measuredAt >= period.start && m.measuredAt <= period.end,
      );

      const totalPosts = periodMetrics.length;
      const totalCost = totalPosts * channel.costPerPost;
      const totalReach = periodMetrics.reduce((s, m) => s + m.reach, 0);
      const totalClicks = periodMetrics.reduce((s, m) => s + m.clicks, 0);
      const totalEngagement = periodMetrics.reduce((s, m) => s + m.likes + m.shares + m.comments, 0);
      const totalLeads = periodMetrics.reduce((s, m) => s + m.estimatedLeadsGenerated, 0);
      const estimatedRevenue = totalLeads * 45;  // $45 avg lead value

      const roi = totalCost > 0 ? ((estimatedRevenue - totalCost) / totalCost) * 100 : 0;
      const cpc = totalClicks > 0 ? totalCost / totalClicks : 0;
      const cpm = totalReach > 0 ? (totalCost / totalReach) * 1000 : 0;

      // Best/worst category by engagement
      const catEngagement = new Map<string, number>();
      for (const m of periodMetrics) {
        const cat = 'general';  // would be looked up from content store in production
        catEngagement.set(cat, (catEngagement.get(cat) ?? 0) + m.engagementRate);
      }
      const sortedCats = [...catEngagement.entries()].sort((a, b) => b[1] - a[1]);

      const recommendations: string[] = [];
      if (roi < 0) recommendations.push('Consider reducing post frequency or reallocating budget to higher-ROI channels.');
      if (cpc > 5) recommendations.push('CPC is high; test more targeted content or different posting times.');
      if (channel.avgEngagementRate < 0.02) recommendations.push('Low engagement rate; try richer media formats or shorter content.');
      if (totalPosts === 0) recommendations.push('No posts in this period; verify channel is enabled and rate limits are not blocking.');

      reports.push({
        channelId: channel.id,
        channelType: channel.type,
        period,
        totalPosts,
        totalCost: Math.round(totalCost * 100) / 100,
        totalReach,
        totalClicks,
        totalEngagement,
        estimatedRevenue: Math.round(estimatedRevenue * 100) / 100,
        roi: Math.round(roi * 10) / 10,
        cpc: Math.round(cpc * 100) / 100,
        cpm: Math.round(cpm * 100) / 100,
        bestPerformingCategory: sortedCats[0]?.[0] ?? 'n/a',
        worstPerformingCategory: sortedCats[sortedCats.length - 1]?.[0] ?? 'n/a',
        recommendations,
      });
    }

    reports.sort((a, b) => b.roi - a.roi);
    logger.info('ROI calculated for all channels', { channelCount: reports.length });
    return reports;
  }

  /** Get a full distribution report for current state. */
  getDistributionReport(): DistributionReport {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    return {
      agentId: this.agentId,
      runId: 'live',
      period: { start: dayAgo, end: now },
      tasksProcessed: this.totalDistributed,
      distributionsAttempted: this.totalDistributed,
      distributionsSucceeded: this.totalDistributed,
      distributionsFailed: 0,
      channelBreakdown: this.buildChannelBreakdown(),
      roiReports: this.calculateROI({ start: dayAgo, end: now }),
      topContentByEngagement: this.topContentByEngagement(5),
      errors: [],
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private initDefaultChannels(): void {
    const defaults: ChannelConfig[] = [
      {
        id: 'twitter_main', name: 'Twitter/X Main', type: 'twitter', enabled: true,
        maxCharacters: 280, supportsImages: true, supportsLinks: true, supportsMarkdown: false,
        contentAffinity: { technology: 0.9, science: 0.8, politics: 0.7, sports: 0.8, general: 0.6 },
        audienceSize: 15_000, avgEngagementRate: 0.035, costPerPost: 0,
        peakHours: [8, 9, 12, 17, 18, 20], peakDays: [1, 2, 3, 4, 5],
        utmSource: 'twitter', utmMedium: 'social', credentials: {},
        rateLimit: { postsPerHour: 50, postsPerDay: 300 },
        totalPosts: 0, totalEngagement: 0, totalReach: 0,
      },
      {
        id: 'linkedin_page', name: 'LinkedIn Company Page', type: 'linkedin', enabled: true,
        maxCharacters: 3000, supportsImages: true, supportsLinks: true, supportsMarkdown: true,
        contentAffinity: { technology: 0.95, business: 0.9, science: 0.7, general: 0.5 },
        audienceSize: 8_500, avgEngagementRate: 0.055, costPerPost: 0,
        peakHours: [7, 8, 10, 12, 17], peakDays: [2, 3, 4],
        utmSource: 'linkedin', utmMedium: 'social', credentials: {},
        rateLimit: { postsPerHour: 20, postsPerDay: 100 },
        totalPosts: 0, totalEngagement: 0, totalReach: 0,
      },
      {
        id: 'email_newsletter', name: 'Email Newsletter', type: 'email', enabled: true,
        supportsImages: true, supportsLinks: true, supportsMarkdown: true,
        contentAffinity: { technology: 0.8, science: 0.8, business: 0.85, general: 0.7 },
        audienceSize: 22_000, avgEngagementRate: 0.28, costPerPost: 0.05,
        peakHours: [6, 7, 8, 18, 19], peakDays: [2, 4],
        utmSource: 'email', utmMedium: 'newsletter', credentials: {},
        rateLimit: { postsPerHour: 10, postsPerDay: 50 },
        totalPosts: 0, totalEngagement: 0, totalReach: 0,
      },
      {
        id: 'rss_feed', name: 'RSS Feed', type: 'rss', enabled: true,
        supportsImages: true, supportsLinks: true, supportsMarkdown: false,
        contentAffinity: { technology: 0.8, science: 0.8, general: 0.8, politics: 0.7 },
        audienceSize: 5_000, avgEngagementRate: 0.12, costPerPost: 0,
        peakHours: [6, 7, 8, 9, 18, 19, 20], peakDays: [0, 1, 2, 3, 4, 5, 6],
        utmSource: 'rss', utmMedium: 'feed', credentials: {},
        rateLimit: { postsPerHour: 100, postsPerDay: 500 },
        totalPosts: 0, totalEngagement: 0, totalReach: 0,
      },
      {
        id: 'slack_community', name: 'Slack Community', type: 'slack', enabled: true,
        maxCharacters: 4000, supportsImages: true, supportsLinks: true, supportsMarkdown: true,
        contentAffinity: { technology: 0.95, science: 0.8, business: 0.7, general: 0.4 },
        audienceSize: 1_200, avgEngagementRate: 0.15, costPerPost: 0,
        peakHours: [9, 10, 11, 14, 15, 16], peakDays: [1, 2, 3, 4, 5],
        utmSource: 'slack', utmMedium: 'community', credentials: {},
        rateLimit: { postsPerHour: 2, postsPerDay: 10 },
        totalPosts: 0, totalEngagement: 0, totalReach: 0,
      },
      {
        id: 'api_partner_syndicate', name: 'API Partner Network', type: 'api_partner', enabled: true,
        supportsImages: true, supportsLinks: true, supportsMarkdown: true,
        contentAffinity: { technology: 0.85, science: 0.85, business: 0.8, general: 0.75 },
        audienceSize: 45_000, avgEngagementRate: 0.04, costPerPost: 0.10,
        peakHours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        peakDays: [0, 1, 2, 3, 4, 5, 6],
        utmSource: 'api_partner', utmMedium: 'syndication', credentials: {},
        rateLimit: { postsPerHour: 20, postsPerDay: 100 },
        totalPosts: 0, totalEngagement: 0, totalReach: 0,
      },
    ];

    for (const ch of defaults) {
      if (!ch.rateLimit) ch.rateLimit = { postsPerHour: 10, postsPerDay: 50 };
      this.channels.set(ch.id, ch);
    }
  }

  private async postToChannel(
    channel: ChannelConfig,
    content: string,
    utmUrl: string,
    imageUrl?: string,
  ): Promise<string> {
    // Simulate network latency and API call
    await new Promise(r => setTimeout(r, 50 + Math.random() * 150));
    // Simulate rare failures
    if (Math.random() < 0.02) throw new Error(`${channel.type} API temporarily unavailable`);
    return `ext_${channel.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildUtmUrl(canonicalUrl: string, channel: ChannelConfig, contentId: string): string {
    const base = canonicalUrl.includes('?') ? `${canonicalUrl}&` : `${canonicalUrl}?`;
    return `${base}utm_source=${channel.utmSource}&utm_medium=${channel.utmMedium}&utm_campaign=${contentId}&utm_content=${channel.id}`;
  }

  private checkRateLimit(channelId: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    const rl = channel.rateLimit ?? { postsPerHour: 10, postsPerDay: 50 };
    const counts = this.postCounts.get(channelId);
    if (!counts) return true;
    const now = Date.now();
    const hourReset = counts.hourReset < now;
    const dayReset = counts.dayReset < now;
    const hourCount = hourReset ? 0 : counts.hour;
    const dayCount = dayReset ? 0 : counts.day;
    return hourCount < rl.postsPerHour && dayCount < rl.postsPerDay;
  }

  private incrementRateLimit(channelId: string): void {
    const now = Date.now();
    const existing = this.postCounts.get(channelId) ?? {
      hour: 0, day: 0,
      hourReset: now + 3_600_000, dayReset: now + 86_400_000,
    };
    const hourReset = existing.hourReset < now;
    const dayReset = existing.dayReset < now;
    this.postCounts.set(channelId, {
      hour: hourReset ? 1 : existing.hour + 1,
      day: dayReset ? 1 : existing.day + 1,
      hourReset: hourReset ? now + 3_600_000 : existing.hourReset,
      dayReset: dayReset ? now + 86_400_000 : existing.dayReset,
    });
  }

  private buildChannelBreakdown(): DistributionReport['channelBreakdown'] {
    const breakdown: DistributionReport['channelBreakdown'] = {} as DistributionReport['channelBreakdown'];
    for (const ch of this.channels.values()) {
      breakdown[ch.type] = { posts: ch.totalPosts, reach: ch.totalReach, engagement: ch.totalEngagement };
    }
    return breakdown;
  }

  private topContentByEngagement(limit: number): Array<{ contentId: string; totalEngagement: number }> {
    const engagementByContent = new Map<string, number>();
    for (const metrics of this.engagementStore.values()) {
      for (const m of metrics) {
        engagementByContent.set(m.contentId, (engagementByContent.get(m.contentId) ?? 0) + m.likes + m.shares + m.comments);
      }
    }
    return [...engagementByContent.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([contentId, totalEngagement]) => ({ contentId, totalEngagement }));
  }

  private emptyReport(): DistributionReport {
    const now = new Date();
    return {
      agentId: this.agentId, runId: 'skipped',
      period: { start: now, end: now },
      tasksProcessed: 0, distributionsAttempted: 0,
      distributionsSucceeded: 0, distributionsFailed: 0,
      channelBreakdown: {} as DistributionReport['channelBreakdown'],
      roiReports: [], topContentByEngagement: [], errors: [],
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ContentDistributionAgent | null = null;

export function getInstance(): ContentDistributionAgent {
  if (!_instance) {
    _instance = new ContentDistributionAgent();
    logger.info('ContentDistributionAgent singleton created');
  }
  return _instance;
}

export default ContentDistributionAgent;
