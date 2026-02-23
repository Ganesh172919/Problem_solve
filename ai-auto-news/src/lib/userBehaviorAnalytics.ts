/**
 * User Behavior Analytics
 *
 * Provides:
 * - User behavior tracking: clicks, scrolls, time-on-page, hover events
 * - Session recording metadata
 * - Heatmap data collection (grid-based)
 * - Funnel analysis and drop-off detection
 * - User journey mapping and path analysis (most common paths using graph)
 * - Behavioral segmentation (power users, casual, at-risk)
 * - Persona detection
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface BehaviorEvent {
  id: string;
  sessionId: string;
  userId: string;
  type: 'click' | 'scroll' | 'hover' | 'page_view' | 'form_submit' | 'video_play' | 'search' | 'purchase' | 'custom';
  timestamp: Date;
  page: string;
  element?: string;
  x?: number;
  y?: number;
  scrollDepth?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  pageViews: number;
  events: BehaviorEvent[];
  entryPage: string;
  exitPage?: string;
  device: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  country: string;
  referrer?: string;
  converted: boolean;
  conversionValue?: number;
}

export interface HeatmapData {
  page: string;
  type: 'click' | 'scroll' | 'hover';
  gridWidth: number;
  gridHeight: number;
  cells: Record<string, number>; // "x,y" -> intensity
  maxIntensity: number;
  totalEvents: number;
  generatedAt: Date;
}

export interface FunnelStep {
  name: string;
  page: string;
  eventType: string;
  users: number;
  dropOff: number;
  dropOffRate: number;
  avgTimeToNext?: number;
}

export interface FunnelAnalysis {
  name: string;
  steps: FunnelStep[];
  totalEntrants: number;
  totalConverted: number;
  overallConversionRate: number;
  biggestDropOffStep: string;
  avgCompletionTime?: number;
}

export interface UserJourney {
  userId: string;
  sessionId: string;
  path: string[];
  events: BehaviorEvent[];
  entryPage: string;
  exitPage: string;
  converted: boolean;
  duration: number;
  touchpoints: number;
}

export interface PathNode {
  page: string;
  visits: number;
  nextPages: Record<string, number>; // page -> count
}

export interface BehaviorSegment {
  id: string;
  name: 'power_user' | 'casual' | 'at_risk' | 'new_user' | 'churned' | 'champion';
  description: string;
  userCount: number;
  criteria: Record<string, unknown>;
  avgSessionDuration: number;
  avgPageViews: number;
  conversionRate: number;
  userIds: string[];
}

export interface Persona {
  userId: string;
  segment: BehaviorSegment['name'];
  score: number;
  traits: {
    engagementLevel: 'high' | 'medium' | 'low';
    contentPreference: string[];
    peakActivityHour: number;
    devicePreference: 'desktop' | 'mobile' | 'tablet';
    avgScrollDepth: number;
    clickThroughRate: number;
    bounceRate: number;
  };
  predictedChurnRisk: number;
  predictedLTV: number;
  lastActiveAt: Date;
}

export interface DropOffPoint {
  page: string;
  eventType: string;
  beforeCount: number;
  afterCount: number;
  dropOffRate: number;
  avgTimeSpent: number;
  topExitElements: string[];
}

// ─── User Behavior Analytics ──────────────────────────────────────────────────

class UserBehaviorAnalytics {
  private events: BehaviorEvent[] = [];
  private sessions = new Map<string, Session>();
  private readonly HEATMAP_GRID_W = 50;
  private readonly HEATMAP_GRID_H = 40;
  private readonly CACHE_TTL = 300;

  constructor() {
    this.seedSampleData();
    logger.info('UserBehaviorAnalytics initialized');
  }

  // ─── Seeding ─────────────────────────────────────────────────────────────

  private seedSampleData(): void {
    const pages = ['/', '/pricing', '/features', '/blog', '/signup', '/login', '/dashboard', '/checkout'];
    const devices: Session['device'][] = ['desktop', 'mobile', 'tablet'];
    const countries = ['US', 'GB', 'DE', 'FR', 'CA'];
    const browsers = ['Chrome', 'Safari', 'Firefox', 'Edge'];
    const now = Date.now();

    for (let u = 0; u < 200; u++) {
      const userId = `user_${u.toString().padStart(4, '0')}`;
      const sessionsPerUser = Math.floor(1 + Math.random() * 6);

      for (let s = 0; s < sessionsPerUser; s++) {
        const sessionId = `sess_${u}_${s}`;
        const sessionStart = new Date(now - Math.random() * 30 * 86_400_000);
        const sessionDuration = Math.floor(60 + Math.random() * 900);
        const pageCount = Math.floor(1 + Math.random() * 8);
        const entryPage = pages[Math.floor(Math.random() * pages.length)];
        const exitPage = pages[Math.floor(Math.random() * pages.length)];
        const converted = Math.random() < 0.08;

        const sessionEvents: BehaviorEvent[] = [];
        for (let p = 0; p < pageCount; p++) {
          const page = pages[Math.floor(Math.random() * pages.length)];
          const evtTime = new Date(sessionStart.getTime() + p * (sessionDuration / pageCount) * 1000);

          // page view
          const pvt: BehaviorEvent = {
            id: `evt_${u}_${s}_${p}_pv`,
            sessionId,
            userId,
            type: 'page_view',
            timestamp: evtTime,
            page,
          };
          sessionEvents.push(pvt);
          this.events.push(pvt);

          // clicks
          const clickCount = Math.floor(Math.random() * 5);
          for (let c = 0; c < clickCount; c++) {
            const click: BehaviorEvent = {
              id: `evt_${u}_${s}_${p}_cl_${c}`,
              sessionId,
              userId,
              type: 'click',
              timestamp: new Date(evtTime.getTime() + c * 5000),
              page,
              x: Math.floor(Math.random() * 1440),
              y: Math.floor(Math.random() * 900),
              element: ['button.cta', 'a.nav-link', 'div.card', 'img.banner'][Math.floor(Math.random() * 4)],
            };
            sessionEvents.push(click);
            this.events.push(click);
          }

          // scroll
          const scroll: BehaviorEvent = {
            id: `evt_${u}_${s}_${p}_sc`,
            sessionId,
            userId,
            type: 'scroll',
            timestamp: new Date(evtTime.getTime() + 3000),
            page,
            scrollDepth: Math.floor(10 + Math.random() * 90),
          };
          sessionEvents.push(scroll);
          this.events.push(scroll);
        }

        const session: Session = {
          id: sessionId,
          userId,
          startTime: sessionStart,
          endTime: new Date(sessionStart.getTime() + sessionDuration * 1000),
          duration: sessionDuration,
          pageViews: pageCount,
          events: sessionEvents,
          entryPage,
          exitPage,
          device: devices[Math.floor(Math.random() * devices.length)],
          browser: browsers[Math.floor(Math.random() * browsers.length)],
          country: countries[Math.floor(Math.random() * countries.length)],
          converted,
          conversionValue: converted ? parseFloat((49 + Math.random() * 200).toFixed(2)) : undefined,
        };
        this.sessions.set(sessionId, session);
      }
    }
    logger.info('Seeded behavior data', { events: this.events.length, sessions: this.sessions.size });
  }

  // ─── Event Tracking ──────────────────────────────────────────────────────

  trackEvent(event: Omit<BehaviorEvent, 'id'>): BehaviorEvent {
    const full: BehaviorEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    this.events.push(full);

    // Update session
    const session = this.sessions.get(event.sessionId);
    if (session) {
      session.events.push(full);
      if (event.type === 'page_view') {
        session.pageViews++;
        session.exitPage = event.page;
      }
    }
    return full;
  }

  // ─── Session Recording ───────────────────────────────────────────────────

  recordSession(session: Omit<Session, 'events'>): Session {
    const full: Session = { ...session, events: [] };
    this.sessions.set(session.id, full);
    logger.info('Session recorded', { sessionId: session.id, userId: session.userId });
    return full;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  // ─── Heatmap ─────────────────────────────────────────────────────────────

  buildHeatmap(page: string, type: 'click' | 'scroll' | 'hover' = 'click'): HeatmapData {
    const cacheKey = `uba:heatmap:${page}:${type}`;
    const cached = cache.get<HeatmapData>(cacheKey);
    if (cached) return cached;

    const filtered = this.events.filter((e) => e.page === page && e.type === type);
    const cells: Record<string, number> = {};
    let maxIntensity = 0;

    for (const evt of filtered) {
      let cx: number, cy: number;
      if (type === 'scroll') {
        cx = Math.floor(this.HEATMAP_GRID_W / 2);
        cy = Math.floor(((evt.scrollDepth ?? 0) / 100) * this.HEATMAP_GRID_H);
      } else {
        cx = Math.floor(((evt.x ?? 0) / 1440) * this.HEATMAP_GRID_W);
        cy = Math.floor(((evt.y ?? 0) / 900) * this.HEATMAP_GRID_H);
      }
      const key = `${cx},${cy}`;
      cells[key] = (cells[key] ?? 0) + 1;
      if (cells[key] > maxIntensity) maxIntensity = cells[key];
    }

    const heatmap: HeatmapData = {
      page,
      type,
      gridWidth: this.HEATMAP_GRID_W,
      gridHeight: this.HEATMAP_GRID_H,
      cells,
      maxIntensity,
      totalEvents: filtered.length,
      generatedAt: new Date(),
    };

    cache.set(cacheKey, heatmap, this.CACHE_TTL);
    return heatmap;
  }

  // ─── Funnel Analysis ─────────────────────────────────────────────────────

  analyzeFunnel(
    name: string,
    steps: Array<{ name: string; page: string; eventType: string }>,
  ): FunnelAnalysis {
    const cacheKey = `uba:funnel:${name}`;
    const cached = cache.get<FunnelAnalysis>(cacheKey);
    if (cached) return cached;

    const allSessions = Array.from(this.sessions.values());
    const funnelSteps: FunnelStep[] = [];
    let prevUsers = allSessions.length;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const usersAtStep = allSessions.filter((s) =>
        s.events.some((e) => e.page === step.page && e.type === step.eventType),
      ).length;

      const nextUsersAtStep =
        i + 1 < steps.length
          ? allSessions.filter((s) =>
              s.events.some((e) => e.page === steps[i + 1].page && e.type === steps[i + 1].eventType),
            ).length
          : usersAtStep;

      const dropOff = usersAtStep - nextUsersAtStep;
      const dropOffRate = usersAtStep > 0 ? (dropOff / usersAtStep) * 100 : 0;

      // Avg time from previous step to this step
      let avgTimeToNext: number | undefined;
      if (i > 0) {
        const times: number[] = [];
        for (const s of allSessions) {
          const prevEvt = s.events.find(
            (e) => e.page === steps[i - 1].page && e.type === steps[i - 1].eventType,
          );
          const currEvt = s.events.find((e) => e.page === step.page && e.type === step.eventType);
          if (prevEvt && currEvt) {
            times.push(currEvt.timestamp.getTime() - prevEvt.timestamp.getTime());
          }
        }
        avgTimeToNext = times.length
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 1000)
          : undefined;
      }

      funnelSteps.push({
        name: step.name,
        page: step.page,
        eventType: step.eventType,
        users: usersAtStep,
        dropOff,
        dropOffRate: parseFloat(dropOffRate.toFixed(2)),
        avgTimeToNext,
      });
      prevUsers = usersAtStep;
    }

    const biggestDrop = funnelSteps.reduce((a, b) =>
      b.dropOffRate > a.dropOffRate ? b : a,
    );

    const totalConverted = funnelSteps[funnelSteps.length - 1]?.users ?? 0;
    const totalEntrants = funnelSteps[0]?.users ?? 0;
    const overallConversionRate =
      totalEntrants > 0 ? parseFloat(((totalConverted / totalEntrants) * 100).toFixed(2)) : 0;

    const analysis: FunnelAnalysis = {
      name,
      steps: funnelSteps,
      totalEntrants,
      totalConverted,
      overallConversionRate,
      biggestDropOffStep: biggestDrop.name,
    };

    cache.set(cacheKey, analysis, this.CACHE_TTL);
    return analysis;
  }

  // ─── Drop-off Detection ──────────────────────────────────────────────────

  getDropOffPoints(pages: string[]): DropOffPoint[] {
    const result: DropOffPoint[] = [];
    const allSessions = Array.from(this.sessions.values());

    for (let i = 0; i < pages.length - 1; i++) {
      const page = pages[i];
      const nextPage = pages[i + 1];

      const atPage = allSessions.filter((s) => s.events.some((e) => e.page === page));
      const atNext = allSessions.filter((s) => s.events.some((e) => e.page === nextPage));
      const dropOff = atPage.length - atNext.length;
      const dropOffRate = atPage.length > 0 ? (dropOff / atPage.length) * 100 : 0;

      const timeSpent = atPage.map((s) => {
        const enter = s.events.find((e) => e.page === page)?.timestamp;
        const exit = s.events.filter((e) => e.page === page).slice(-1)[0]?.timestamp;
        return enter && exit ? (exit.getTime() - enter.getTime()) / 1000 : 0;
      });
      const avgTimeSpent =
        timeSpent.length > 0
          ? Math.round(timeSpent.reduce((a, b) => a + b, 0) / timeSpent.length)
          : 0;

      // Top exit elements on this page
      const exitElements: Record<string, number> = {};
      for (const s of atPage) {
        const clicks = s.events.filter((e) => e.page === page && e.type === 'click');
        const lastClick = clicks[clicks.length - 1];
        if (lastClick?.element) {
          exitElements[lastClick.element] = (exitElements[lastClick.element] ?? 0) + 1;
        }
      }
      const topExitElements = Object.entries(exitElements)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([el]) => el);

      result.push({
        page,
        eventType: 'page_view',
        beforeCount: atPage.length,
        afterCount: atNext.length,
        dropOffRate: parseFloat(dropOffRate.toFixed(2)),
        avgTimeSpent,
        topExitElements,
      });
    }
    return result;
  }

  // ─── User Journey Mapping ────────────────────────────────────────────────

  mapUserJourney(sessionId: string): UserJourney | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const pageViews = session.events.filter((e) => e.type === 'page_view');
    const path = pageViews.map((e) => e.page);

    return {
      userId: session.userId,
      sessionId,
      path,
      events: session.events,
      entryPage: session.entryPage,
      exitPage: session.exitPage ?? path[path.length - 1] ?? '',
      converted: session.converted,
      duration: session.duration ?? 0,
      touchpoints: session.pageViews,
    };
  }

  // ─── Path Analysis (Graph-based) ─────────────────────────────────────────

  analyzeTopPaths(topN = 10): Array<{ path: string[]; count: number; conversionRate: number }> {
    const cacheKey = `uba:toppaths:${topN}`;
    const cached = cache.get<Array<{ path: string[]; count: number; conversionRate: number }>>(cacheKey);
    if (cached) return cached;

    const pathMap = new Map<string, { count: number; conversions: number }>();

    for (const session of this.sessions.values()) {
      const pageViews = session.events.filter((e) => e.type === 'page_view');
      const pathArr = pageViews.map((e) => e.page).slice(0, 6);
      if (pathArr.length === 0) continue;
      const key = pathArr.join(' → ');
      const existing = pathMap.get(key) ?? { count: 0, conversions: 0 };
      existing.count++;
      if (session.converted) existing.conversions++;
      pathMap.set(key, existing);
    }

    const sorted = Array.from(pathMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, topN)
      .map(([key, data]) => ({
        path: key.split(' → '),
        count: data.count,
        conversionRate: data.count > 0
          ? parseFloat(((data.conversions / data.count) * 100).toFixed(2))
          : 0,
      }));

    cache.set(cacheKey, sorted, this.CACHE_TTL);
    return sorted;
  }

  buildPathGraph(): Map<string, PathNode> {
    const graph = new Map<string, PathNode>();

    for (const session of this.sessions.values()) {
      const pageViews = session.events.filter((e) => e.type === 'page_view');
      for (let i = 0; i < pageViews.length; i++) {
        const page = pageViews[i].page;
        if (!graph.has(page)) {
          graph.set(page, { page, visits: 0, nextPages: {} });
        }
        const node = graph.get(page)!;
        node.visits++;
        if (i + 1 < pageViews.length) {
          const next = pageViews[i + 1].page;
          node.nextPages[next] = (node.nextPages[next] ?? 0) + 1;
        }
      }
    }
    return graph;
  }

  // ─── Behavioral Segmentation ─────────────────────────────────────────────

  segmentUsers(): BehaviorSegment[] {
    const cacheKey = 'uba:segments';
    const cached = cache.get<BehaviorSegment[]>(cacheKey);
    if (cached) return cached;

    const userMap = new Map<string, Session[]>();
    for (const session of this.sessions.values()) {
      const existing = userMap.get(session.userId) ?? [];
      existing.push(session);
      userMap.set(session.userId, existing);
    }

    const segmentMap: Record<BehaviorSegment['name'], string[]> = {
      power_user: [],
      casual: [],
      at_risk: [],
      new_user: [],
      churned: [],
      champion: [],
    };
    const statsMap: Record<BehaviorSegment['name'], { sessions: number[]; pageViews: number[]; conversions: number }> = {
      power_user: { sessions: [], pageViews: [], conversions: 0 },
      casual: { sessions: [], pageViews: [], conversions: 0 },
      at_risk: { sessions: [], pageViews: [], conversions: 0 },
      new_user: { sessions: [], pageViews: [], conversions: 0 },
      churned: { sessions: [], pageViews: [], conversions: 0 },
      champion: { sessions: [], pageViews: [], conversions: 0 },
    };

    const now = Date.now();
    const thirtyDays = 30 * 86_400_000;

    for (const [userId, sessions] of userMap) {
      const sessionCount = sessions.length;
      const avgDuration = sessions.reduce((a, s) => a + (s.duration ?? 0), 0) / sessionCount;
      const avgPages = sessions.reduce((a, s) => a + s.pageViews, 0) / sessionCount;
      const lastActive = Math.max(...sessions.map((s) => s.startTime.getTime()));
      const daysSinceActive = (now - lastActive) / 86_400_000;
      const hasConverted = sessions.some((s) => s.converted);
      const isNew = sessions.every((s) => now - s.startTime.getTime() < thirtyDays);

      let segment: BehaviorSegment['name'];
      if (hasConverted && avgDuration > 300 && sessionCount > 4) {
        segment = 'champion';
      } else if (sessionCount > 8 || avgDuration > 600) {
        segment = 'power_user';
      } else if (daysSinceActive > 60) {
        segment = 'churned';
      } else if (daysSinceActive > 30 && sessionCount > 2) {
        segment = 'at_risk';
      } else if (isNew) {
        segment = 'new_user';
      } else {
        segment = 'casual';
      }

      segmentMap[segment].push(userId);
      statsMap[segment].sessions.push(avgDuration);
      statsMap[segment].pageViews.push(avgPages);
      if (hasConverted) statsMap[segment].conversions++;
    }

    const segmentDescriptions: Record<BehaviorSegment['name'], string> = {
      power_user: 'Highly engaged users with many sessions and long durations',
      casual: 'Occasional visitors with moderate engagement',
      at_risk: 'Previously active users showing declining engagement',
      new_user: 'Users acquired in the last 30 days',
      churned: 'Users inactive for 60+ days',
      champion: 'Converted power users driving advocacy',
    };

    const segments: BehaviorSegment[] = (Object.keys(segmentMap) as BehaviorSegment['name'][]).map(
      (name) => {
        const userIds = segmentMap[name];
        const stats = statsMap[name];
        const avgSessionDuration = stats.sessions.length
          ? Math.round(stats.sessions.reduce((a, b) => a + b, 0) / stats.sessions.length)
          : 0;
        const avgPageViews = stats.pageViews.length
          ? parseFloat((stats.pageViews.reduce((a, b) => a + b, 0) / stats.pageViews.length).toFixed(1))
          : 0;
        const conversionRate =
          userIds.length > 0
            ? parseFloat(((stats.conversions / userIds.length) * 100).toFixed(2))
            : 0;

        return {
          id: `seg_${name}`,
          name,
          description: segmentDescriptions[name],
          userCount: userIds.length,
          criteria: { segment: name },
          avgSessionDuration,
          avgPageViews,
          conversionRate,
          userIds,
        };
      },
    );

    cache.set(cacheKey, segments, this.CACHE_TTL);
    return segments;
  }

  // ─── Persona Detection ───────────────────────────────────────────────────

  detectPersona(userId: string): Persona | null {
    const cacheKey = `uba:persona:${userId}`;
    const cached = cache.get<Persona>(cacheKey);
    if (cached) return cached;

    const userSessions = Array.from(this.sessions.values()).filter((s) => s.userId === userId);
    if (!userSessions.length) return null;

    const allEvents = userSessions.flatMap((s) => s.events);
    const clicks = allEvents.filter((e) => e.type === 'click');
    const scrolls = allEvents.filter((e) => e.type === 'scroll');
    const pageViews = allEvents.filter((e) => e.type === 'page_view');
    const avgScrollDepth =
      scrolls.length > 0
        ? Math.round(scrolls.reduce((a, e) => a + (e.scrollDepth ?? 0), 0) / scrolls.length)
        : 0;

    const ctr = pageViews.length > 0 ? parseFloat(((clicks.length / pageViews.length)).toFixed(2)) : 0;

    // Peak activity hour
    const hourCounts: Record<number, number> = {};
    for (const evt of allEvents) {
      const h = evt.timestamp.getHours();
      hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    }
    const peakActivityHour = Number(
      Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12,
    );

    // Device preference
    const deviceCounts: Record<string, number> = {};
    for (const s of userSessions) {
      deviceCounts[s.device] = (deviceCounts[s.device] ?? 0) + 1;
    }
    const devicePreference = (Object.entries(deviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      'desktop') as Session['device'];

    // Content preference from pages
    const pageCounts: Record<string, number> = {};
    for (const e of pageViews) {
      pageCounts[e.page] = (pageCounts[e.page] ?? 0) + 1;
    }
    const contentPreference = Object.entries(pageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([page]) => page);

    const totalSessions = userSessions.length;
    const avgDuration = userSessions.reduce((a, s) => a + (s.duration ?? 0), 0) / totalSessions;
    const bounceRate = parseFloat(
      ((userSessions.filter((s) => s.pageViews === 1).length / totalSessions) * 100).toFixed(2),
    );

    const engagementScore = Math.min(
      100,
      totalSessions * 5 + avgDuration / 60 + avgScrollDepth / 2,
    );
    const engagementLevel: Persona['traits']['engagementLevel'] =
      engagementScore > 60 ? 'high' : engagementScore > 30 ? 'medium' : 'low';

    // Determine segment
    const segments = this.segmentUsers();
    const segment =
      segments.find((s) => s.userIds.includes(userId))?.name ?? 'casual';

    const lastActive = new Date(Math.max(...userSessions.map((s) => s.startTime.getTime())));
    const daysSinceActive = (Date.now() - lastActive.getTime()) / 86_400_000;
    const predictedChurnRisk = Math.min(
      100,
      parseFloat((daysSinceActive * 2 + (100 - engagementScore) * 0.5).toFixed(1)),
    );
    const predictedLTV = parseFloat(
      (
        totalSessions * avgDuration * 0.05 +
        userSessions.reduce((a, s) => a + (s.conversionValue ?? 0), 0) * 1.5
      ).toFixed(2),
    );

    const persona: Persona = {
      userId,
      segment,
      score: parseFloat(engagementScore.toFixed(1)),
      traits: {
        engagementLevel,
        contentPreference,
        peakActivityHour,
        devicePreference,
        avgScrollDepth,
        clickThroughRate: ctr,
        bounceRate,
      },
      predictedChurnRisk,
      predictedLTV,
      lastActiveAt: lastActive,
    };

    cache.set(cacheKey, persona, this.CACHE_TTL);
    return persona;
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  getEventCount(): number { return this.events.length; }
  getSessionCount(): number { return this.sessions.size; }

  getPageStats(): Array<{ page: string; views: number; uniqueUsers: number; avgScrollDepth: number }> {
    const pageMap = new Map<string, { views: number; users: Set<string>; scrolls: number[] }>();
    for (const evt of this.events) {
      if (!pageMap.has(evt.page)) {
        pageMap.set(evt.page, { views: 0, users: new Set(), scrolls: [] });
      }
      const p = pageMap.get(evt.page)!;
      if (evt.type === 'page_view') {
        p.views++;
        p.users.add(evt.userId);
      }
      if (evt.type === 'scroll' && evt.scrollDepth !== undefined) {
        p.scrolls.push(evt.scrollDepth);
      }
    }
    return Array.from(pageMap.entries()).map(([page, data]) => ({
      page,
      views: data.views,
      uniqueUsers: data.users.size,
      avgScrollDepth: data.scrolls.length
        ? Math.round(data.scrolls.reduce((a, b) => a + b, 0) / data.scrolls.length)
        : 0,
    })).sort((a, b) => b.views - a.views);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getUserBehaviorAnalytics(): UserBehaviorAnalytics {
  if (!(globalThis as any).__userBehaviorAnalytics__) {
    (globalThis as any).__userBehaviorAnalytics__ = new UserBehaviorAnalytics();
  }
  return (globalThis as any).__userBehaviorAnalytics__;
}
