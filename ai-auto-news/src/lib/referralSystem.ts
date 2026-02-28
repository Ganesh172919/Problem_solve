import { v4 as uuidv4 } from 'uuid';

interface ReferralProgram {
  id: string;
  name: string;
  description: string;
  rewardType: 'credit' | 'discount' | 'tier_upgrade' | 'cash';
  rewardAmount: number;
  rewardCurrency?: string;
  minReferrals: number;
  maxReferrals?: number;
  expiryDays?: number;
  isActive: boolean;
}

interface Referral {
  id: string;
  code: string;
  referrerId: string;
  referredId?: string;
  programId: string;
  status: 'pending' | 'active' | 'completed' | 'expired' | 'invalid';
  rewardAmount?: number;
  rewardedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

interface ReferralStats {
  totalReferrals: number;
  activeReferrals: number;
  completedReferrals: number;
  totalRewards: number;
  conversionRate: number;
  topReferrers: Array<{
    userId: string;
    referrals: number;
    rewards: number;
  }>;
}

export class ReferralSystem {
  private programs: Map<string, ReferralProgram> = new Map();
  private referrals: Map<string, Referral> = new Map();
  private referralsByCode: Map<string, string> = new Map();
  private userReferrals: Map<string, string[]> = new Map();

  /**
   * Create a referral program
   */
  createProgram(program: Omit<ReferralProgram, 'id'>): ReferralProgram {
    const id = uuidv4();
    const newProgram: ReferralProgram = { id, ...program };
    this.programs.set(id, newProgram);
    return newProgram;
  }

  /**
   * Get referral program
   */
  getProgram(programId: string): ReferralProgram | null {
    return this.programs.get(programId) || null;
  }

  /**
   * Generate referral code
   */
  private generateReferralCode(userId: string): string {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const userPart = userId.substring(0, 4).toUpperCase();
    return `${userPart}${randomPart}`;
  }

  /**
   * Create referral link for user
   */
  createReferral(
    referrerId: string,
    programId: string,
    customCode?: string
  ): Referral {
    const program = this.programs.get(programId);
    if (!program || !program.isActive) {
      throw new Error('Invalid or inactive referral program');
    }

    // Check if user has reached max referrals
    const userReferralIds = this.userReferrals.get(referrerId) || [];
    const activeReferrals = userReferralIds
      .map(id => this.referrals.get(id))
      .filter(r => r && r.status === 'active').length;

    if (program.maxReferrals && activeReferrals >= program.maxReferrals) {
      throw new Error('Maximum referrals reached');
    }

    // Generate unique code
    let code = customCode || this.generateReferralCode(referrerId);
    let attempts = 0;
    while (this.referralsByCode.has(code) && attempts < 10) {
      code = this.generateReferralCode(referrerId);
      attempts++;
    }

    if (this.referralsByCode.has(code)) {
      throw new Error('Could not generate unique referral code');
    }

    const id = uuidv4();
    const referral: Referral = {
      id,
      code,
      referrerId,
      programId,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: program.expiryDays
        ? new Date(Date.now() + program.expiryDays * 24 * 60 * 60 * 1000)
        : undefined,
    };

    this.referrals.set(id, referral);
    this.referralsByCode.set(code, id);

    // Track user referrals
    if (!this.userReferrals.has(referrerId)) {
      this.userReferrals.set(referrerId, []);
    }
    this.userReferrals.get(referrerId)!.push(id);

    return referral;
  }

  /**
   * Apply referral code (when new user signs up)
   */
  applyReferralCode(code: string, referredUserId: string): Referral | null {
    const referralId = this.referralsByCode.get(code);
    if (!referralId) return null;

    const referral = this.referrals.get(referralId);
    if (!referral) return null;

    // Check if referral is valid
    if (referral.status !== 'pending') {
      return null;
    }

    if (referral.expiresAt && referral.expiresAt < new Date()) {
      referral.status = 'expired';
      return null;
    }

    // Prevent self-referral
    if (referral.referrerId === referredUserId) {
      referral.status = 'invalid';
      return null;
    }

    // Activate referral
    referral.referredId = referredUserId;
    referral.status = 'active';

    return referral;
  }

  /**
   * Complete referral (when referred user meets criteria)
   */
  completeReferral(referralId: string): Referral | null {
    const referral = this.referrals.get(referralId);
    if (!referral || referral.status !== 'active') {
      return null;
    }

    const program = this.programs.get(referral.programId);
    if (!program) return null;

    // Mark as completed and award reward
    referral.status = 'completed';
    referral.rewardAmount = program.rewardAmount;
    referral.rewardedAt = new Date();

    return referral;
  }

  /**
   * Get user's referrals
   */
  getUserReferrals(userId: string): Referral[] {
    const referralIds = this.userReferrals.get(userId) || [];
    return referralIds
      .map(id => this.referrals.get(id))
      .filter(r => r !== undefined) as Referral[];
  }

  /**
   * Get referral by code
   */
  getReferralByCode(code: string): Referral | null {
    const referralId = this.referralsByCode.get(code);
    return referralId ? this.referrals.get(referralId) || null : null;
  }

  /**
   * Get referral statistics
   */
  getStats(programId?: string): ReferralStats {
    const referrals = Array.from(this.referrals.values()).filter(
      r => !programId || r.programId === programId
    );

    const totalReferrals = referrals.length;
    const activeReferrals = referrals.filter(r => r.status === 'active').length;
    const completedReferrals = referrals.filter(r => r.status === 'completed').length;
    const totalRewards = referrals
      .filter(r => r.rewardAmount)
      .reduce((sum, r) => sum + (r.rewardAmount || 0), 0);

    // Calculate conversion rate
    const conversionRate = activeReferrals > 0
      ? (completedReferrals / (activeReferrals + completedReferrals)) * 100
      : 0;

    // Top referrers
    const referrerStats: Map<string, { referrals: number; rewards: number }> = new Map();
    for (const referral of referrals) {
      const stats = referrerStats.get(referral.referrerId) || { referrals: 0, rewards: 0 };
      stats.referrals++;
      if (referral.rewardAmount) {
        stats.rewards += referral.rewardAmount;
      }
      referrerStats.set(referral.referrerId, stats);
    }

    const topReferrers = Array.from(referrerStats.entries())
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, 10);

    return {
      totalReferrals,
      activeReferrals,
      completedReferrals,
      totalRewards,
      conversionRate,
      topReferrers,
    };
  }

  /**
   * Calculate referral rewards for user
   */
  getUserRewards(userId: string): {
    totalEarned: number;
    pending: number;
    completed: number;
  } {
    const referrals = this.getUserReferrals(userId);

    const totalEarned = referrals
      .filter(r => r.rewardAmount)
      .reduce((sum, r) => sum + (r.rewardAmount || 0), 0);

    const pending = referrals.filter(r => r.status === 'active').length;
    const completed = referrals.filter(r => r.status === 'completed').length;

    return { totalEarned, pending, completed };
  }

  /**
   * Generate referral share URL
   */
  generateShareURL(
    code: string,
    baseUrl: string = 'https://yourdomain.com'
  ): string {
    return `${baseUrl}/signup?ref=${code}`;
  }

  /**
   * Generate social media share links
   */
  generateSocialLinks(code: string, baseUrl: string = 'https://yourdomain.com'): {
    twitter: string;
    facebook: string;
    linkedin: string;
    email: string;
  } {
    const shareUrl = this.generateShareURL(code, baseUrl);
    const message = encodeURIComponent('Check out this awesome AI-powered news platform!');

    return {
      twitter: `https://twitter.com/intent/tweet?text=${message}&url=${encodeURIComponent(shareUrl)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
      email: `mailto:?subject=${encodeURIComponent('Join AI Auto News')}&body=${message}%20${encodeURIComponent(shareUrl)}`,
    };
  }

  /**
   * Track referral conversion funnel
   */
  trackConversionFunnel(referralId: string, step: string, metadata?: Record<string, any>): void {
    const referral = this.referrals.get(referralId);
    if (!referral) return;

    if (!referral.metadata) {
      referral.metadata = {};
    }

    if (!referral.metadata.funnel) {
      referral.metadata.funnel = [];
    }

    referral.metadata.funnel.push({
      step,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  /**
   * Cleanup expired referrals
   */
  cleanupExpiredReferrals(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [id, referral] of this.referrals) {
      if (
        referral.status === 'pending' &&
        referral.expiresAt &&
        referral.expiresAt < now
      ) {
        referral.status = 'expired';
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Export referral data
   */
  exportData(programId?: string): any[] {
    return Array.from(this.referrals.values())
      .filter(r => !programId || r.programId === programId)
      .map(r => ({
        code: r.code,
        referrerId: r.referrerId,
        referredId: r.referredId,
        status: r.status,
        rewardAmount: r.rewardAmount,
        createdAt: r.createdAt,
        completedAt: r.rewardedAt,
      }));
  }
}

// Singleton instance
let referralSystemInstance: ReferralSystem | null = null;

export function getReferralSystem(): ReferralSystem {
  if (!referralSystemInstance) {
    referralSystemInstance = new ReferralSystem();

    // Initialize default program
    referralSystemInstance.createProgram({
      name: 'Standard Referral Program',
      description: 'Refer friends and earn rewards',
      rewardType: 'credit',
      rewardAmount: 10,
      minReferrals: 1,
      maxReferrals: 100,
      expiryDays: 90,
      isActive: true,
    });
  }
  return referralSystemInstance;
}

export type { ReferralProgram, Referral, ReferralStats };
