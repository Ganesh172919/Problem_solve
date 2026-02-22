/**
 * Viral Growth Engine
 *
 * Implements viral loops, referral systems, and growth mechanisms to
 * increase user acquisition and engagement organically.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface ReferralProgram {
  id: string;
  name: string;
  active: boolean;
  referrerReward: Reward;
  refereeReward: Reward;
  conditions: ReferralCondition[];
  tiers: RewardTier[];
  expiresAt?: Date;
}

export interface Reward {
  type: 'credits' | 'discount' | 'upgrade' | 'feature_unlock' | 'custom';
  value: number;
  description: string;
  validityDays?: number;
}

export interface ReferralCondition {
  type: 'signup' | 'payment' | 'usage' | 'engagement';
  threshold?: number;
  description: string;
}

export interface RewardTier {
  referralCount: number;
  multiplier: number;
  bonusReward?: Reward;
}

export interface ReferralCode {
  code: string;
  userId: string;
  programId: string;
  createdAt: Date;
  expiresAt?: Date;
  uses: number;
  maxUses?: number;
}

export interface ReferralEvent {
  id: string;
  code: string;
  referrerId: string;
  refereeId: string;
  programId: string;
  status: 'pending' | 'completed' | 'rewarded' | 'cancelled';
  createdAt: Date;
  completedAt?: Date;
  rewardsIssued: boolean;
}

export interface ViralLoop {
  id: string;
  name: string;
  type: 'invite' | 'share' | 'challenge' | 'collaborative' | 'network';
  trigger: LoopTrigger;
  incentive: LoopIncentive;
  viralCoefficient: number; // K-factor
  conversionRate: number;
  active: boolean;
}

export interface LoopTrigger {
  event: string;
  frequency: 'once' | 'daily' | 'weekly' | 'on_action';
  conditions: string[];
}

export interface LoopIncentive {
  type: 'reward' | 'gamification' | 'social' | 'utility';
  description: string;
  value: any;
}

export interface GrowthMetrics {
  period: { start: Date; end: Date };
  newUsers: number;
  organicUsers: number;
  referredUsers: number;
  viralCoefficient: number; // K-factor
  referralRate: number;
  conversionRate: number;
  retentionRate: number;
  activations: number;
  churnRate: number;
}

export interface ShareableContent {
  id: string;
  type: 'post' | 'achievement' | 'result' | 'invite';
  userId: string;
  content: string;
  url: string;
  metadata: Record<string, any>;
  shares: ShareEvent[];
  views: number;
  conversions: number;
}

export interface ShareEvent {
  id: string;
  contentId: string;
  platform: 'twitter' | 'linkedin' | 'facebook' | 'email' | 'link';
  sharedBy: string;
  sharedAt: Date;
  clicks: number;
  conversions: number;
}

class ViralGrowthEngine {
  private programs: Map<string, ReferralProgram> = new Map();
  private codes: Map<string, ReferralCode> = new Map();
  private referralEvents: ReferralEvent[] = [];
  private viralLoops: Map<string, ViralLoop> = new Map();
  private shareableContent: Map<string, ShareableContent> = new Map();

  constructor() {
    this.initializeDefaultProgram();
    this.initializeViralLoops();
  }

  /**
   * Create referral program
   */
  createProgram(program: Omit<ReferralProgram, 'id'>): ReferralProgram {
    const id = `program_${Date.now()}`;

    const newProgram: ReferralProgram = {
      ...program,
      id,
    };

    this.programs.set(id, newProgram);

    logger.info('Referral program created', {
      id,
      name: program.name,
      referrerReward: program.referrerReward.type,
    });

    return newProgram;
  }

  /**
   * Generate referral code for user
   */
  generateReferralCode(
    userId: string,
    programId: string,
    options?: { maxUses?: number; expiresAt?: Date }
  ): ReferralCode {
    const code = this.generateCode(userId);

    const referralCode: ReferralCode = {
      code,
      userId,
      programId,
      createdAt: new Date(),
      expiresAt: options?.expiresAt,
      uses: 0,
      maxUses: options?.maxUses,
    };

    this.codes.set(code, referralCode);

    logger.info('Referral code generated', { userId, code, programId });

    return referralCode;
  }

  /**
   * Apply referral code
   */
  async applyReferralCode(code: string, refereeId: string): Promise<ReferralEvent> {
    const referralCode = this.codes.get(code);

    if (!referralCode) {
      throw new Error('Invalid referral code');
    }

    if (referralCode.expiresAt && referralCode.expiresAt < new Date()) {
      throw new Error('Referral code expired');
    }

    if (referralCode.maxUses && referralCode.uses >= referralCode.maxUses) {
      throw new Error('Referral code max uses reached');
    }

    // Create referral event
    const event: ReferralEvent = {
      id: `ref_${Date.now()}`,
      code,
      referrerId: referralCode.userId,
      refereeId,
      programId: referralCode.programId,
      status: 'pending',
      createdAt: new Date(),
      rewardsIssued: false,
    };

    this.referralEvents.push(event);

    // Increment uses
    referralCode.uses++;

    logger.info('Referral code applied', {
      code,
      referrerId: referralCode.userId,
      refereeId,
    });

    return event;
  }

  /**
   * Complete referral and issue rewards
   */
  async completeReferral(eventId: string): Promise<void> {
    const event = this.referralEvents.find(e => e.id === eventId);

    if (!event) {
      throw new Error('Referral event not found');
    }

    if (event.status !== 'pending') {
      throw new Error('Referral already completed');
    }

    const program = this.programs.get(event.programId);

    if (!program) {
      throw new Error('Referral program not found');
    }

    // Check conditions
    const conditionsMet = await this.checkConditions(event, program.conditions);

    if (!conditionsMet) {
      logger.warn('Referral conditions not met', { eventId });
      return;
    }

    // Calculate rewards with tiers
    const referralCount = this.getReferralCount(event.referrerId, event.programId);
    const tier = this.getTier(referralCount, program.tiers);

    // Issue rewards
    await this.issueReward(
      event.referrerId,
      program.referrerReward,
      tier.multiplier,
      'referrer'
    );
    await this.issueReward(event.refereeId, program.refereeReward, 1, 'referee');

    // Issue bonus if applicable
    if (tier.bonusReward) {
      await this.issueReward(event.referrerId, tier.bonusReward, 1, 'bonus');
    }

    // Update event
    event.status = 'completed';
    event.completedAt = new Date();
    event.rewardsIssued = true;

    logger.info('Referral completed', {
      eventId,
      referrerId: event.referrerId,
      refereeId: event.refereeId,
      tier: tier.referralCount,
    });
  }

  /**
   * Create viral loop
   */
  createViralLoop(loop: Omit<ViralLoop, 'id'>): ViralLoop {
    const id = `loop_${Date.now()}`;

    const newLoop: ViralLoop = {
      ...loop,
      id,
    };

    this.viralLoops.set(id, newLoop);

    logger.info('Viral loop created', {
      id,
      name: loop.name,
      type: loop.type,
    });

    return newLoop;
  }

  /**
   * Trigger viral loop
   */
  async triggerViralLoop(
    loopId: string,
    userId: string,
    context: Record<string, any>
  ): Promise<void> {
    const loop = this.viralLoops.get(loopId);

    if (!loop || !loop.active) {
      return;
    }

    // Check conditions
    const shouldTrigger = this.evaluateLoopConditions(loop.trigger.conditions, context);

    if (!shouldTrigger) {
      return;
    }

    // Execute loop action based on type
    switch (loop.type) {
      case 'invite':
        await this.executeInviteLoop(loop, userId);
        break;

      case 'share':
        await this.executeShareLoop(loop, userId, context);
        break;

      case 'challenge':
        await this.executeChallengeLoop(loop, userId);
        break;

      case 'collaborative':
        await this.executeCollaborativeLoop(loop, userId);
        break;

      case 'network':
        await this.executeNetworkLoop(loop, userId);
        break;
    }

    logger.info('Viral loop triggered', {
      loopId,
      userId,
      type: loop.type,
    });
  }

  /**
   * Create shareable content
   */
  createShareableContent(
    content: Omit<ShareableContent, 'id' | 'shares' | 'views' | 'conversions'>
  ): ShareableContent {
    const id = `share_${Date.now()}`;

    const shareable: ShareableContent = {
      ...content,
      id,
      shares: [],
      views: 0,
      conversions: 0,
    };

    this.shareableContent.set(id, shareable);

    return shareable;
  }

  /**
   * Track share event
   */
  async trackShare(
    contentId: string,
    platform: ShareEvent['platform'],
    userId: string
  ): Promise<void> {
    const content = this.shareableContent.get(contentId);

    if (!content) {
      throw new Error('Shareable content not found');
    }

    const shareEvent: ShareEvent = {
      id: `share_${Date.now()}`,
      contentId,
      platform,
      sharedBy: userId,
      sharedAt: new Date(),
      clicks: 0,
      conversions: 0,
    };

    content.shares.push(shareEvent);

    logger.info('Share tracked', {
      contentId,
      platform,
      userId,
    });
  }

  /**
   * Calculate growth metrics
   */
  async calculateGrowthMetrics(period: { start: Date; end: Date }): Promise<GrowthMetrics> {
    const periodEvents = this.referralEvents.filter(
      e => e.createdAt >= period.start && e.createdAt <= period.end
    );

    const referredUsers = new Set(periodEvents.map(e => e.refereeId)).size;
    const newUsers = referredUsers + 500; // Simplified - would get from user db
    const organicUsers = newUsers - referredUsers;

    const completedReferrals = periodEvents.filter(e => e.status === 'completed').length;

    const viralCoefficient = referredUsers > 0 ? completedReferrals / referredUsers : 0;
    const referralRate = newUsers > 0 ? referredUsers / newUsers : 0;
    const conversionRate = periodEvents.length > 0 ? completedReferrals / periodEvents.length : 0;

    return {
      period,
      newUsers,
      organicUsers,
      referredUsers,
      viralCoefficient,
      referralRate,
      conversionRate,
      retentionRate: 0.75, // Would calculate from actual data
      activations: completedReferrals,
      churnRate: 0.05, // Would calculate from actual data
    };
  }

  /**
   * Get user referral stats
   */
  getUserReferralStats(userId: string): {
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    rewardsEarned: number;
    tier: number;
  } {
    const userEvents = this.referralEvents.filter(e => e.referrerId === userId);

    return {
      totalReferrals: userEvents.length,
      successfulReferrals: userEvents.filter(e => e.status === 'completed').length,
      pendingReferrals: userEvents.filter(e => e.status === 'pending').length,
      rewardsEarned: userEvents.filter(e => e.rewardsIssued).length,
      tier: this.getCurrentTier(userId),
    };
  }

  // Private helper methods

  private initializeDefaultProgram(): void {
    this.createProgram({
      name: 'Standard Referral',
      active: true,
      referrerReward: {
        type: 'credits',
        value: 10,
        description: '$10 in credits',
        validityDays: 365,
      },
      refereeReward: {
        type: 'credits',
        value: 5,
        description: '$5 in credits',
        validityDays: 90,
      },
      conditions: [
        {
          type: 'signup',
          description: 'Referee must sign up',
        },
        {
          type: 'payment',
          description: 'Referee must make first payment',
        },
      ],
      tiers: [
        { referralCount: 0, multiplier: 1 },
        { referralCount: 5, multiplier: 1.2 },
        { referralCount: 10, multiplier: 1.5 },
        {
          referralCount: 25,
          multiplier: 2,
          bonusReward: {
            type: 'upgrade',
            value: 1,
            description: 'Free month of Pro',
          },
        },
      ],
    });
  }

  private initializeViralLoops(): void {
    // Share achievement loop
    this.createViralLoop({
      name: 'Share Achievement',
      type: 'share',
      trigger: {
        event: 'achievement_unlocked',
        frequency: 'on_action',
        conditions: ['achievement_rare'],
      },
      incentive: {
        type: 'social',
        description: 'Show off your achievement',
        value: null,
      },
      viralCoefficient: 0.15,
      conversionRate: 0.05,
      active: true,
    });

    // Collaborative content loop
    this.createViralLoop({
      name: 'Collaborative Content',
      type: 'collaborative',
      trigger: {
        event: 'content_created',
        frequency: 'on_action',
        conditions: ['quality_high'],
      },
      incentive: {
        type: 'utility',
        description: 'Collaborate with others',
        value: null,
      },
      viralCoefficient: 0.3,
      conversionRate: 0.1,
      active: true,
    });
  }

  private generateCode(userId: string): string {
    const base = userId.substring(0, 4).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${base}${random}`;
  }

  private async checkConditions(
    event: ReferralEvent,
    conditions: ReferralCondition[]
  ): Promise<boolean> {
    // Simplified - would check actual user data
    return true;
  }

  private getReferralCount(userId: string, programId: string): number {
    return this.referralEvents.filter(
      e =>
        e.referrerId === userId && e.programId === programId && e.status === 'completed'
    ).length;
  }

  private getTier(referralCount: number, tiers: RewardTier[]): RewardTier {
    const sorted = tiers.sort((a, b) => b.referralCount - a.referralCount);
    return sorted.find(t => referralCount >= t.referralCount) || tiers[0];
  }

  private async issueReward(
    userId: string,
    reward: Reward,
    multiplier: number,
    reason: string
  ): Promise<void> {
    const finalValue = reward.value * multiplier;

    logger.info('Reward issued', {
      userId,
      type: reward.type,
      value: finalValue,
      reason,
    });

    // Would actually credit user account
  }

  private evaluateLoopConditions(
    conditions: string[],
    context: Record<string, any>
  ): boolean {
    // Simplified condition evaluation
    return true;
  }

  private async executeInviteLoop(loop: ViralLoop, userId: string): Promise<void> {
    // Generate invite link and prompt user
  }

  private async executeShareLoop(
    loop: ViralLoop,
    userId: string,
    context: Record<string, any>
  ): Promise<void> {
    // Create shareable content and prompt user
  }

  private async executeChallengeLoop(loop: ViralLoop, userId: string): Promise<void> {
    // Create challenge invitation
  }

  private async executeCollaborativeLoop(loop: ViralLoop, userId: string): Promise<void> {
    // Create collaboration opportunity
  }

  private async executeNetworkLoop(loop: ViralLoop, userId: string): Promise<void> {
    // Trigger network effect mechanism
  }

  private getCurrentTier(userId: string): number {
    const count = this.getReferralCount(userId, 'program_default');
    if (count >= 25) return 4;
    if (count >= 10) return 3;
    if (count >= 5) return 2;
    return 1;
  }
}

// Singleton
let viralGrowthEngine: ViralGrowthEngine;

export function getViralGrowthEngine(): ViralGrowthEngine {
  if (!viralGrowthEngine) {
    viralGrowthEngine = new ViralGrowthEngine();
  }
  return viralGrowthEngine;
}
