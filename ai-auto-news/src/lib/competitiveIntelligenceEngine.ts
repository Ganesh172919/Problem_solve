/**
 * Competitive Intelligence Engine
 *
 * Provides:
 * - Competitive intelligence: market position tracking, feature comparison matrix
 * - Pricing benchmarking (relative position calculation)
 * - Market share estimation using weighted signals
 * - SWOT analysis generation based on metrics
 * - Competitor content strategy analysis (frequency, topics, format)
 * - Strategic recommendations engine (rule-based with scoring)
 */

import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  foundedYear?: number;
  employeeCount?: number;
  fundingStage?: 'bootstrapped' | 'seed' | 'seriesA' | 'seriesB' | 'seriesC' | 'public';
  fundingAmount?: number; // USD
  monthlyVisitors?: number;
  pricing?: {
    model: 'free' | 'freemium' | 'subscription' | 'usage-based' | 'enterprise';
    lowestTier?: number; // USD/month
    highestTier?: number;
    hasFree: boolean;
  };
  features: string[];
  targetMarket: string[];
  geographies: string[];
  metadata: Record<string, unknown>;
  addedAt: Date;
  updatedAt: Date;
}

export interface FeatureMatrix {
  features: string[];
  competitors: Array<{
    competitorId: string;
    competitorName: string;
    coverage: Record<string, 'yes' | 'no' | 'partial' | 'unknown'>;
    coverageScore: number; // 0-100
  }>;
  ourCoverage: Record<string, 'yes' | 'no' | 'partial'>;
  gaps: string[]; // features we lack that ≥50% competitors have
  advantages: string[]; // features we have that <30% competitors have
  generatedAt: Date;
}

export interface PricingBenchmark {
  ourPrice: number;
  competitorPrices: Array<{
    competitorId: string;
    name: string;
    price: number;
    model: string;
  }>;
  marketAverage: number;
  marketMedian: number;
  percentile: number; // our price percentile in market (0-100, lower = cheaper)
  relativePosition: 'budget' | 'below-average' | 'average' | 'above-average' | 'premium';
  pricingGap: number; // our price minus market average
  recommendations: string[];
  generatedAt: Date;
}

export interface MarketShareEstimate {
  competitorId: string;
  name: string;
  estimatedShare: number; // 0-100 percentage
  signals: Array<{
    type: 'traffic' | 'social' | 'funding' | 'employees' | 'reviews' | 'backlinks';
    weight: number;
    rawValue: number;
    normalizedValue: number;
  }>;
  confidence: 'low' | 'medium' | 'high';
  trend: 'growing' | 'stable' | 'declining';
  updatedAt: Date;
}

export interface SWOTAnalysis {
  competitorId: string;
  name: string;
  strengths: Array<{ factor: string; evidence: string; weight: number }>;
  weaknesses: Array<{ factor: string; evidence: string; weight: number }>;
  opportunities: Array<{ factor: string; evidence: string; potential: 'low' | 'medium' | 'high' }>;
  threats: Array<{ factor: string; evidence: string; severity: 'low' | 'medium' | 'high' }>;
  overallThreatLevel: 'low' | 'moderate' | 'high' | 'critical';
  generatedAt: Date;
}

export interface ContentStrategy {
  competitorId: string;
  name: string;
  publishingFrequency: {
    postsPerWeek: number;
    consistency: 'irregular' | 'moderate' | 'consistent' | 'very-consistent';
  };
  topTopics: Array<{ topic: string; frequency: number; avgEngagement: number }>;
  formats: Array<{ format: 'article' | 'video' | 'podcast' | 'infographic' | 'webinar' | 'case-study' | 'whitepaper'; share: number }>;
  avgWordCount: number;
  seoFocus: 'low' | 'medium' | 'high';
  socialPresence: Record<string, { followers: number; engagementRate: number }>;
  contentScore: number; // 0-100
  analyzedAt: Date;
}

export interface StrategicRecommendation {
  id: string;
  category: 'pricing' | 'features' | 'content' | 'market' | 'positioning' | 'partnership';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  rationale: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  score: number; // effort-impact score 0-100
  relatedCompetitors: string[];
  actions: string[];
  estimatedTimeframe: string;
  generatedAt: Date;
}

export interface MarketPosition {
  ourPosition: {
    featureCoverageScore: number;
    pricingPercentile: number;
    estimatedMarketShare: number;
    contentScore: number;
    overallScore: number;
  };
  rankings: Array<{
    competitorId: string;
    name: string;
    overallScore: number;
    rank: number;
  }>;
  generatedAt: Date;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class CompetitiveIntelligenceEngine {
  private competitors: Map<string, Competitor> = new Map();
  private contentStrategies: Map<string, ContentStrategy> = new Map();
  private ourFeatures: Set<string> = new Set();
  private ourPricePerMonth = 0;

  // ─── Competitor Management ────────────────────────────────────────────────

  addCompetitor(competitor: Omit<Competitor, 'addedAt' | 'updatedAt'>): Competitor {
    const now = new Date();
    const full: Competitor = { ...competitor, addedAt: now, updatedAt: now };
    this.competitors.set(full.id, full);
    logger.info('Competitor added', { id: full.id, name: full.name });
    return full;
  }

  updateCompetitor(id: string, updates: Partial<Competitor>): Competitor | null {
    const existing = this.competitors.get(id);
    if (!existing) return null;
    const updated: Competitor = { ...existing, ...updates, id, addedAt: existing.addedAt, updatedAt: new Date() };
    this.competitors.set(id, updated);
    return updated;
  }

  getCompetitor(id: string): Competitor | undefined {
    return this.competitors.get(id);
  }

  setOurFeatures(features: string[]): void {
    this.ourFeatures = new Set(features.map((f) => f.toLowerCase().trim()));
  }

  setOurPrice(pricePerMonth: number): void {
    this.ourPricePerMonth = pricePerMonth;
  }

  // ─── Feature Matrix ───────────────────────────────────────────────────────

  buildFeatureMatrix(): FeatureMatrix {
    const cacheKey = 'feature_matrix';
    const cached = cache.get<FeatureMatrix>(cacheKey);
    if (cached) return cached;

    const allFeatures = new Set<string>();
    this.competitors.forEach((c) => c.features.forEach((f) => allFeatures.add(f.toLowerCase().trim())));
    this.ourFeatures.forEach((f) => allFeatures.add(f));
    const featureList = Array.from(allFeatures).sort();

    const competitorData = Array.from(this.competitors.values()).map((c) => {
      const cFeatures = new Set(c.features.map((f) => f.toLowerCase().trim()));
      const coverage: Record<string, 'yes' | 'no' | 'partial' | 'unknown'> = {};
      let yesCount = 0;
      featureList.forEach((f) => {
        if (cFeatures.has(f)) { coverage[f] = 'yes'; yesCount++; }
        else { coverage[f] = 'no'; }
      });
      return {
        competitorId: c.id,
        competitorName: c.name,
        coverage,
        coverageScore: featureList.length > 0 ? Math.round((yesCount / featureList.length) * 100) : 0,
      };
    });

    const ourCoverage: Record<string, 'yes' | 'no' | 'partial'> = {};
    featureList.forEach((f) => {
      ourCoverage[f] = this.ourFeatures.has(f) ? 'yes' : 'no';
    });

    const competitorCount = this.competitors.size;
    const gaps: string[] = [];
    const advantages: string[] = [];

    featureList.forEach((feature) => {
      const competitorHaveIt = competitorData.filter((c) => c.coverage[feature] === 'yes').length;
      const share = competitorCount > 0 ? competitorHaveIt / competitorCount : 0;
      if (share >= 0.5 && ourCoverage[feature] === 'no') gaps.push(feature);
      if (share < 0.3 && ourCoverage[feature] === 'yes') advantages.push(feature);
    });

    const matrix: FeatureMatrix = {
      features: featureList,
      competitors: competitorData,
      ourCoverage,
      gaps,
      advantages,
      generatedAt: new Date(),
    };

    cache.set(cacheKey, matrix, 600);
    return matrix;
  }

  // ─── Pricing Benchmarking ─────────────────────────────────────────────────

  benchmarkPricing(ourPriceOverride?: number): PricingBenchmark {
    const ourPrice = ourPriceOverride ?? this.ourPricePerMonth;
    const competitorPrices = Array.from(this.competitors.values())
      .filter((c) => c.pricing?.lowestTier !== undefined)
      .map((c) => ({
        competitorId: c.id,
        name: c.name,
        price: c.pricing!.lowestTier!,
        model: c.pricing!.model,
      }));

    const prices = competitorPrices.map((c) => c.price);
    const marketAverage = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const marketMedian = sorted.length === 0 ? 0 : sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    const allPrices = [...prices, ourPrice].sort((a, b) => a - b);
    const ourRank = allPrices.indexOf(ourPrice);
    const percentile = allPrices.length > 1 ? Math.round((ourRank / (allPrices.length - 1)) * 100) : 50;

    let relativePosition: PricingBenchmark['relativePosition'];
    if (percentile <= 20) relativePosition = 'budget';
    else if (percentile <= 40) relativePosition = 'below-average';
    else if (percentile <= 60) relativePosition = 'average';
    else if (percentile <= 80) relativePosition = 'above-average';
    else relativePosition = 'premium';

    const pricingGap = ourPrice - marketAverage;
    const recommendations: string[] = [];
    if (relativePosition === 'budget' || relativePosition === 'below-average') {
      recommendations.push('Consider a modest price increase with added value to improve margin without losing customers.');
      if (pricingGap < -20) recommendations.push('Significant headroom to increase pricing — ensure you communicate value effectively.');
    }
    if (relativePosition === 'premium') {
      recommendations.push('Ensure premium pricing is justified by clearly differentiated features and brand positioning.');
      recommendations.push('Offer a free trial or freemium tier to reduce conversion friction at premium price points.');
    }
    if (relativePosition === 'average') {
      recommendations.push('Average pricing reduces differentiation — consider value-based pricing strategy.');
    }

    const benchmark: PricingBenchmark = {
      ourPrice,
      competitorPrices,
      marketAverage: Math.round(marketAverage * 100) / 100,
      marketMedian: Math.round(marketMedian * 100) / 100,
      percentile,
      relativePosition,
      pricingGap: Math.round(pricingGap * 100) / 100,
      recommendations,
      generatedAt: new Date(),
    };

    logger.info('Pricing benchmark generated', { relativePosition, percentile, ourPrice });
    return benchmark;
  }

  // ─── Market Share Estimation ──────────────────────────────────────────────

  estimateMarketShare(): MarketShareEstimate[] {
    const cacheKey = 'market_share_estimates';
    const cached = cache.get<MarketShareEstimate[]>(cacheKey);
    if (cached) return cached;

    const signalWeights: Record<string, number> = {
      traffic: 0.35,
      employees: 0.20,
      funding: 0.20,
      social: 0.15,
      reviews: 0.10,
    };

    const competitorList = Array.from(this.competitors.values());
    const rawSignals = competitorList.map((c) => ({
      id: c.id,
      name: c.name,
      traffic: c.monthlyVisitors ?? 0,
      employees: c.employeeCount ?? 0,
      funding: c.fundingAmount ?? 0,
      social: 0, // would come from ContentStrategy
      reviews: 0,
    }));

    // Normalize each signal 0-1 across competitors
    const normalize = (values: number[]): number[] => {
      const max = Math.max(...values, 1);
      return values.map((v) => v / max);
    };

    const trafficNorm = normalize(rawSignals.map((s) => s.traffic));
    const employeeNorm = normalize(rawSignals.map((s) => s.employees));
    const fundingNorm = normalize(rawSignals.map((s) => s.funding));

    const weightedScores = rawSignals.map((s, i) => {
      const score =
        trafficNorm[i] * signalWeights.traffic +
        employeeNorm[i] * signalWeights.employees +
        fundingNorm[i] * signalWeights.funding;
      return score;
    });

    const totalScore = weightedScores.reduce((a, b) => a + b, 0) || 1;

    const estimates: MarketShareEstimate[] = rawSignals.map((s, i) => {
      const estimatedShare = Math.round((weightedScores[i] / totalScore) * 100 * 100) / 100;
      const signalsData = [
        { type: 'traffic' as const, weight: signalWeights.traffic, rawValue: s.traffic, normalizedValue: trafficNorm[i] },
        { type: 'employees' as const, weight: signalWeights.employees, rawValue: s.employees, normalizedValue: employeeNorm[i] },
        { type: 'funding' as const, weight: signalWeights.funding, rawValue: s.funding, normalizedValue: fundingNorm[i] },
      ];
      const dataRichness = signalsData.filter((sig) => sig.rawValue > 0).length;
      const confidence: MarketShareEstimate['confidence'] = dataRichness >= 3 ? 'high' : dataRichness >= 2 ? 'medium' : 'low';
      return {
        competitorId: s.id,
        name: s.name,
        estimatedShare,
        signals: signalsData,
        confidence,
        trend: 'stable',
        updatedAt: new Date(),
      };
    });

    cache.set(cacheKey, estimates, 1800);
    logger.info('Market share estimated', { competitorCount: estimates.length });
    return estimates;
  }

  // ─── SWOT Analysis ────────────────────────────────────────────────────────

  generateSWOT(competitorId: string): SWOTAnalysis | null {
    const competitor = this.competitors.get(competitorId);
    if (!competitor) {
      logger.warn('SWOT: competitor not found', { competitorId });
      return null;
    }

    const matrix = this.buildFeatureMatrix();
    const compEntry = matrix.competitors.find((c) => c.competitorId === competitorId);
    const marketShares = this.estimateMarketShare();
    const shareEntry = marketShares.find((m) => m.competitorId === competitorId);

    const strengths: SWOTAnalysis['strengths'] = [];
    const weaknesses: SWOTAnalysis['weaknesses'] = [];
    const opportunities: SWOTAnalysis['opportunities'] = [];
    const threats: SWOTAnalysis['threats'] = [];

    // Strengths
    if (compEntry && compEntry.coverageScore >= 70) {
      strengths.push({ factor: 'Broad feature coverage', evidence: `${compEntry.coverageScore}% feature coverage score`, weight: 8 });
    }
    if (competitor.fundingStage === 'public' || competitor.fundingStage === 'seriesC') {
      strengths.push({ factor: 'Strong financial backing', evidence: `Funding stage: ${competitor.fundingStage}, amount: $${competitor.fundingAmount?.toLocaleString() ?? 'N/A'}`, weight: 9 });
    }
    if ((competitor.monthlyVisitors ?? 0) > 500_000) {
      strengths.push({ factor: 'High web traffic', evidence: `${competitor.monthlyVisitors?.toLocaleString()} monthly visitors`, weight: 7 });
    }
    if ((competitor.employeeCount ?? 0) > 200) {
      strengths.push({ factor: 'Large team & execution capacity', evidence: `${competitor.employeeCount} employees`, weight: 6 });
    }
    if (competitor.pricing?.hasFree) {
      strengths.push({ factor: 'Freemium acquisition funnel', evidence: 'Offers a free tier to drive top-of-funnel growth', weight: 7 });
    }

    // Weaknesses
    if (compEntry && compEntry.coverageScore < 50) {
      weaknesses.push({ factor: 'Limited feature set', evidence: `Only ${compEntry.coverageScore}% feature coverage`, weight: 6 });
    }
    if (!competitor.pricing?.hasFree && (competitor.pricing?.lowestTier ?? 0) > 50) {
      weaknesses.push({ factor: 'High entry price barrier', evidence: `Lowest tier: $${competitor.pricing?.lowestTier}/mo with no free tier`, weight: 7 });
    }
    if ((competitor.employeeCount ?? 0) < 20) {
      weaknesses.push({ factor: 'Small team — execution risk', evidence: `Only ${competitor.employeeCount ?? 'unknown'} employees`, weight: 5 });
    }
    if (competitor.geographies.length < 3) {
      weaknesses.push({ factor: 'Limited geographic reach', evidence: `Active in ${competitor.geographies.length} region(s)`, weight: 5 });
    }

    // Opportunities
    const coverageGap = matrix.features.length - (compEntry?.coverageScore ?? 0) / 100 * matrix.features.length;
    if (coverageGap > 5) {
      opportunities.push({ factor: 'Feature expansion potential', evidence: `${Math.round(coverageGap)} uncovered market features`, potential: 'high' });
    }
    if (competitor.geographies.length < 5) {
      opportunities.push({ factor: 'Geographic expansion', evidence: 'Significant markets not yet targeted', potential: 'medium' });
    }
    if (competitor.pricing?.model === 'subscription' && !competitor.pricing.hasFree) {
      opportunities.push({ factor: 'Freemium conversion play', evidence: 'Adding a free tier could accelerate user acquisition', potential: 'high' });
    }

    // Threats
    const highShareComps = marketShares.filter((m) => m.estimatedShare > 30 && m.competitorId !== competitorId);
    if (highShareComps.length > 0) {
      threats.push({ factor: 'Dominant market players', evidence: `${highShareComps.length} competitor(s) with >30% estimated share`, severity: 'high' });
    }
    if ((shareEntry?.estimatedShare ?? 0) < 10) {
      threats.push({ factor: 'Low market share', evidence: `Estimated ${shareEntry?.estimatedShare ?? 0}% share`, severity: 'medium' });
    }
    if (matrix.gaps.length > 3) {
      threats.push({ factor: 'Competitors out-feature us', evidence: `We lack ${matrix.gaps.length} features competitors commonly offer`, severity: 'high' });
    }

    const severityScore = threats.reduce((acc, t) => acc + (t.severity === 'high' ? 3 : t.severity === 'medium' ? 2 : 1), 0);
    const overallThreatLevel: SWOTAnalysis['overallThreatLevel'] =
      severityScore >= 9 ? 'critical' : severityScore >= 6 ? 'high' : severityScore >= 3 ? 'moderate' : 'low';

    const swot: SWOTAnalysis = {
      competitorId,
      name: competitor.name,
      strengths,
      weaknesses,
      opportunities,
      threats,
      overallThreatLevel,
      generatedAt: new Date(),
    };

    logger.info('SWOT analysis generated', { competitorId, overallThreatLevel });
    return swot;
  }

  // ─── Content Strategy Analysis ────────────────────────────────────────────

  analyzeContentStrategy(competitorId: string, rawPosts: Array<{ publishedAt: Date; wordCount: number; topic: string; format: ContentStrategy['formats'][0]['format']; engagement: number }>): ContentStrategy {
    const competitor = this.competitors.get(competitorId);
    if (!competitor) throw new Error(`Competitor ${competitorId} not found`);

    if (rawPosts.length === 0) {
      const empty: ContentStrategy = {
        competitorId,
        name: competitor.name,
        publishingFrequency: { postsPerWeek: 0, consistency: 'irregular' },
        topTopics: [],
        formats: [],
        avgWordCount: 0,
        seoFocus: 'low',
        socialPresence: {},
        contentScore: 0,
        analyzedAt: new Date(),
      };
      this.contentStrategies.set(competitorId, empty);
      return empty;
    }

    // Publishing frequency
    const sorted = rawPosts.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
    const firstDate = sorted[0].publishedAt;
    const lastDate = sorted[sorted.length - 1].publishedAt;
    const weekSpan = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 3600 * 1000));
    const postsPerWeek = Math.round((rawPosts.length / weekSpan) * 10) / 10;

    // Consistency: compute weekly buckets
    const weeklyBuckets: Map<number, number> = new Map();
    rawPosts.forEach((p) => {
      const weekKey = Math.floor(p.publishedAt.getTime() / (7 * 24 * 3600 * 1000));
      weeklyBuckets.set(weekKey, (weeklyBuckets.get(weekKey) ?? 0) + 1);
    });
    const activeFraction = weeklyBuckets.size / Math.max(1, weekSpan);
    const consistency: ContentStrategy['publishingFrequency']['consistency'] =
      activeFraction >= 0.9 ? 'very-consistent' : activeFraction >= 0.7 ? 'consistent' : activeFraction >= 0.5 ? 'moderate' : 'irregular';

    // Topics
    const topicMap: Map<string, { count: number; totalEngagement: number }> = new Map();
    rawPosts.forEach((p) => {
      const t = p.topic.toLowerCase();
      const existing = topicMap.get(t) ?? { count: 0, totalEngagement: 0 };
      topicMap.set(t, { count: existing.count + 1, totalEngagement: existing.totalEngagement + p.engagement });
    });
    const topTopics = Array.from(topicMap.entries())
      .map(([topic, data]) => ({ topic, frequency: data.count, avgEngagement: Math.round(data.totalEngagement / data.count) }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    // Formats
    const formatMap: Map<string, number> = new Map();
    rawPosts.forEach((p) => formatMap.set(p.format, (formatMap.get(p.format) ?? 0) + 1));
    const formats = Array.from(formatMap.entries()).map(([format, count]) => ({
      format: format as ContentStrategy['formats'][0]['format'],
      share: Math.round((count / rawPosts.length) * 100),
    }));

    const avgWordCount = Math.round(rawPosts.reduce((acc, p) => acc + p.wordCount, 0) / rawPosts.length);
    const seoFocus: ContentStrategy['seoFocus'] = avgWordCount >= 1500 ? 'high' : avgWordCount >= 800 ? 'medium' : 'low';

    // Content score: 0-100
    let contentScore = 0;
    contentScore += Math.min(30, postsPerWeek * 10); // up to 30 for frequency
    contentScore += consistency === 'very-consistent' ? 20 : consistency === 'consistent' ? 15 : consistency === 'moderate' ? 10 : 5;
    contentScore += seoFocus === 'high' ? 20 : seoFocus === 'medium' ? 12 : 5;
    contentScore += Math.min(20, topTopics.length * 2); // topic diversity
    contentScore += formats.length >= 3 ? 10 : formats.length >= 2 ? 5 : 0; // format diversity

    const strategy: ContentStrategy = {
      competitorId,
      name: competitor.name,
      publishingFrequency: { postsPerWeek, consistency },
      topTopics,
      formats,
      avgWordCount,
      seoFocus,
      socialPresence: {},
      contentScore: Math.min(100, contentScore),
      analyzedAt: new Date(),
    };

    this.contentStrategies.set(competitorId, strategy);
    logger.info('Content strategy analyzed', { competitorId, postsPerWeek, contentScore: strategy.contentScore });
    return strategy;
  }

  // ─── Strategic Recommendations ────────────────────────────────────────────

  getStrategicRecommendations(): StrategicRecommendation[] {
    const recommendations: StrategicRecommendation[] = [];
    const matrix = this.buildFeatureMatrix();
    const pricing = this.benchmarkPricing();
    const marketShares = this.estimateMarketShare();
    let idCounter = 1;

    const makeRec = (
      category: StrategicRecommendation['category'],
      priority: StrategicRecommendation['priority'],
      title: string,
      description: string,
      rationale: string,
      effort: StrategicRecommendation['effort'],
      impact: StrategicRecommendation['impact'],
      relatedCompetitors: string[],
      actions: string[],
      timeframe: string,
    ): StrategicRecommendation => {
      const effortScore = effort === 'low' ? 3 : effort === 'medium' ? 2 : 1;
      const impactScore = impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
      return {
        id: `rec-${idCounter++}`,
        category,
        priority,
        title,
        description,
        rationale,
        effort,
        impact,
        score: Math.round(((effortScore + impactScore) / 6) * 100),
        relatedCompetitors,
        actions,
        estimatedTimeframe: timeframe,
        generatedAt: new Date(),
      };
    };

    // Feature gap recommendations
    if (matrix.gaps.length > 0) {
      const topGaps = matrix.gaps.slice(0, 3);
      recommendations.push(makeRec(
        'features', 'high',
        'Close Critical Feature Gaps',
        `${matrix.gaps.length} features exist in majority of competitors but not in our product. Top gaps: ${topGaps.join(', ')}.`,
        'Feature parity is table stakes for competitive consideration. Gaps reduce win rates in head-to-head comparisons.',
        'medium', 'high',
        Array.from(this.competitors.keys()),
        topGaps.map((g) => `Implement ${g} feature`),
        '2-4 months',
      ));
    }

    // Pricing recommendations
    if (pricing.relativePosition === 'premium' || pricing.relativePosition === 'above-average') {
      recommendations.push(makeRec(
        'pricing', 'medium',
        'Add Value-Tier to Reduce Entry Barrier',
        'Our pricing is above market average. A lower-cost tier could expand addressable market.',
        `At ${pricing.percentile}th percentile, we risk losing price-sensitive buyers.`,
        'low', 'medium',
        pricing.competitorPrices.filter((p) => p.price < pricing.ourPrice).map((p) => p.competitorId),
        ['Design a new starter tier at or below market average', 'Limit features to drive upgrade path'],
        '1-2 months',
      ));
    }
    if (pricing.relativePosition === 'budget' || pricing.relativePosition === 'below-average') {
      recommendations.push(makeRec(
        'pricing', 'medium',
        'Increase Pricing to Capture Untapped Value',
        `We are pricing at the ${pricing.percentile}th percentile — likely leaving revenue on the table.`,
        `Market average is $${pricing.marketAverage}/mo; we are at $${pricing.ourPrice}/mo.`,
        'low', 'high',
        [],
        ['Conduct customer willingness-to-pay research', 'Test a 10-20% price increase with new sign-ups', 'Grandfather existing customers'],
        '1 month',
      ));
    }

    // Advantages — lean into them
    if (matrix.advantages.length > 0) {
      recommendations.push(makeRec(
        'positioning', 'high',
        'Double Down on Unique Differentiators',
        `We have ${matrix.advantages.length} features that <30% of competitors offer: ${matrix.advantages.slice(0, 3).join(', ')}.`,
        'Unique capabilities are the strongest basis for premium positioning and brand differentiation.',
        'low', 'high',
        [],
        ['Add differentiators prominently to homepage and landing pages', 'Build case studies showcasing these features', 'Use in competitive sales battlecards'],
        '2-3 weeks',
      ));
    }

    // Market share — attack weakest competitor
    const weakest = marketShares.sort((a, b) => a.estimatedShare - b.estimatedShare)[0];
    if (weakest && weakest.estimatedShare < 15) {
      recommendations.push(makeRec(
        'market', 'medium',
        `Target Low-Share Competitor: ${weakest.name}`,
        `${weakest.name} has an estimated ${weakest.estimatedShare}% market share — a realistic displacement target.`,
        'Focusing competitive campaigns on weaker players is higher ROI than attacking market leaders.',
        'medium', 'medium',
        [weakest.competitorId],
        [`Create a ${weakest.name} comparison page`, `Offer migration incentives from ${weakest.name}`, 'Run targeted paid campaigns against their branded keywords'],
        '4-6 weeks',
      ));
    }

    // Content strategy
    const strategies = Array.from(this.contentStrategies.values());
    const topContentCompetitor = strategies.sort((a, b) => b.contentScore - a.contentScore)[0];
    if (topContentCompetitor && topContentCompetitor.contentScore > 60) {
      recommendations.push(makeRec(
        'content', 'medium',
        'Match Content Velocity of Top Competitor',
        `${topContentCompetitor.name} has a content score of ${topContentCompetitor.contentScore}/100 with ${topContentCompetitor.publishingFrequency.postsPerWeek} posts/week.`,
        'Strong content programs drive organic traffic, SEO authority, and inbound leads.',
        'high', 'high',
        [topContentCompetitor.competitorId],
        ['Establish an editorial calendar targeting their top topics', 'Invest in long-form SEO content (1500+ words)', 'Diversify into video and case study formats'],
        '3-6 months',
      ));
    }

    return recommendations.sort((a, b) => b.score - a.score);
  }

  // ─── Market Position Tracking ─────────────────────────────────────────────

  trackMarketPosition(): MarketPosition {
    const matrix = this.buildFeatureMatrix();
    const pricing = this.benchmarkPricing();
    const shares = this.estimateMarketShare();

    const ourFeatureCoverage = matrix.features.length > 0
      ? Math.round((Object.values(matrix.ourCoverage).filter((v) => v === 'yes').length / matrix.features.length) * 100)
      : 0;

    const strategies = Array.from(this.contentStrategies.values());
    const avgContentScore = strategies.length > 0
      ? Math.round(strategies.reduce((a, s) => a + s.contentScore, 0) / strategies.length)
      : 0;

    const totalShare = shares.reduce((a, s) => a + s.estimatedShare, 0);
    const ourEstimatedShare = Math.max(0, 100 - totalShare);

    const overallScore = Math.round(
      ourFeatureCoverage * 0.35 +
      (100 - pricing.percentile) * 0.20 +
      Math.min(ourEstimatedShare * 2, 100) * 0.25 +
      avgContentScore * 0.20,
    );

    const rankings = shares
      .map((s) => ({
        competitorId: s.competitorId,
        name: s.name,
        overallScore: Math.round(s.estimatedShare * 2),
        rank: 0,
      }))
      .sort((a, b) => b.overallScore - a.overallScore)
      .map((r, i) => ({ ...r, rank: i + 2 })); // +2 because we are rank 1

    logger.info('Market position tracked', { ourFeatureCoverage, pricingPercentile: pricing.percentile, ourEstimatedShare, overallScore });

    return {
      ourPosition: {
        featureCoverageScore: ourFeatureCoverage,
        pricingPercentile: pricing.percentile,
        estimatedMarketShare: Math.round(ourEstimatedShare * 100) / 100,
        contentScore: avgContentScore,
        overallScore,
      },
      rankings,
      generatedAt: new Date(),
    };
  }

  // ─── Compare Competitors ──────────────────────────────────────────────────

  compareCompetitors(competitorIdA: string, competitorIdB: string): Record<string, unknown> | null {
    const a = this.competitors.get(competitorIdA);
    const b = this.competitors.get(competitorIdB);
    if (!a || !b) return null;

    const matrix = this.buildFeatureMatrix();
    const aEntry = matrix.competitors.find((c) => c.competitorId === competitorIdA);
    const bEntry = matrix.competitors.find((c) => c.competitorId === competitorIdB);

    const onlyInA = matrix.features.filter((f) => aEntry?.coverage[f] === 'yes' && bEntry?.coverage[f] !== 'yes');
    const onlyInB = matrix.features.filter((f) => bEntry?.coverage[f] === 'yes' && aEntry?.coverage[f] !== 'yes');
    const inBoth = matrix.features.filter((f) => aEntry?.coverage[f] === 'yes' && bEntry?.coverage[f] === 'yes');

    return {
      summary: { a: a.name, b: b.name },
      featureCoverage: {
        [a.name]: aEntry?.coverageScore ?? 0,
        [b.name]: bEntry?.coverageScore ?? 0,
        onlyIn: { [a.name]: onlyInA, [b.name]: onlyInB },
        inBoth,
      },
      pricing: {
        [a.name]: a.pricing?.lowestTier ?? null,
        [b.name]: b.pricing?.lowestTier ?? null,
        difference: (a.pricing?.lowestTier ?? 0) - (b.pricing?.lowestTier ?? 0),
      },
      scale: {
        [a.name]: { employees: a.employeeCount, visitors: a.monthlyVisitors },
        [b.name]: { employees: b.employeeCount, visitors: b.monthlyVisitors },
      },
      verdict: (aEntry?.coverageScore ?? 0) > (bEntry?.coverageScore ?? 0) ? `${a.name} leads on features` : `${b.name} leads on features`,
    };
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  listCompetitors(): Competitor[] {
    return Array.from(this.competitors.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getCompetitorCount(): number {
    return this.competitors.size;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getCompetitiveIntelligenceEngine(): CompetitiveIntelligenceEngine {
  if (!(globalThis as any).__competitiveIntelligenceEngine__) {
    (globalThis as any).__competitiveIntelligenceEngine__ = new CompetitiveIntelligenceEngine();
  }
  return (globalThis as any).__competitiveIntelligenceEngine__;
}
