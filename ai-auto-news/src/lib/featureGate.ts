import { SubscriptionTier } from '@/types/saas';
import { TIER_LIMITS, FEATURE_DESCRIPTIONS } from './config';

export function hasFeature(tier: SubscriptionTier, feature: string): boolean {
  const limits = TIER_LIMITS[tier];
  return limits.features.includes(feature);
}

export function getTierLimits(tier: SubscriptionTier) {
  return TIER_LIMITS[tier];
}

export function canGenerateContent(tier: SubscriptionTier): boolean {
  return hasFeature(tier, 'generate_content');
}

export function canUseWebhooks(tier: SubscriptionTier): boolean {
  return hasFeature(tier, 'webhooks');
}

export function canAccessAnalytics(tier: SubscriptionTier): boolean {
  return hasFeature(tier, 'analytics');
}

export function canUseCustomTopics(tier: SubscriptionTier): boolean {
  return hasFeature(tier, 'custom_topics');
}

export function canWhiteLabel(tier: SubscriptionTier): boolean {
  return hasFeature(tier, 'white_label');
}

export function getAllFeaturesForTier(
  tier: SubscriptionTier,
): { feature: string; description: string; enabled: boolean }[] {
  const allFeatures = Object.keys(FEATURE_DESCRIPTIONS);
  const tierFeatures = TIER_LIMITS[tier].features;
  return allFeatures.map((feature) => ({
    feature,
    description: FEATURE_DESCRIPTIONS[feature] || feature,
    enabled: tierFeatures.includes(feature),
  }));
}

export function getUpgradePath(currentTier: SubscriptionTier): SubscriptionTier | null {
  const paths: Record<SubscriptionTier, SubscriptionTier | null> = {
    free: 'pro',
    pro: 'enterprise',
    enterprise: null,
  };
  return paths[currentTier];
}

export function getNewFeaturesOnUpgrade(
  currentTier: SubscriptionTier,
  targetTier: SubscriptionTier,
): string[] {
  const currentFeatures = new Set(TIER_LIMITS[currentTier].features);
  return TIER_LIMITS[targetTier].features.filter((f) => !currentFeatures.has(f));
}
