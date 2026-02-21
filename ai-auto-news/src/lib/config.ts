import { SubscriptionTier, TierLimits } from '@/types/saas';

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    tier: 'free',
    postsPerHour: 2,
    apiCallsPerDay: 100,
    apiCallsPerMinute: 10,
    maxApiKeys: 2,
    features: ['read_posts', 'api_access'],
    monthlyPriceUsd: 0,
  },
  pro: {
    tier: 'pro',
    postsPerHour: 20,
    apiCallsPerDay: 10_000,
    apiCallsPerMinute: 100,
    maxApiKeys: 10,
    features: [
      'read_posts',
      'api_access',
      'generate_content',
      'analytics',
      'webhooks',
      'custom_topics',
    ],
    monthlyPriceUsd: 29,
  },
  enterprise: {
    tier: 'enterprise',
    postsPerHour: 200,
    apiCallsPerDay: 1_000_000,
    apiCallsPerMinute: 1000,
    maxApiKeys: 100,
    features: [
      'read_posts',
      'api_access',
      'generate_content',
      'analytics',
      'webhooks',
      'custom_topics',
      'priority_support',
      'white_label',
      'sso',
      'audit_logs',
    ],
    monthlyPriceUsd: 299,
  },
};

export const APP_CONFIG = {
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '300000', 10),
  apiVersions: ['v1'] as const,
  maxPaginationLimit: 100,
  defaultPaginationLimit: 10,
  apiKeyPrefix: 'aian_',
  apiKeyLength: 32,
  cacheDefaultTtlSeconds: 60,
  cacheLongTtlSeconds: 300,
  taskQueueIntervalMs: parseInt(process.env.TASK_QUEUE_INTERVAL_MS || '10000', 10),
  webhookTimeoutMs: 10_000,
  webhookMaxRetries: 3,
  metricsWindowMs: 60_000,
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
} as const;

export const FEATURE_DESCRIPTIONS: Record<string, string> = {
  read_posts: 'Read and query published posts via API',
  api_access: 'Access the REST API with an API key',
  generate_content: 'Trigger on-demand AI content generation',
  analytics: 'Access detailed analytics and usage reports',
  webhooks: 'Receive real-time event notifications via webhooks',
  custom_topics: 'Define custom research topics for content generation',
  priority_support: 'Priority email and chat support',
  white_label: 'Remove AI Auto News branding',
  sso: 'Single sign-on via SAML or OIDC',
  audit_logs: 'Full audit trail of all actions',
};
