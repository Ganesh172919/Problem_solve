export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  tier: SubscriptionTier;
  apiCallsTotal: number;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  isActive: boolean;
  isVerified: boolean;
}

export interface UserRow extends Omit<User, 'isActive' | 'isVerified'> {
  isActive: number;
  isVerified: number;
}

export interface Subscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRow extends Omit<Subscription, 'cancelAtPeriodEnd'> {
  cancelAtPeriodEnd: number;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  callCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ApiKeyRow extends Omit<ApiKey, 'scopes' | 'isActive'> {
  scopes: string;
  isActive: number;
}

export interface UsageEvent {
  id: string;
  userId: string | null;
  apiKeyId: string | null;
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  tokensUsed: number;
  tier: SubscriptionTier | 'admin' | 'public';
  ipAddress: string;
  createdAt: string;
}

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabledTiers: SubscriptionTier[];
  isGlobal: boolean;
  rolloutPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagRow extends Omit<FeatureFlag, 'enabledTiers' | 'isGlobal'> {
  enabledTiers: string;
  isGlobal: number;
}

export interface AnalyticsEvent {
  id: string;
  userId: string | null;
  sessionId: string | null;
  eventName: string;
  properties: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AnalyticsEventRow extends Omit<AnalyticsEvent, 'properties'> {
  properties: string;
}

export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  deliveryCount: number;
  failureCount: number;
  lastDeliveredAt: string | null;
  createdAt: string;
}

export interface WebhookRow extends Omit<Webhook, 'events' | 'isActive'> {
  events: string;
  isActive: number;
}

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string;
}

export interface TaskRow extends Omit<Task, 'payload'> {
  payload: string;
}

export interface TierLimits {
  tier: SubscriptionTier;
  postsPerHour: number;
  apiCallsPerDay: number;
  apiCallsPerMinute: number;
  maxApiKeys: number;
  features: string[];
  monthlyPriceUsd: number;
}

export interface BillingRecord {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  amount: number;
  currency: string;
  description: string;
  createdAt: string;
}

export interface MetricSnapshot {
  endpoint: string;
  method: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  requestCount: number;
  errorCount: number;
  windowStart: string;
  windowEnd: string;
}

export interface RecommendedPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  score: number;
  reason: string;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  goal: string;
  steps: AgentStep[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  result: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentStep {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  durationMs: number | null;
}
