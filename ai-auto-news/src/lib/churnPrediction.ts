/**
 * Churn Prediction and Prevention System
 *
 * ML-based customer churn prediction with:
 * - Behavioral pattern analysis
 * - Engagement scoring
 * - Risk classification
 * - Automated intervention triggers
 * - Retention campaign automation
 * - Win-back strategies
 */

import { getLogger } from '@/lib/logger';
import { SubscriptionTier } from '@/types/saas';

const logger = getLogger();

export interface ChurnRiskProfile {
  userId: string;
  riskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  predictedChurnDate?: Date;
  confidence: number;
  lastUpdated: Date;
  interventions: Intervention[];
}

export interface RiskFactor {
  type: string;
  name: string;
  impact: number; // 0-100
  trend: 'improving' | 'stable' | 'declining';
  value: number;
  threshold: number;
  description: string;
}

export interface Intervention {
  id: string;
  type: 'email' | 'discount' | 'support-call' | 'feature-unlock' | 'training' | 'upgrade-offer';
  triggeredAt: Date;
  completedAt?: Date;
  status: 'pending' | 'sent' | 'engaged' | 'converted' | 'failed';
  effectiveness?: number;
  cost: number;
}

export interface BehavioralMetrics {
  userId: string;
  loginFrequency: number; // logins per week
  featureUsage: Record<string, number>;
  apiCallsPerDay: number;
  supportTickets: number;
  lastActiveDate: Date;
  accountAge: number; // days
  tier: SubscriptionTier;
  mrr: number; // monthly recurring revenue
  engagementScore: number; // 0-100
}

export interface RetentionCampaign {
  id: string;
  name: string;
  targetSegment: 'high-risk' | 'medium-risk' | 'low-engagement' | 'trial-expiring';
  interventionType: Intervention['type'];
  active: boolean;
  metrics: CampaignMetrics;
}

export interface CampaignMetrics {
  targetedUsers: number;
  interventionsSent: number;
  engagementRate: number;
  conversionRate: number;
  churnPrevented: number;
  roi: number;
}

class ChurnPredictionEngine {
  private riskProfiles: Map<string, ChurnRiskProfile> = new Map();
  private metrics: Map<string, BehavioralMetrics> = new Map();
  private campaigns: Map<string, RetentionCampaign> = new Map();
  private predictionModel: ChurnPredictionModel;

  constructor() {
    this.predictionModel = new ChurnPredictionModel();
    this.initializeDefaultCampaigns();
  }

  /**
   * Analyze churn risk for a user
   */
  async analyzeChurnRisk(userId: string): Promise<ChurnRiskProfile> {
    logger.info('Analyzing churn risk', { userId });

    // Get user metrics
    const behavioral = await this.getBehavioralMetrics(userId);

    // Calculate risk factors
    const factors = this.calculateRiskFactors(behavioral);

    // Predict churn risk
    const riskScore = this.predictionModel.predict(behavioral, factors);

    // Classify risk level
    const riskLevel = this.classifyRiskLevel(riskScore);

    // Predict churn date
    const predictedChurnDate = this.predictChurnDate(riskScore, behavioral);

    // Get past interventions
    const existingProfile = this.riskProfiles.get(userId);
    const interventions = existingProfile?.interventions || [];

    const profile: ChurnRiskProfile = {
      userId,
      riskScore: Math.round(riskScore),
      riskLevel,
      factors,
      predictedChurnDate,
      confidence: 0.85,
      lastUpdated: new Date(),
      interventions,
    };

    this.riskProfiles.set(userId, profile);

    // Trigger interventions if needed
    if (riskLevel === 'high' || riskLevel === 'critical') {
      await this.triggerInterventions(profile);
    }

    logger.info('Churn risk analysis complete', {
      userId,
      riskScore: profile.riskScore,
      riskLevel: profile.riskLevel,
    });

    return profile;
  }

  /**
   * Update behavioral metrics
   */
  async updateBehavioralMetrics(userId: string, metrics: Partial<BehavioralMetrics>): Promise<void> {
    const existing = this.metrics.get(userId) || {
      userId,
      loginFrequency: 0,
      featureUsage: {},
      apiCallsPerDay: 0,
      supportTickets: 0,
      lastActiveDate: new Date(),
      accountAge: 0,
      tier: 'free' as SubscriptionTier,
      mrr: 0,
      engagementScore: 0,
    };

    const updated = { ...existing, ...metrics };

    // Recalculate engagement score
    updated.engagementScore = this.calculateEngagementScore(updated);

    this.metrics.set(userId, updated);

    // Re-analyze risk if metrics significantly changed
    const profile = this.riskProfiles.get(userId);
    if (profile) {
      const oldScore = profile.riskScore;
      await this.analyzeChurnRisk(userId);
      const newScore = this.riskProfiles.get(userId)!.riskScore;

      if (Math.abs(newScore - oldScore) > 10) {
        logger.info('Significant churn risk change detected', {
          userId,
          oldScore,
          newScore,
          change: newScore - oldScore,
        });
      }
    }
  }

  /**
   * Get high-risk users
   */
  getHighRiskUsers(limit?: number): ChurnRiskProfile[] {
    const highRisk = Array.from(this.riskProfiles.values())
      .filter(p => p.riskLevel === 'high' || p.riskLevel === 'critical')
      .sort((a, b) => b.riskScore - a.riskScore);

    return limit ? highRisk.slice(0, limit) : highRisk;
  }

  /**
   * Get retention recommendations
   */
  async getRetentionRecommendations(userId: string): Promise<RetentionRecommendation[]> {
    const profile = this.riskProfiles.get(userId);

    if (!profile) {
      throw new Error(`No risk profile found for user: ${userId}`);
    }

    const recommendations: RetentionRecommendation[] = [];

    // Analyze top risk factors
    const topFactors = profile.factors
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 3);

    for (const factor of topFactors) {
      const recommendation = this.generateRecommendation(factor, profile);
      if (recommendation) {
        recommendations.push(recommendation);
      }
    }

    return recommendations;
  }

  /**
   * Execute intervention
   */
  async executeIntervention(
    userId: string,
    type: Intervention['type']
  ): Promise<string> {
    const profile = this.riskProfiles.get(userId);

    if (!profile) {
      throw new Error(`No risk profile found for user: ${userId}`);
    }

    const intervention: Intervention = {
      id: this.generateId('int'),
      type,
      triggeredAt: new Date(),
      status: 'pending',
      cost: this.getInterventionCost(type),
    };

    // Execute based on type
    await this.performIntervention(userId, intervention);

    intervention.status = 'sent';

    profile.interventions.push(intervention);

    logger.info('Intervention executed', {
      userId,
      interventionId: intervention.id,
      type: intervention.type,
    });

    return intervention.id;
  }

  /**
   * Track intervention outcome
   */
  async trackInterventionOutcome(
    interventionId: string,
    outcome: 'engaged' | 'converted' | 'failed',
    effectiveness?: number
  ): Promise<void> {
    for (const profile of this.riskProfiles.values()) {
      const intervention = profile.interventions.find(i => i.id === interventionId);

      if (intervention) {
        intervention.status = outcome;
        intervention.completedAt = new Date();
        intervention.effectiveness = effectiveness;

        logger.info('Intervention outcome tracked', {
          userId: profile.userId,
          interventionId,
          outcome,
          effectiveness,
        });

        // If converted, update risk score
        if (outcome === 'converted') {
          profile.riskScore = Math.max(0, profile.riskScore - 20);
          profile.riskLevel = this.classifyRiskLevel(profile.riskScore);
        }

        break;
      }
    }
  }

  /**
   * Get churn statistics
   */
  getStatistics(): ChurnStatistics {
    const profiles = Array.from(this.riskProfiles.values());

    const byRiskLevel = {
      low: profiles.filter(p => p.riskLevel === 'low').length,
      medium: profiles.filter(p => p.riskLevel === 'medium').length,
      high: profiles.filter(p => p.riskLevel === 'high').length,
      critical: profiles.filter(p => p.riskLevel === 'critical').length,
    };

    const totalInterventions = profiles.reduce(
      (sum, p) => sum + p.interventions.length,
      0
    );

    const successfulInterventions = profiles.reduce(
      (sum, p) =>
        sum + p.interventions.filter(i => i.status === 'converted').length,
      0
    );

    const interventionSuccess = totalInterventions > 0
      ? successfulInterventions / totalInterventions
      : 0;

    const avgRiskScore = profiles.length > 0
      ? profiles.reduce((sum, p) => sum + p.riskScore, 0) / profiles.length
      : 0;

    return {
      totalProfiles: profiles.length,
      byRiskLevel,
      averageRiskScore: Math.round(avgRiskScore),
      totalInterventions,
      successfulInterventions,
      interventionSuccessRate: interventionSuccess,
      activeCampaigns: Array.from(this.campaigns.values()).filter(c => c.active).length,
    };
  }

  /**
   * Calculate risk factors
   */
  private calculateRiskFactors(metrics: BehavioralMetrics): RiskFactor[] {
    const factors: RiskFactor[] = [];

    // Login frequency factor
    const loginThreshold = 3; // Expected logins per week
    if (metrics.loginFrequency < loginThreshold) {
      factors.push({
        type: 'login-frequency',
        name: 'Low Login Frequency',
        impact: 30,
        trend: metrics.loginFrequency < 1 ? 'declining' : 'stable',
        value: metrics.loginFrequency,
        threshold: loginThreshold,
        description: `User logs in ${metrics.loginFrequency.toFixed(1)} times per week (expected: ${loginThreshold})`,
      });
    }

    // Feature usage factor
    const featureUsageCount = Object.keys(metrics.featureUsage).length;
    const expectedFeatures = 5;
    if (featureUsageCount < expectedFeatures) {
      factors.push({
        type: 'feature-usage',
        name: 'Limited Feature Adoption',
        impact: 25,
        trend: 'stable',
        value: featureUsageCount,
        threshold: expectedFeatures,
        description: `User uses only ${featureUsageCount} features (expected: ${expectedFeatures})`,
      });
    }

    // API usage factor
    const expectedApiCalls = metrics.tier === 'free' ? 10 : metrics.tier === 'pro' ? 100 : 500;
    if (metrics.apiCallsPerDay < expectedApiCalls * 0.2) {
      factors.push({
        type: 'api-usage',
        name: 'Low API Usage',
        impact: 35,
        trend: 'declining',
        value: metrics.apiCallsPerDay,
        threshold: expectedApiCalls * 0.2,
        description: `API usage below 20% of tier capacity`,
      });
    }

    // Support tickets factor
    if (metrics.supportTickets > 5) {
      factors.push({
        type: 'support-tickets',
        name: 'High Support Ticket Volume',
        impact: 20,
        trend: 'stable',
        value: metrics.supportTickets,
        threshold: 5,
        description: `User has submitted ${metrics.supportTickets} support tickets`,
      });
    }

    // Last active factor
    const daysSinceActive = (Date.now() - metrics.lastActiveDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 7) {
      factors.push({
        type: 'last-active',
        name: 'Inactive User',
        impact: 40,
        trend: 'declining',
        value: daysSinceActive,
        threshold: 7,
        description: `User inactive for ${Math.round(daysSinceActive)} days`,
      });
    }

    // Engagement score factor
    if (metrics.engagementScore < 50) {
      factors.push({
        type: 'engagement',
        name: 'Low Engagement Score',
        impact: 30,
        trend: metrics.engagementScore < 30 ? 'declining' : 'stable',
        value: metrics.engagementScore,
        threshold: 50,
        description: `Overall engagement score: ${metrics.engagementScore}/100`,
      });
    }

    return factors;
  }

  /**
   * Calculate engagement score
   */
  private calculateEngagementScore(metrics: BehavioralMetrics): number {
    let score = 0;

    // Login frequency (30 points max)
    score += Math.min(metrics.loginFrequency * 5, 30);

    // Feature usage (25 points max)
    const featureCount = Object.keys(metrics.featureUsage).length;
    score += Math.min(featureCount * 3, 25);

    // API usage (25 points max)
    const expectedApiCalls = metrics.tier === 'free' ? 10 : metrics.tier === 'pro' ? 100 : 500;
    const apiUsageRatio = Math.min(metrics.apiCallsPerDay / expectedApiCalls, 1);
    score += apiUsageRatio * 25;

    // Recency (20 points max)
    const daysSinceActive = (Date.now() - metrics.lastActiveDate.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 20 - daysSinceActive * 2);
    score += recencyScore;

    return Math.min(Math.round(score), 100);
  }

  /**
   * Classify risk level
   */
  private classifyRiskLevel(riskScore: number): ChurnRiskProfile['riskLevel'] {
    if (riskScore >= 75) return 'critical';
    if (riskScore >= 50) return 'high';
    if (riskScore >= 25) return 'medium';
    return 'low';
  }

  /**
   * Predict churn date
   */
  private predictChurnDate(riskScore: number, metrics: BehavioralMetrics): Date | undefined {
    if (riskScore < 50) return undefined;

    // Higher risk = sooner churn
    const daysUntilChurn = Math.max(7, Math.round(100 - riskScore));

    const churnDate = new Date();
    churnDate.setDate(churnDate.getDate() + daysUntilChurn);

    return churnDate;
  }

  /**
   * Trigger interventions
   */
  private async triggerInterventions(profile: ChurnRiskProfile): Promise<void> {
    // Check if we've already sent interventions recently
    const recentInterventions = profile.interventions.filter(i => {
      const daysSince = (Date.now() - i.triggeredAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince < 7;
    });

    if (recentInterventions.length > 0) {
      logger.info('Skipping intervention - recent interventions exist', {
        userId: profile.userId,
      });
      return;
    }

    // Select appropriate intervention based on risk factors
    const topFactor = profile.factors.sort((a, b) => b.impact - a.impact)[0];

    let interventionType: Intervention['type'] = 'email';

    if (topFactor.type === 'api-usage') {
      interventionType = 'training';
    } else if (topFactor.type === 'feature-usage') {
      interventionType = 'feature-unlock';
    } else if (topFactor.type === 'support-tickets') {
      interventionType = 'support-call';
    } else if (profile.riskLevel === 'critical') {
      interventionType = 'discount';
    }

    await this.executeIntervention(profile.userId, interventionType);
  }

  /**
   * Perform intervention
   */
  private async performIntervention(userId: string, intervention: Intervention): Promise<void> {
    // In production, this would actually send emails, make API calls, etc.
    logger.info('Performing intervention', {
      userId,
      type: intervention.type,
    });

    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Get intervention cost
   */
  private getInterventionCost(type: Intervention['type']): number {
    const costs: Record<Intervention['type'], number> = {
      email: 0.5,
      discount: 10,
      'support-call': 25,
      'feature-unlock': 5,
      training: 15,
      'upgrade-offer': 20,
    };

    return costs[type] || 0;
  }

  /**
   * Generate recommendation
   */
  private generateRecommendation(
    factor: RiskFactor,
    profile: ChurnRiskProfile
  ): RetentionRecommendation | null {
    const recommendations: Record<string, RetentionRecommendation> = {
      'login-frequency': {
        title: 'Increase User Engagement',
        description: 'User has low login frequency. Consider sending feature highlights or product updates.',
        suggestedActions: [
          'Send weekly digest email with recent updates',
          'Offer a feature spotlight series',
          'Create personalized onboarding reminder',
        ],
        expectedImpact: 'medium',
        priority: 'high',
      },
      'feature-usage': {
        title: 'Improve Feature Adoption',
        description: 'User is not exploring available features. Provide guided tutorials.',
        suggestedActions: [
          'Send interactive feature tour',
          'Offer one-on-one training session',
          'Unlock premium feature trial',
        ],
        expectedImpact: 'high',
        priority: 'high',
      },
      'api-usage': {
        title: 'Boost API Integration',
        description: 'API usage is below expectations. Provide integration support.',
        suggestedActions: [
          'Share API documentation and examples',
          'Offer technical consultation call',
          'Provide SDK samples for their use case',
        ],
        expectedImpact: 'high',
        priority: 'critical',
      },
      'support-tickets': {
        title: 'Address User Frustrations',
        description: 'High support ticket volume indicates user struggles.',
        suggestedActions: [
          'Schedule priority support call',
          'Assign dedicated account manager',
          'Offer compensation or credit',
        ],
        expectedImpact: 'critical',
        priority: 'critical',
      },
      'last-active': {
        title: 'Re-engage Inactive User',
        description: 'User has been inactive. Win them back with targeted outreach.',
        suggestedActions: [
          'Send "We miss you" email campaign',
          'Offer special discount or promotion',
          'Share new features launched since last login',
        ],
        expectedImpact: 'medium',
        priority: 'high',
      },
    };

    return recommendations[factor.type] || null;
  }

  /**
   * Get behavioral metrics
   */
  private async getBehavioralMetrics(userId: string): Promise<BehavioralMetrics> {
    // In production, this would query actual user data
    // For now, return mock data or cached metrics

    return this.metrics.get(userId) || {
      userId,
      loginFrequency: 2,
      featureUsage: { posts: 10, api: 5 },
      apiCallsPerDay: 20,
      supportTickets: 1,
      lastActiveDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      accountAge: 90,
      tier: 'pro',
      mrr: 29,
      engagementScore: 50,
    };
  }

  /**
   * Initialize default campaigns
   */
  private initializeDefaultCampaigns(): void {
    const campaigns: RetentionCampaign[] = [
      {
        id: 'high-risk-discount',
        name: 'High Risk Discount Campaign',
        targetSegment: 'high-risk',
        interventionType: 'discount',
        active: true,
        metrics: {
          targetedUsers: 0,
          interventionsSent: 0,
          engagementRate: 0,
          conversionRate: 0,
          churnPrevented: 0,
          roi: 0,
        },
      },
      {
        id: 'low-engagement-training',
        name: 'Low Engagement Training',
        targetSegment: 'low-engagement',
        interventionType: 'training',
        active: true,
        metrics: {
          targetedUsers: 0,
          interventionsSent: 0,
          engagementRate: 0,
          conversionRate: 0,
          churnPrevented: 0,
          roi: 0,
        },
      },
    ];

    for (const campaign of campaigns) {
      this.campaigns.set(campaign.id, campaign);
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Churn Prediction Model (simplified ML model)
 */
class ChurnPredictionModel {
  /**
   * Predict churn risk score
   */
  predict(metrics: BehavioralMetrics, factors: RiskFactor[]): number {
    let score = 0;

    // Weight factors by impact
    const totalImpact = factors.reduce((sum, f) => sum + f.impact, 0);

    for (const factor of factors) {
      const weight = factor.impact / (totalImpact || 1);
      score += weight * 100;
    }

    // Apply engagement score inversely
    score = score * (1 - metrics.engagementScore / 100);

    // Normalize to 0-100
    return Math.min(Math.max(score, 0), 100);
  }
}

interface RetentionRecommendation {
  title: string;
  description: string;
  suggestedActions: string[];
  expectedImpact: 'low' | 'medium' | 'high' | 'critical';
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface ChurnStatistics {
  totalProfiles: number;
  byRiskLevel: Record<string, number>;
  averageRiskScore: number;
  totalInterventions: number;
  successfulInterventions: number;
  interventionSuccessRate: number;
  activeCampaigns: number;
}

// Singleton
let churnEngine: ChurnPredictionEngine;

export function getChurnPredictionEngine(): ChurnPredictionEngine {
  if (!churnEngine) {
    churnEngine = new ChurnPredictionEngine();
  }
  return churnEngine;
}

export { ChurnPredictionEngine };
