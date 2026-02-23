import { logger } from '@/lib/logger';
import { TIER_LIMITS } from '@/lib/config';
import { SubscriptionTier } from '@/types/saas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscountType = 'percentage' | 'fixed_amount' | 'trial_extension';

export type CouponStatus = 'active' | 'expired' | 'depleted' | 'disabled';

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  currency: string;
  applicableTiers: SubscriptionTier[];
  maxRedemptions: number | null;
  maxRedemptionsPerUser: number;
  currentRedemptions: number;
  stackable: boolean;
  campaignId: string | null;
  minimumAmount: number;
  startsAt: string;
  expiresAt: string | null;
  status: CouponStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CouponRedemption {
  id: string;
  couponId: string;
  userId: string;
  tier: SubscriptionTier;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  redeemedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  couponIds: string[];
  totalBudget: number;
  spentBudget: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  coupon: Coupon | null;
  discountAmount: number;
  finalAmount: number;
}

export interface PromoImpactReport {
  totalRedemptions: number;
  totalDiscountGiven: number;
  totalOriginalRevenue: number;
  totalFinalRevenue: number;
  revenueImpact: number;
  averageDiscountPercent: number;
  byCoupon: CouponImpact[];
  byCampaign: CampaignImpact[];
}

export interface CouponImpact {
  couponId: string;
  code: string;
  redemptions: number;
  totalDiscount: number;
  averageDiscount: number;
}

export interface CampaignImpact {
  campaignId: string;
  name: string;
  redemptions: number;
  totalDiscount: number;
  budgetUtilization: number;
}

export interface CouponPromoConfig {
  defaultCurrency: string;
  maxStackableCoupons: number;
  defaultMaxRedemptionsPerUser: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${ts}${rand}`;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CouponPromoConfig = {
  defaultCurrency: 'USD',
  maxStackableCoupons: 3,
  defaultMaxRedemptionsPerUser: 1,
};

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export class CouponPromoSystem {
  private coupons = new Map<string, Coupon>();
  private couponsByCode = new Map<string, string>(); // code -> id
  private redemptions: CouponRedemption[] = [];
  private campaigns = new Map<string, Campaign>();
  private config: CouponPromoConfig;

  constructor(config: Partial<CouponPromoConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('CouponPromoSystem initialized', { config: this.config });
  }

  // ---- coupon management --------------------------------------------------

  createCoupon(params: {
    code: string;
    description: string;
    discountType: DiscountType;
    discountValue: number;
    applicableTiers?: SubscriptionTier[];
    maxRedemptions?: number | null;
    maxRedemptionsPerUser?: number;
    stackable?: boolean;
    campaignId?: string | null;
    minimumAmount?: number;
    startsAt?: string;
    expiresAt?: string | null;
    metadata?: Record<string, unknown>;
  }): Coupon {
    const normalizedCode = params.code.toUpperCase().trim();

    if (this.couponsByCode.has(normalizedCode)) {
      throw new Error(`Coupon code already exists: ${normalizedCode}`);
    }

    if (params.discountType === 'percentage' && (params.discountValue <= 0 || params.discountValue > 100)) {
      throw new Error('Percentage discount must be between 0 and 100');
    }
    if (params.discountType === 'fixed_amount' && params.discountValue <= 0) {
      throw new Error('Fixed amount discount must be positive');
    }
    if (params.discountType === 'trial_extension' && params.discountValue < 1) {
      throw new Error('Trial extension must be at least 1 day');
    }

    const now = new Date().toISOString();
    const coupon: Coupon = {
      id: generateId('cpn'),
      code: normalizedCode,
      description: params.description,
      discountType: params.discountType,
      discountValue: params.discountValue,
      currency: this.config.defaultCurrency,
      applicableTiers: params.applicableTiers ?? ['free', 'pro', 'enterprise'],
      maxRedemptions: params.maxRedemptions ?? null,
      maxRedemptionsPerUser: params.maxRedemptionsPerUser ?? this.config.defaultMaxRedemptionsPerUser,
      currentRedemptions: 0,
      stackable: params.stackable ?? false,
      campaignId: params.campaignId ?? null,
      minimumAmount: params.minimumAmount ?? 0,
      startsAt: params.startsAt ?? now,
      expiresAt: params.expiresAt ?? null,
      status: 'active',
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    this.coupons.set(coupon.id, coupon);
    this.couponsByCode.set(normalizedCode, coupon.id);
    logger.info('Coupon created', { couponId: coupon.id, code: normalizedCode, type: coupon.discountType });
    return coupon;
  }

  disableCoupon(couponId: string): Coupon {
    const coupon = this.getCouponOrThrow(couponId);
    coupon.status = 'disabled';
    coupon.updatedAt = new Date().toISOString();
    logger.info('Coupon disabled', { couponId, code: coupon.code });
    return coupon;
  }

  // ---- automatic expiration -----------------------------------------------

  processExpirations(): Coupon[] {
    const now = new Date();
    const expired: Coupon[] = [];

    for (const coupon of this.coupons.values()) {
      if (coupon.status !== 'active') continue;

      if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) {
        coupon.status = 'expired';
        coupon.updatedAt = now.toISOString();
        expired.push(coupon);
        continue;
      }

      if (coupon.maxRedemptions !== null && coupon.currentRedemptions >= coupon.maxRedemptions) {
        coupon.status = 'depleted';
        coupon.updatedAt = now.toISOString();
        expired.push(coupon);
      }
    }

    if (expired.length > 0) {
      logger.info('Coupons expired/depleted', { count: expired.length });
    }
    return expired;
  }

  // ---- validation pipeline ------------------------------------------------

  validateCoupon(
    code: string,
    userId: string,
    tier: SubscriptionTier,
    amount: number,
    existingCoupons: string[] = [],
  ): ValidationResult {
    const normalizedCode = code.toUpperCase().trim();
    const couponId = this.couponsByCode.get(normalizedCode);

    if (!couponId) {
      return { valid: false, errors: ['Coupon code not found'], coupon: null, discountAmount: 0, finalAmount: amount };
    }

    const coupon = this.coupons.get(couponId)!;
    const errors: string[] = [];

    // Status check
    if (coupon.status !== 'active') {
      errors.push(`Coupon is ${coupon.status}`);
    }

    // Time-based eligibility
    const now = new Date();
    if (new Date(coupon.startsAt) > now) {
      errors.push('Coupon is not yet active');
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) {
      errors.push('Coupon has expired');
    }

    // Tier eligibility
    if (!coupon.applicableTiers.includes(tier)) {
      errors.push(`Coupon not applicable to ${tier} tier`);
    }

    // Global redemption limit
    if (coupon.maxRedemptions !== null && coupon.currentRedemptions >= coupon.maxRedemptions) {
      errors.push('Coupon has reached maximum redemptions');
    }

    // Per-user limit
    const userRedemptions = this.redemptions.filter(
      (r) => r.couponId === couponId && r.userId === userId,
    ).length;
    if (userRedemptions >= coupon.maxRedemptionsPerUser) {
      errors.push('You have already used this coupon the maximum number of times');
    }

    // Minimum amount
    if (amount < coupon.minimumAmount) {
      errors.push(`Minimum purchase amount of ${coupon.minimumAmount} not met`);
    }

    // Stackability check
    if (existingCoupons.length > 0) {
      if (!coupon.stackable) {
        errors.push('This coupon cannot be combined with other coupons');
      }
      const existingNonStackable = existingCoupons.some((c) => {
        const id = this.couponsByCode.get(c.toUpperCase().trim());
        return id ? !this.coupons.get(id)?.stackable : false;
      });
      if (existingNonStackable) {
        errors.push('Cannot stack with a non-stackable coupon already applied');
      }
      if (existingCoupons.length >= this.config.maxStackableCoupons) {
        errors.push(`Maximum of ${this.config.maxStackableCoupons} stackable coupons reached`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, coupon, discountAmount: 0, finalAmount: amount };
    }

    const discountAmount = this.calculateDiscount(coupon, amount, tier);
    const finalAmount = parseFloat(Math.max(0, amount - discountAmount).toFixed(2));

    return { valid: true, errors: [], coupon, discountAmount, finalAmount };
  }

  private calculateDiscount(coupon: Coupon, amount: number, tier: SubscriptionTier): number {
    switch (coupon.discountType) {
      case 'percentage':
        return parseFloat((amount * (coupon.discountValue / 100)).toFixed(2));
      case 'fixed_amount':
        return parseFloat(Math.min(coupon.discountValue, amount).toFixed(2));
      case 'trial_extension':
        // Trial extensions don't reduce amount but track the days as metadata
        return 0;
      default:
        return 0;
    }
  }

  // ---- redemption ---------------------------------------------------------

  redeemCoupon(
    code: string,
    userId: string,
    tier: SubscriptionTier,
    amount: number,
    existingCoupons: string[] = [],
  ): CouponRedemption {
    const validation = this.validateCoupon(code, userId, tier, amount, existingCoupons);
    if (!validation.valid) {
      throw new Error(`Coupon validation failed: ${validation.errors.join('; ')}`);
    }

    const coupon = validation.coupon!;
    coupon.currentRedemptions += 1;
    coupon.updatedAt = new Date().toISOString();

    if (coupon.maxRedemptions !== null && coupon.currentRedemptions >= coupon.maxRedemptions) {
      coupon.status = 'depleted';
    }

    const redemption: CouponRedemption = {
      id: generateId('rdm'),
      couponId: coupon.id,
      userId,
      tier,
      originalAmount: amount,
      discountAmount: validation.discountAmount,
      finalAmount: validation.finalAmount,
      redeemedAt: new Date().toISOString(),
    };

    this.redemptions.push(redemption);

    // Update campaign spend
    if (coupon.campaignId) {
      const campaign = this.campaigns.get(coupon.campaignId);
      if (campaign) {
        campaign.spentBudget = parseFloat((campaign.spentBudget + validation.discountAmount).toFixed(2));
      }
    }

    logger.info('Coupon redeemed', {
      couponId: coupon.id,
      code: coupon.code,
      userId,
      discountAmount: validation.discountAmount,
    });

    return redemption;
  }

  // ---- campaign management ------------------------------------------------

  createCampaign(params: {
    name: string;
    description: string;
    totalBudget: number;
    startDate: string;
    endDate: string;
    metadata?: Record<string, unknown>;
  }): Campaign {
    const campaign: Campaign = {
      id: generateId('cmp'),
      name: params.name,
      description: params.description,
      couponIds: [],
      totalBudget: params.totalBudget,
      spentBudget: 0,
      startDate: params.startDate,
      endDate: params.endDate,
      isActive: true,
      metadata: params.metadata ?? {},
      createdAt: new Date().toISOString(),
    };

    this.campaigns.set(campaign.id, campaign);
    logger.info('Campaign created', { campaignId: campaign.id, name: campaign.name });
    return campaign;
  }

  addCouponToCampaign(couponId: string, campaignId: string): void {
    const coupon = this.getCouponOrThrow(couponId);
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    coupon.campaignId = campaignId;
    coupon.updatedAt = new Date().toISOString();
    if (!campaign.couponIds.includes(couponId)) {
      campaign.couponIds.push(couponId);
    }
    logger.info('Coupon added to campaign', { couponId, campaignId });
  }

  deactivateCampaign(campaignId: string): Campaign {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
    campaign.isActive = false;

    // Disable all associated coupons
    for (const cpnId of campaign.couponIds) {
      const coupon = this.coupons.get(cpnId);
      if (coupon && coupon.status === 'active') {
        coupon.status = 'disabled';
        coupon.updatedAt = new Date().toISOString();
      }
    }

    logger.info('Campaign deactivated', { campaignId, disabledCoupons: campaign.couponIds.length });
    return campaign;
  }

  // ---- revenue impact analysis --------------------------------------------

  generateImpactReport(): PromoImpactReport {
    const totalRedemptions = this.redemptions.length;
    const totalDiscountGiven = this.redemptions.reduce((s, r) => s + r.discountAmount, 0);
    const totalOriginalRevenue = this.redemptions.reduce((s, r) => s + r.originalAmount, 0);
    const totalFinalRevenue = this.redemptions.reduce((s, r) => s + r.finalAmount, 0);
    const revenueImpact = totalFinalRevenue - totalOriginalRevenue;
    const averageDiscountPercent = totalOriginalRevenue > 0
      ? parseFloat(((totalDiscountGiven / totalOriginalRevenue) * 100).toFixed(2))
      : 0;

    // By coupon
    const couponMap = new Map<string, CouponRedemption[]>();
    for (const r of this.redemptions) {
      const arr = couponMap.get(r.couponId) ?? [];
      arr.push(r);
      couponMap.set(r.couponId, arr);
    }

    const byCoupon: CouponImpact[] = [];
    for (const [cpnId, reds] of couponMap) {
      const coupon = this.coupons.get(cpnId);
      const totalDiscount = reds.reduce((s, r) => s + r.discountAmount, 0);
      byCoupon.push({
        couponId: cpnId,
        code: coupon?.code ?? 'unknown',
        redemptions: reds.length,
        totalDiscount: parseFloat(totalDiscount.toFixed(2)),
        averageDiscount: reds.length > 0 ? parseFloat((totalDiscount / reds.length).toFixed(2)) : 0,
      });
    }

    // By campaign
    const campaignMap = new Map<string, CouponRedemption[]>();
    for (const r of this.redemptions) {
      const coupon = this.coupons.get(r.couponId);
      if (coupon?.campaignId) {
        const arr = campaignMap.get(coupon.campaignId) ?? [];
        arr.push(r);
        campaignMap.set(coupon.campaignId, arr);
      }
    }

    const byCampaign: CampaignImpact[] = [];
    for (const [cmpId, reds] of campaignMap) {
      const campaign = this.campaigns.get(cmpId);
      const totalDiscount = reds.reduce((s, r) => s + r.discountAmount, 0);
      byCampaign.push({
        campaignId: cmpId,
        name: campaign?.name ?? 'unknown',
        redemptions: reds.length,
        totalDiscount: parseFloat(totalDiscount.toFixed(2)),
        budgetUtilization: campaign && campaign.totalBudget > 0
          ? parseFloat((totalDiscount / campaign.totalBudget).toFixed(4))
          : 0,
      });
    }

    const report: PromoImpactReport = {
      totalRedemptions,
      totalDiscountGiven: parseFloat(totalDiscountGiven.toFixed(2)),
      totalOriginalRevenue: parseFloat(totalOriginalRevenue.toFixed(2)),
      totalFinalRevenue: parseFloat(totalFinalRevenue.toFixed(2)),
      revenueImpact: parseFloat(revenueImpact.toFixed(2)),
      averageDiscountPercent,
      byCoupon,
      byCampaign,
    };

    logger.info('Promo impact report generated', {
      totalRedemptions,
      totalDiscountGiven: report.totalDiscountGiven,
    });
    return report;
  }

  // ---- queries ------------------------------------------------------------

  getCoupon(couponId: string): Coupon | undefined {
    return this.coupons.get(couponId);
  }

  getCouponByCode(code: string): Coupon | undefined {
    const id = this.couponsByCode.get(code.toUpperCase().trim());
    return id ? this.coupons.get(id) : undefined;
  }

  getActiveCoupons(): Coupon[] {
    return [...this.coupons.values()].filter((c) => c.status === 'active');
  }

  getCampaign(campaignId: string): Campaign | undefined {
    return this.campaigns.get(campaignId);
  }

  getRedemptionsByUser(userId: string): CouponRedemption[] {
    return this.redemptions.filter((r) => r.userId === userId);
  }

  getRedemptionsByCoupon(couponId: string): CouponRedemption[] {
    return this.redemptions.filter((r) => r.couponId === couponId);
  }

  // ---- internals ----------------------------------------------------------

  private getCouponOrThrow(id: string): Coupon {
    const coupon = this.coupons.get(id);
    if (!coupon) throw new Error(`Coupon not found: ${id}`);
    return coupon;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__couponPromoSystem__';

export function getCouponPromoSystem(config?: Partial<CouponPromoConfig>): CouponPromoSystem {
  const g = globalThis as unknown as Record<string, CouponPromoSystem>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CouponPromoSystem(config);
  }
  return g[GLOBAL_KEY];
}
