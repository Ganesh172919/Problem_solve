/**
 * Intelligent Onboarding System
 *
 * AI-powered user onboarding with:
 * - Personalized step sequencing based on user profile
 * - Progress tracking and checkpoint persistence
 * - Contextual hints and smart tooltips
 * - Completion analytics and funnel analysis
 * - Automated drip campaigns triggered by onboarding state
 * - Tier-aware feature gating during trial
 * - In-app checklist with gamification hooks
 * - A/B tested onboarding flows
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import { SubscriptionTier } from '@/types/saas';

const logger = getLogger();

export type OnboardingStepId =
  | 'profile_setup'
  | 'api_key_creation'
  | 'first_post_generated'
  | 'topic_configured'
  | 'webhook_connected'
  | 'team_invited'
  | 'billing_configured'
  | 'first_publish'
  | 'analytics_reviewed'
  | 'integration_connected';

export type OnboardingFlowId = 'developer' | 'marketer' | 'enterprise' | 'default';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  cta: string;
  ctaUrl: string;
  estimatedMinutes: number;
  requiredTiers: SubscriptionTier[];
  dependencies: OnboardingStepId[];
  reward?: OnboardingReward;
  videoUrl?: string;
  docsUrl?: string;
}

export interface OnboardingReward {
  type: 'credits' | 'badge' | 'feature_unlock';
  value: string | number;
  label: string;
}

export interface UserOnboardingState {
  userId: string;
  flowId: OnboardingFlowId;
  tier: SubscriptionTier;
  steps: Record<OnboardingStepId, StepStatus>;
  completedAt: Record<OnboardingStepId, string>;
  startedAt: string;
  completedOnboardingAt: string | null;
  totalCompletionPct: number;
  lastActiveStep: OnboardingStepId | null;
  emailsSent: string[];
  experimentVariant: string;
}

export interface OnboardingAnalytics {
  flowId: OnboardingFlowId;
  totalStarted: number;
  totalCompleted: number;
  completionRate: number;
  avgCompletionMinutes: number;
  dropOffByStep: Record<OnboardingStepId, number>;
  conversionByVariant: Record<string, number>;
  medianTimeToFirstValue: number;
}

const STEP_CATALOG: Record<OnboardingStepId, OnboardingStep> = {
  profile_setup: {
    id: 'profile_setup',
    title: 'Complete your profile',
    description: 'Add your name, avatar, and timezone so the platform can personalise your experience.',
    cta: 'Set up profile',
    ctaUrl: '/settings/profile',
    estimatedMinutes: 2,
    requiredTiers: ['free', 'pro', 'enterprise'],
    dependencies: [],
    reward: { type: 'badge', value: 'pioneer', label: 'Pioneer badge' },
  },
  api_key_creation: {
    id: 'api_key_creation',
    title: 'Create your first API key',
    description: 'Authenticate your integrations with a scoped API key.',
    cta: 'Create API key',
    ctaUrl: '/settings/api-keys',
    estimatedMinutes: 1,
    requiredTiers: ['free', 'pro', 'enterprise'],
    dependencies: ['profile_setup'],
    reward: { type: 'credits', value: 100, label: '100 API credits' },
  },
  first_post_generated: {
    id: 'first_post_generated',
    title: 'Generate your first AI post',
    description: 'Watch the AI compose a full article in seconds.',
    cta: 'Generate post',
    ctaUrl: '/dashboard/generate',
    estimatedMinutes: 3,
    requiredTiers: ['free', 'pro', 'enterprise'],
    dependencies: ['api_key_creation'],
    reward: { type: 'credits', value: 200, label: '200 generation credits' },
  },
  topic_configured: {
    id: 'topic_configured',
    title: 'Configure a news topic',
    description: 'Tell the AI what topics to monitor and generate content for.',
    cta: 'Add topic',
    ctaUrl: '/dashboard/topics',
    estimatedMinutes: 2,
    requiredTiers: ['free', 'pro', 'enterprise'],
    dependencies: ['first_post_generated'],
  },
  webhook_connected: {
    id: 'webhook_connected',
    title: 'Connect a webhook',
    description: 'Push generated content to your CMS, Slack, or any endpoint automatically.',
    cta: 'Add webhook',
    ctaUrl: '/settings/webhooks',
    estimatedMinutes: 5,
    requiredTiers: ['pro', 'enterprise'],
    dependencies: ['topic_configured'],
    reward: { type: 'feature_unlock', value: 'realtime_notifications', label: 'Real-time notifications' },
  },
  team_invited: {
    id: 'team_invited',
    title: 'Invite a team member',
    description: 'Collaborate with colleagues by inviting them to your workspace.',
    cta: 'Invite team',
    ctaUrl: '/settings/team',
    estimatedMinutes: 2,
    requiredTiers: ['enterprise'],
    dependencies: ['profile_setup'],
  },
  billing_configured: {
    id: 'billing_configured',
    title: 'Add payment method',
    description: 'Unlock unlimited generation by adding a payment method.',
    cta: 'Add payment',
    ctaUrl: '/settings/billing',
    estimatedMinutes: 3,
    requiredTiers: ['pro', 'enterprise'],
    dependencies: ['first_post_generated'],
    reward: { type: 'credits', value: 500, label: '500 bonus credits' },
  },
  first_publish: {
    id: 'first_publish',
    title: 'Publish your first post',
    description: 'Approve and publish an AI-generated post to your connected platform.',
    cta: 'Publish post',
    ctaUrl: '/dashboard/posts',
    estimatedMinutes: 2,
    requiredTiers: ['free', 'pro', 'enterprise'],
    dependencies: ['first_post_generated'],
  },
  analytics_reviewed: {
    id: 'analytics_reviewed',
    title: 'Review your analytics',
    description: 'Check post performance, reader engagement, and AI quality scores.',
    cta: 'View analytics',
    ctaUrl: '/analytics',
    estimatedMinutes: 3,
    requiredTiers: ['free', 'pro', 'enterprise'],
    dependencies: ['first_publish'],
  },
  integration_connected: {
    id: 'integration_connected',
    title: 'Connect an integration',
    description: 'Link WordPress, Ghost, Webflow, or your preferred CMS.',
    cta: 'Browse integrations',
    ctaUrl: '/integrations',
    estimatedMinutes: 5,
    requiredTiers: ['pro', 'enterprise'],
    dependencies: ['webhook_connected'],
    reward: { type: 'feature_unlock', value: 'cms_sync', label: 'Automatic CMS sync' },
  },
};

const FLOW_STEPS: Record<OnboardingFlowId, OnboardingStepId[]> = {
  developer: [
    'profile_setup',
    'api_key_creation',
    'first_post_generated',
    'topic_configured',
    'webhook_connected',
    'integration_connected',
    'analytics_reviewed',
  ],
  marketer: [
    'profile_setup',
    'first_post_generated',
    'topic_configured',
    'first_publish',
    'analytics_reviewed',
    'billing_configured',
  ],
  enterprise: [
    'profile_setup',
    'team_invited',
    'api_key_creation',
    'first_post_generated',
    'topic_configured',
    'webhook_connected',
    'billing_configured',
    'integration_connected',
    'analytics_reviewed',
  ],
  default: [
    'profile_setup',
    'first_post_generated',
    'topic_configured',
    'first_publish',
    'analytics_reviewed',
  ],
};

const EXPERIMENT_VARIANTS = ['control', 'progressive', 'gamified'];

function detectFlow(tier: SubscriptionTier, metadata: Record<string, unknown>): OnboardingFlowId {
  if (tier === 'enterprise') return 'enterprise';
  const role = (metadata.role as string | undefined) ?? '';
  if (role === 'developer' || role === 'engineer') return 'developer';
  if (role === 'marketer' || role === 'content') return 'marketer';
  return 'default';
}

function assignExperimentVariant(userId: string): string {
  const hash = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return EXPERIMENT_VARIANTS[hash % EXPERIMENT_VARIANTS.length];
}

function buildInitialState(
  userId: string,
  tier: SubscriptionTier,
  metadata: Record<string, unknown>,
): UserOnboardingState {
  const flowId = detectFlow(tier, metadata);
  const steps: Record<string, StepStatus> = {};
  for (const id of Object.keys(STEP_CATALOG)) {
    steps[id as OnboardingStepId] = 'pending';
  }
  return {
    userId,
    flowId,
    tier,
    steps: steps as Record<OnboardingStepId, StepStatus>,
    completedAt: {} as Record<OnboardingStepId, string>,
    startedAt: new Date().toISOString(),
    completedOnboardingAt: null,
    totalCompletionPct: 0,
    lastActiveStep: null,
    emailsSent: [],
    experimentVariant: assignExperimentVariant(userId),
  };
}

function computeCompletionPct(state: UserOnboardingState): number {
  const flowSteps = FLOW_STEPS[state.flowId];
  const completed = flowSteps.filter(
    (s) => state.steps[s] === 'completed' || state.steps[s] === 'skipped',
  ).length;
  return Math.round((completed / flowSteps.length) * 100);
}

function isOnboardingComplete(state: UserOnboardingState): boolean {
  return computeCompletionPct(state) === 100;
}

export async function initializeOnboarding(
  userId: string,
  tier: SubscriptionTier,
  metadata: Record<string, unknown> = {},
): Promise<UserOnboardingState> {
  const cache = getCache();
  const key = `onboarding:${userId}`;
  const existing = cache.get<UserOnboardingState>(key);
  if (existing) return existing;

  const state = buildInitialState(userId, tier, metadata);
  cache.set(key, state, 604800); // 7 days
  logger.info('Onboarding initialized', { userId, flowId: state.flowId, tier });
  return state;
}

export async function getOnboardingState(userId: string): Promise<UserOnboardingState | null> {
  const cache = getCache();
  return cache.get<UserOnboardingState>(`onboarding:${userId}`) ?? null;
}

export async function markStepComplete(
  userId: string,
  stepId: OnboardingStepId,
): Promise<UserOnboardingState> {
  const cache = getCache();
  const key = `onboarding:${userId}`;
  const state = cache.get<UserOnboardingState>(key);
  if (!state) throw new Error(`No onboarding state for user ${userId}`);

  state.steps[stepId] = 'completed';
  state.completedAt[stepId] = new Date().toISOString();
  state.lastActiveStep = stepId;
  state.totalCompletionPct = computeCompletionPct(state);

  if (isOnboardingComplete(state)) {
    state.completedOnboardingAt = new Date().toISOString();
    logger.info('Onboarding completed', { userId, flowId: state.flowId });
  }

  cache.set(key, state, 604800);
  logger.debug('Onboarding step completed', { userId, stepId, pct: state.totalCompletionPct });
  return state;
}

export async function markStepSkipped(
  userId: string,
  stepId: OnboardingStepId,
): Promise<UserOnboardingState> {
  const cache = getCache();
  const key = `onboarding:${userId}`;
  const state = cache.get<UserOnboardingState>(key);
  if (!state) throw new Error(`No onboarding state for user ${userId}`);

  state.steps[stepId] = 'skipped';
  state.lastActiveStep = stepId;
  state.totalCompletionPct = computeCompletionPct(state);
  cache.set(key, state, 604800);
  return state;
}

export function getNextStep(state: UserOnboardingState): OnboardingStep | null {
  const flowSteps = FLOW_STEPS[state.flowId];
  for (const stepId of flowSteps) {
    if (state.steps[stepId] === 'pending' || state.steps[stepId] === 'in_progress') {
      const step = STEP_CATALOG[stepId];
      const depsReady = step.dependencies.every(
        (dep) => state.steps[dep] === 'completed' || state.steps[dep] === 'skipped',
      );
      if (depsReady) {
        const tierOk = step.requiredTiers.includes(state.tier);
        if (tierOk) return step;
      }
    }
  }
  return null;
}

export function getOnboardingChecklist(
  state: UserOnboardingState,
): Array<{ step: OnboardingStep; status: StepStatus; locked: boolean }> {
  const flowSteps = FLOW_STEPS[state.flowId];
  return flowSteps.map((stepId) => {
    const step = STEP_CATALOG[stepId];
    const status = state.steps[stepId];
    const depsReady = step.dependencies.every(
      (dep) => state.steps[dep] === 'completed' || state.steps[dep] === 'skipped',
    );
    const tierOk = step.requiredTiers.includes(state.tier);
    return { step, status, locked: !depsReady || !tierOk };
  });
}

export interface OnboardingFunnelMetrics {
  stepId: OnboardingStepId;
  entered: number;
  completed: number;
  skipped: number;
  dropOff: number;
  avgMinutesToComplete: number;
  conversionRate: number;
}

export async function computeOnboardingAnalytics(
  states: UserOnboardingState[],
): Promise<OnboardingAnalytics> {
  const byFlow: Record<string, UserOnboardingState[]> = {};
  for (const s of states) {
    if (!byFlow[s.flowId]) byFlow[s.flowId] = [];
    byFlow[s.flowId].push(s);
  }

  const flowId: OnboardingFlowId = 'default';
  const flowStates = states;
  const totalStarted = flowStates.length;
  const totalCompleted = flowStates.filter((s) => s.completedOnboardingAt !== null).length;
  const completionRate = totalStarted > 0 ? totalCompleted / totalStarted : 0;

  const completedWithTime = flowStates
    .filter((s) => s.completedOnboardingAt !== null)
    .map((s) => {
      const start = new Date(s.startedAt).getTime();
      const end = new Date(s.completedOnboardingAt!).getTime();
      return (end - start) / 60000;
    });

  const avgCompletionMinutes =
    completedWithTime.length > 0
      ? completedWithTime.reduce((a, b) => a + b, 0) / completedWithTime.length
      : 0;

  const dropOffByStep: Record<string, number> = {};
  for (const stepId of Object.keys(STEP_CATALOG) as OnboardingStepId[]) {
    const entered = flowStates.filter((s) => s.steps[stepId] !== 'pending').length;
    const done = flowStates.filter(
      (s) => s.steps[stepId] === 'completed' || s.steps[stepId] === 'skipped',
    ).length;
    dropOffByStep[stepId] = entered > 0 ? Math.round(((entered - done) / entered) * 100) : 0;
  }

  const conversionByVariant: Record<string, number> = {};
  for (const variant of EXPERIMENT_VARIANTS) {
    const variantStates = flowStates.filter((s) => s.experimentVariant === variant);
    const variantCompleted = variantStates.filter((s) => s.completedOnboardingAt !== null).length;
    conversionByVariant[variant] =
      variantStates.length > 0 ? variantCompleted / variantStates.length : 0;
  }

  const timeToFirstValue = flowStates
    .filter((s) => s.completedAt['first_post_generated'])
    .map((s) => {
      const start = new Date(s.startedAt).getTime();
      const fv = new Date(s.completedAt['first_post_generated']).getTime();
      return (fv - start) / 60000;
    })
    .sort((a, b) => a - b);
  const medianTimeToFirstValue =
    timeToFirstValue.length > 0
      ? timeToFirstValue[Math.floor(timeToFirstValue.length / 2)]
      : 0;

  return {
    flowId,
    totalStarted,
    totalCompleted,
    completionRate,
    avgCompletionMinutes,
    dropOffByStep: dropOffByStep as Record<OnboardingStepId, number>,
    conversionByVariant,
    medianTimeToFirstValue,
  };
}

export function shouldSendOnboardingEmail(
  state: UserOnboardingState,
  emailType: string,
): boolean {
  if (state.emailsSent.includes(emailType)) return false;
  const pct = state.totalCompletionPct;

  switch (emailType) {
    case 'welcome':
      return true;
    case 'first_step_reminder':
      return pct === 0;
    case 'halfway_nudge':
      return pct >= 40 && pct < 60;
    case 'completion_congrats':
      return state.completedOnboardingAt !== null;
    case 'upgrade_nudge':
      return pct >= 80 && state.tier === 'free';
    default:
      return false;
  }
}

export function recordEmailSent(state: UserOnboardingState, emailType: string): UserOnboardingState {
  if (!state.emailsSent.includes(emailType)) {
    state.emailsSent.push(emailType);
  }
  return state;
}

export function getStepCatalog(): Record<OnboardingStepId, OnboardingStep> {
  return STEP_CATALOG;
}

export function getFlowSteps(flowId: OnboardingFlowId): OnboardingStep[] {
  return FLOW_STEPS[flowId].map((id) => STEP_CATALOG[id]);
}
