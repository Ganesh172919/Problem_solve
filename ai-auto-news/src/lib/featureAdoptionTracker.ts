/**
 * Feature Adoption Tracker
 *
 * Tracks feature usage, adoption rates, engagement patterns,
 * and provides insights for product-led growth optimization.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface Feature {
  id: string;
  name: string;
  category: string;
  tier: string;
  releaseDate: number;
  description: string;
  isActive: boolean;
  tags: string[];
}

export interface FeatureUsageEvent {
  id: string;
  featureId: string;
  userId: string;
  tenantId: string;
  action: 'viewed' | 'activated' | 'used' | 'completed' | 'abandoned';
  duration?: number;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface AdoptionMetrics {
  featureId: string;
  totalUsers: number;
  activeUsers: number;
  adoptionRate: number;
  activationRate: number;
  retentionRate: number;
  avgSessionDuration: number;
  avgUsageFrequency: number;
  completionRate: number;
  abandonmentRate: number;
  timeToFirstUse: number;
  trend: 'growing' | 'stable' | 'declining';
  trendPercentage: number;
}

export interface UserJourney {
  userId: string;
  featureSequence: { featureId: string; timestamp: number; action: string }[];
  totalFeatures: number;
  engagementScore: number;
  segment: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface FeatureCorrelation {
  featureA: string;
  featureB: string;
  correlation: number;
  users: number;
  direction: 'positive' | 'negative' | 'neutral';
}

export interface AdoptionInsight {
  type: 'opportunity' | 'risk' | 'success' | 'recommendation';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  actionable: boolean;
  suggestedAction: string;
  relatedFeatures: string[];
  confidence: number;
}

export interface ProductHealthScore {
  overall: number;
  adoption: number;
  engagement: number;
  retention: number;
  satisfaction: number;
  growth: number;
  topFeatures: { featureId: string; score: number }[];
  bottomFeatures: { featureId: string; score: number }[];
  insights: AdoptionInsight[];
}

export class FeatureAdoptionTracker {
  private features: Map<string, Feature> = new Map();
  private usageEvents: FeatureUsageEvent[] = [];
  private userFeatureMap: Map<string, Set<string>> = new Map();
  private featureUserMap: Map<string, Set<string>> = new Map();
  private totalRegisteredUsers: number = 0;

  registerFeature(feature: Feature): void {
    this.features.set(feature.id, feature);
    this.featureUserMap.set(feature.id, new Set());
  }

  setTotalUsers(count: number): void {
    this.totalRegisteredUsers = count;
  }

  trackUsage(event: FeatureUsageEvent): void {
    this.usageEvents.push(event);

    if (!this.userFeatureMap.has(event.userId)) {
      this.userFeatureMap.set(event.userId, new Set());
    }
    this.userFeatureMap.get(event.userId)!.add(event.featureId);

    if (!this.featureUserMap.has(event.featureId)) {
      this.featureUserMap.set(event.featureId, new Set());
    }
    this.featureUserMap.get(event.featureId)!.add(event.userId);

    if (this.usageEvents.length > 500000) {
      this.usageEvents = this.usageEvents.slice(-250000);
    }
  }

  getAdoptionMetrics(featureId: string): AdoptionMetrics {
    const feature = this.features.get(featureId);
    if (!feature) {
      return this.emptyMetrics(featureId);
    }

    const events = this.usageEvents.filter((e) => e.featureId === featureId);
    const uniqueUsers = new Set(events.map((e) => e.userId));
    const totalUsers = this.totalRegisteredUsers || uniqueUsers.size;
    const activeUsers = uniqueUsers.size;

    const activatedUsers = new Set(
      events.filter((e) => e.action === 'activated' || e.action === 'used').map((e) => e.userId),
    ).size;

    const completedUsers = new Set(
      events.filter((e) => e.action === 'completed').map((e) => e.userId),
    ).size;

    const abandonedUsers = new Set(
      events.filter((e) => e.action === 'abandoned').map((e) => e.userId),
    ).size;

    const durations = events
      .filter((e) => e.duration !== undefined)
      .map((e) => e.duration!);

    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const userUsageCounts = new Map<string, number>();
    for (const event of events) {
      userUsageCounts.set(event.userId, (userUsageCounts.get(event.userId) || 0) + 1);
    }
    const avgFrequency =
      userUsageCounts.size > 0
        ? Array.from(userUsageCounts.values()).reduce((a, b) => a + b, 0) / userUsageCounts.size
        : 0;

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const thisWeekUsers = new Set(
      events.filter((e) => e.timestamp >= weekAgo).map((e) => e.userId),
    ).size;
    const lastWeekUsers = new Set(
      events.filter((e) => e.timestamp >= twoWeeksAgo && e.timestamp < weekAgo).map((e) => e.userId),
    ).size;

    const trendPercentage = lastWeekUsers > 0 ? ((thisWeekUsers - lastWeekUsers) / lastWeekUsers) * 100 : 0;
    const trend: 'growing' | 'stable' | 'declining' =
      trendPercentage > 5 ? 'growing' : trendPercentage < -5 ? 'declining' : 'stable';

    const firstUseEvents = events
      .filter((e) => e.action === 'used' || e.action === 'activated')
      .sort((a, b) => a.timestamp - b.timestamp);

    const timeToFirstUse =
      firstUseEvents.length > 0 ? firstUseEvents[0].timestamp - feature.releaseDate : 0;

    const retainedUsers = new Set(
      events.filter((e) => e.timestamp >= weekAgo).map((e) => e.userId),
    ).size;

    return {
      featureId,
      totalUsers,
      activeUsers,
      adoptionRate: totalUsers > 0 ? parseFloat((activeUsers / totalUsers).toFixed(4)) : 0,
      activationRate: activeUsers > 0 ? parseFloat((activatedUsers / activeUsers).toFixed(4)) : 0,
      retentionRate: activeUsers > 0 ? parseFloat((retainedUsers / activeUsers).toFixed(4)) : 0,
      avgSessionDuration: Math.round(avgDuration),
      avgUsageFrequency: parseFloat(avgFrequency.toFixed(2)),
      completionRate: activeUsers > 0 ? parseFloat((completedUsers / activeUsers).toFixed(4)) : 0,
      abandonmentRate: activeUsers > 0 ? parseFloat((abandonedUsers / activeUsers).toFixed(4)) : 0,
      timeToFirstUse: Math.max(0, timeToFirstUse),
      trend,
      trendPercentage: parseFloat(trendPercentage.toFixed(2)),
    };
  }

  getFeatureCorrelations(): FeatureCorrelation[] {
    const featureIds = Array.from(this.features.keys());
    const correlations: FeatureCorrelation[] = [];

    for (let i = 0; i < featureIds.length; i++) {
      for (let j = i + 1; j < featureIds.length; j++) {
        const usersA = this.featureUserMap.get(featureIds[i]) || new Set();
        const usersB = this.featureUserMap.get(featureIds[j]) || new Set();

        if (usersA.size === 0 || usersB.size === 0) continue;

        const intersection = new Set([...usersA].filter((u) => usersB.has(u)));
        const union = new Set([...usersA, ...usersB]);

        const jaccard = union.size > 0 ? intersection.size / union.size : 0;

        correlations.push({
          featureA: featureIds[i],
          featureB: featureIds[j],
          correlation: parseFloat(jaccard.toFixed(4)),
          users: intersection.size,
          direction: jaccard > 0.3 ? 'positive' : jaccard < 0.1 ? 'negative' : 'neutral',
        });
      }
    }

    return correlations.sort((a, b) => b.correlation - a.correlation);
  }

  getUserJourney(userId: string): UserJourney {
    const events = this.usageEvents
      .filter((e) => e.userId === userId)
      .sort((a, b) => a.timestamp - b.timestamp);

    const featureSequence = events.map((e) => ({
      featureId: e.featureId,
      timestamp: e.timestamp,
      action: e.action,
    }));

    const uniqueFeatures = new Set(events.map((e) => e.featureId)).size;
    const totalFeatures = this.features.size;
    const engagementScore = totalFeatures > 0 ? uniqueFeatures / totalFeatures : 0;

    let segment: string;
    if (engagementScore >= 0.7) segment = 'power_user';
    else if (engagementScore >= 0.4) segment = 'regular';
    else if (engagementScore >= 0.1) segment = 'casual';
    else segment = 'inactive';

    const now = Date.now();
    const lastEvent = events.length > 0 ? events[events.length - 1].timestamp : 0;
    const daysSinceLastUse = (now - lastEvent) / (24 * 60 * 60 * 1000);

    let riskLevel: 'low' | 'medium' | 'high';
    if (daysSinceLastUse > 30) riskLevel = 'high';
    else if (daysSinceLastUse > 14) riskLevel = 'medium';
    else riskLevel = 'low';

    return {
      userId,
      featureSequence,
      totalFeatures: uniqueFeatures,
      engagementScore: parseFloat(engagementScore.toFixed(4)),
      segment,
      riskLevel,
    };
  }

  generateInsights(): AdoptionInsight[] {
    const insights: AdoptionInsight[] = [];

    for (const featureId of this.features.keys()) {
      const metrics = this.getAdoptionMetrics(featureId);

      if (metrics.adoptionRate < 0.1 && metrics.totalUsers > 100) {
        insights.push({
          type: 'risk',
          title: `Low adoption for ${featureId}`,
          description: `Only ${(metrics.adoptionRate * 100).toFixed(1)}% of users have adopted this feature`,
          impact: 'high',
          actionable: true,
          suggestedAction: 'Consider adding onboarding tooltips or in-app tutorials',
          relatedFeatures: [featureId],
          confidence: 0.85,
        });
      }

      if (metrics.abandonmentRate > 0.3) {
        insights.push({
          type: 'risk',
          title: `High abandonment for ${featureId}`,
          description: `${(metrics.abandonmentRate * 100).toFixed(1)}% of users abandon this feature`,
          impact: 'medium',
          actionable: true,
          suggestedAction: 'Simplify the feature workflow and reduce friction points',
          relatedFeatures: [featureId],
          confidence: 0.8,
        });
      }

      if (metrics.trend === 'growing' && metrics.trendPercentage > 20) {
        insights.push({
          type: 'success',
          title: `Strong growth for ${featureId}`,
          description: `Usage growing ${metrics.trendPercentage.toFixed(1)}% week-over-week`,
          impact: 'high',
          actionable: false,
          suggestedAction: 'Capitalize on momentum with advanced features',
          relatedFeatures: [featureId],
          confidence: 0.9,
        });
      }

      if (metrics.activationRate > 0.8 && metrics.completionRate < 0.3) {
        insights.push({
          type: 'opportunity',
          title: `Activation-completion gap for ${featureId}`,
          description: 'Users are activating but not completing - potential UX improvement opportunity',
          impact: 'high',
          actionable: true,
          suggestedAction: 'Add progress indicators and simplify completion steps',
          relatedFeatures: [featureId],
          confidence: 0.75,
        });
      }
    }

    return insights.sort((a, b) => {
      const impactOrder = { high: 3, medium: 2, low: 1 };
      return impactOrder[b.impact] - impactOrder[a.impact];
    });
  }

  getProductHealthScore(): ProductHealthScore {
    const featureMetrics = Array.from(this.features.keys()).map((id) => ({
      featureId: id,
      metrics: this.getAdoptionMetrics(id),
    }));

    if (featureMetrics.length === 0) {
      return {
        overall: 0, adoption: 0, engagement: 0, retention: 0, satisfaction: 0, growth: 0,
        topFeatures: [], bottomFeatures: [], insights: [],
      };
    }

    const avgAdoption = featureMetrics.reduce((sum, f) => sum + f.metrics.adoptionRate, 0) / featureMetrics.length;
    const avgRetention = featureMetrics.reduce((sum, f) => sum + f.metrics.retentionRate, 0) / featureMetrics.length;
    const avgCompletion = featureMetrics.reduce((sum, f) => sum + f.metrics.completionRate, 0) / featureMetrics.length;
    const growingFeatures = featureMetrics.filter((f) => f.metrics.trend === 'growing').length;
    const growthScore = featureMetrics.length > 0 ? growingFeatures / featureMetrics.length : 0;

    const engagement = featureMetrics.reduce((sum, f) => sum + f.metrics.avgUsageFrequency, 0) / featureMetrics.length;
    const normalizedEngagement = Math.min(1, engagement / 10);

    const overall = (avgAdoption * 0.25 + normalizedEngagement * 0.25 + avgRetention * 0.25 + avgCompletion * 0.15 + growthScore * 0.1);

    const featureScores = featureMetrics.map((f) => ({
      featureId: f.featureId,
      score: parseFloat(
        (f.metrics.adoptionRate * 0.3 + f.metrics.retentionRate * 0.3 + f.metrics.completionRate * 0.2 + (f.metrics.trend === 'growing' ? 0.2 : 0)).toFixed(4),
      ),
    }));

    featureScores.sort((a, b) => b.score - a.score);

    return {
      overall: parseFloat(overall.toFixed(4)),
      adoption: parseFloat(avgAdoption.toFixed(4)),
      engagement: parseFloat(normalizedEngagement.toFixed(4)),
      retention: parseFloat(avgRetention.toFixed(4)),
      satisfaction: parseFloat(avgCompletion.toFixed(4)),
      growth: parseFloat(growthScore.toFixed(4)),
      topFeatures: featureScores.slice(0, 5),
      bottomFeatures: featureScores.slice(-5).reverse(),
      insights: this.generateInsights(),
    };
  }

  getFeatures(): Feature[] {
    return Array.from(this.features.values());
  }

  private emptyMetrics(featureId: string): AdoptionMetrics {
    return {
      featureId,
      totalUsers: 0,
      activeUsers: 0,
      adoptionRate: 0,
      activationRate: 0,
      retentionRate: 0,
      avgSessionDuration: 0,
      avgUsageFrequency: 0,
      completionRate: 0,
      abandonmentRate: 0,
      timeToFirstUse: 0,
      trend: 'stable',
      trendPercentage: 0,
    };
  }
}

let trackerInstance: FeatureAdoptionTracker | null = null;

export function getFeatureAdoptionTracker(): FeatureAdoptionTracker {
  if (!trackerInstance) {
    trackerInstance = new FeatureAdoptionTracker();
  }
  return trackerInstance;
}
