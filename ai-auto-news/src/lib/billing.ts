import { SubscriptionTier, BillingRecord } from '@/types/saas';
import { TIER_LIMITS } from './config';

export function getMonthlyPrice(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].monthlyPriceUsd;
}

export function getUpgradeCostProrated(
  currentTier: SubscriptionTier,
  newTier: SubscriptionTier,
  daysRemainingInCycle: number,
): number {
  const currentPrice = getMonthlyPrice(currentTier);
  const newPrice = getMonthlyPrice(newTier);
  const dailyDiff = (newPrice - currentPrice) / 30;
  const prorated = dailyDiff * daysRemainingInCycle;
  return Math.max(0, parseFloat(prorated.toFixed(2)));
}

export function generateBillingRecord(params: {
  userId: string;
  tier: SubscriptionTier;
  months?: number;
}): BillingRecord {
  const months = params.months || 1;
  const amount = getMonthlyPrice(params.tier) * months;
  return {
    id: crypto.randomUUID(),
    userId: params.userId,
    tier: params.tier,
    amount,
    currency: 'USD',
    description: `AI Auto News ${params.tier.charAt(0).toUpperCase() + params.tier.slice(1)} plan — ${months} month(s)`,
    createdAt: new Date().toISOString(),
  };
}

export function estimateMonthlyApiCost(
  apiCalls: number,
  tier: SubscriptionTier,
): { included: boolean; overageCallCount: number; estimatedOverageCost: number } {
  const limit = TIER_LIMITS[tier].apiCallsPerDay * 30;
  if (apiCalls <= limit) {
    return { included: true, overageCallCount: 0, estimatedOverageCost: 0 };
  }
  const overage = apiCalls - limit;
  const overageCostPerCall = tier === 'free' ? 0 : 0.001;
  return {
    included: false,
    overageCallCount: overage,
    estimatedOverageCost: parseFloat((overage * overageCostPerCall).toFixed(4)),
  };
}

export function getTierComparison(): {
  feature: string;
  free: string | boolean;
  pro: string | boolean;
  enterprise: string | boolean;
}[] {
  const fmt = (n: number) => (n >= 1_000_000 ? 'Unlimited' : n.toLocaleString());
  return [
    {
      feature: 'Monthly Price',
      free: '$0/mo',
      pro: `$${TIER_LIMITS.pro.monthlyPriceUsd}/mo`,
      enterprise: `$${TIER_LIMITS.enterprise.monthlyPriceUsd}/mo`,
    },
    {
      feature: 'API Calls / Day',
      free: fmt(TIER_LIMITS.free.apiCallsPerDay),
      pro: fmt(TIER_LIMITS.pro.apiCallsPerDay),
      enterprise: fmt(TIER_LIMITS.enterprise.apiCallsPerDay),
    },
    {
      feature: 'API Calls / Minute',
      free: fmt(TIER_LIMITS.free.apiCallsPerMinute),
      pro: fmt(TIER_LIMITS.pro.apiCallsPerMinute),
      enterprise: fmt(TIER_LIMITS.enterprise.apiCallsPerMinute),
    },
    {
      feature: 'Max API Keys',
      free: String(TIER_LIMITS.free.maxApiKeys),
      pro: String(TIER_LIMITS.pro.maxApiKeys),
      enterprise: String(TIER_LIMITS.enterprise.maxApiKeys),
    },
    { feature: 'Content Generation', free: false, pro: true, enterprise: true },
    { feature: 'Webhooks', free: false, pro: true, enterprise: true },
    { feature: 'Analytics', free: false, pro: true, enterprise: true },
    { feature: 'Custom Topics', free: false, pro: true, enterprise: true },
    { feature: 'White Label', free: false, pro: false, enterprise: true },
    { feature: 'SSO', free: false, pro: false, enterprise: true },
    { feature: 'Priority Support', free: false, pro: false, enterprise: true },
    { feature: 'Audit Logs', free: false, pro: false, enterprise: true },
  ];
}
