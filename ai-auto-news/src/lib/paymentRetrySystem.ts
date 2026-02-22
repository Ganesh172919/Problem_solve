/**
 * Payment Retry Logic with Smart Scheduling
 *
 * Intelligent payment retry system:
 * - Exponential backoff scheduling
 * - Multiple payment method fallback
 * - Customer communication automation
 * - Retry analytics and optimization
 * - Dunning management
 * - Recovery rate tracking
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface PaymentAttempt {
  id: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  attemptNumber: number;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired';
  failureReason?: string;
  scheduledAt: Date;
  attemptedAt?: Date;
  completedAt?: Date;
  nextRetryAt?: Date;
}

export interface RetryStrategy {
  id: string;
  name: string;
  maxAttempts: number;
  retryIntervals: number[]; // hours between retries
  notificationSchedule: number[]; // attempt numbers when to notify
  escalationThreshold: number; // attempt number when to escalate
  giveUpThreshold: number; // attempt number when to give up
}

export interface PaymentFailure {
  userId: string;
  subscriptionId: string;
  failureCount: number;
  firstFailureAt: Date;
  lastFailureAt: Date;
  totalAttempts: number;
  recoveryStatus: 'active' | 'recovered' | 'cancelled' | 'expired';
  estimatedRecoveryProbability: number;
}

export interface DunningCampaign {
  id: string;
  userId: string;
  stage: 'early' | 'middle' | 'late' | 'final';
  communicationsSent: number;
  lastContactAt: Date;
  responseReceived: boolean;
  paymentMethodUpdated: boolean;
  resolved: boolean;
}

export interface RetryMetrics {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  recoveryRate: number;
  averageAttemptsToSuccess: number;
  revenueRecovered: number;
  revenueAtRisk: number;
}

class PaymentRetrySystem {
  private attempts: Map<string, PaymentAttempt> = new Map();
  private failures: Map<string, PaymentFailure> = new Map();
  private campaigns: Map<string, DunningCampaign> = new Map();
  private strategies: Map<string, RetryStrategy> = new Map();
  private processingInterval?: NodeJS.Timeout;

  constructor() {
    this.initializeStrategies();
    this.startProcessing();
  }

  /**
   * Schedule payment retry
   */
  async scheduleRetry(
    userId: string,
    subscriptionId: string,
    amount: number,
    currency: string,
    paymentMethodId: string,
    strategyId: string = 'standard'
  ): Promise<string> {
    const strategy = this.strategies.get(strategyId);

    if (!strategy) {
      throw new Error(`Retry strategy not found: ${strategyId}`);
    }

    // Get or create failure record
    const failureKey = `${userId}:${subscriptionId}`;
    let failure = this.failures.get(failureKey);

    if (!failure) {
      failure = {
        userId,
        subscriptionId,
        failureCount: 0,
        firstFailureAt: new Date(),
        lastFailureAt: new Date(),
        totalAttempts: 0,
        recoveryStatus: 'active',
        estimatedRecoveryProbability: 0.8,
      };
      this.failures.set(failureKey, failure);
    }

    // Calculate next retry time
    const attemptNumber = failure.totalAttempts + 1;

    if (attemptNumber > strategy.maxAttempts) {
      logger.warn('Max retry attempts exceeded', { userId, subscriptionId });
      failure.recoveryStatus = 'expired';
      return '';
    }

    const retryInterval = strategy.retryIntervals[Math.min(attemptNumber - 1, strategy.retryIntervals.length - 1)];
    const scheduledAt = new Date(Date.now() + retryInterval * 60 * 60 * 1000);

    // Create retry attempt
    const attemptId = this.generateId('attempt');
    const attempt: PaymentAttempt = {
      id: attemptId,
      userId,
      subscriptionId,
      amount,
      currency,
      paymentMethodId,
      attemptNumber,
      status: 'pending',
      scheduledAt,
    };

    this.attempts.set(attemptId, attempt);

    // Update failure record
    failure.totalAttempts++;
    failure.lastFailureAt = new Date();
    failure.estimatedRecoveryProbability = this.calculateRecoveryProbability(failure);

    // Schedule notification if needed
    if (strategy.notificationSchedule.includes(attemptNumber)) {
      await this.sendNotification(userId, attemptNumber, scheduledAt);
    }

    // Start dunning campaign if needed
    if (attemptNumber === strategy.escalationThreshold) {
      await this.startDunningCampaign(userId, subscriptionId);
    }

    logger.info('Payment retry scheduled', {
      attemptId,
      userId,
      attemptNumber,
      scheduledAt,
    });

    return attemptId;
  }

  /**
   * Process payment attempt
   */
  async processAttempt(attemptId: string): Promise<boolean> {
    const attempt = this.attempts.get(attemptId);

    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }

    if (attempt.status !== 'pending') {
      logger.warn('Attempt already processed', { attemptId, status: attempt.status });
      return false;
    }

    attempt.status = 'processing';
    attempt.attemptedAt = new Date();

    try {
      // In production, this would call actual payment processor
      const success = await this.executePayment(attempt);

      if (success) {
        attempt.status = 'succeeded';
        attempt.completedAt = new Date();

        // Update failure record
        const failureKey = `${attempt.userId}:${attempt.subscriptionId}`;
        const failure = this.failures.get(failureKey);

        if (failure) {
          failure.recoveryStatus = 'recovered';
        }

        // Close dunning campaign
        await this.closeDunningCampaign(attempt.userId);

        logger.info('Payment retry succeeded', {
          attemptId,
          userId: attempt.userId,
          attemptNumber: attempt.attemptNumber,
        });

        return true;
      } else {
        attempt.status = 'failed';
        attempt.failureReason = 'Payment declined';

        // Schedule next retry
        await this.scheduleRetry(
          attempt.userId,
          attempt.subscriptionId,
          attempt.amount,
          attempt.currency,
          attempt.paymentMethodId
        );

        logger.warn('Payment retry failed', {
          attemptId,
          userId: attempt.userId,
          attemptNumber: attempt.attemptNumber,
        });

        return false;
      }
    } catch (error: any) {
      attempt.status = 'failed';
      attempt.failureReason = error.message;

      logger.error('Payment retry error', error, { attemptId });

      return false;
    }
  }

  /**
   * Get retry metrics
   */
  getMetrics(): RetryMetrics {
    const allAttempts = Array.from(this.attempts.values());

    const successfulRetries = allAttempts.filter(a => a.status === 'succeeded' && a.attemptNumber > 1).length;
    const failedRetries = allAttempts.filter(a => a.status === 'failed').length;
    const totalAttempts = allAttempts.length;

    const recoveryRate = totalAttempts > 0 ? successfulRetries / totalAttempts : 0;

    // Calculate average attempts to success
    const successfulAttempts = allAttempts.filter(a => a.status === 'succeeded');
    const avgAttemptsToSuccess = successfulAttempts.length > 0
      ? successfulAttempts.reduce((sum, a) => sum + a.attemptNumber, 0) / successfulAttempts.length
      : 0;

    // Calculate revenue metrics
    const revenueRecovered = allAttempts
      .filter(a => a.status === 'succeeded' && a.attemptNumber > 1)
      .reduce((sum, a) => sum + a.amount, 0);

    const revenueAtRisk = Array.from(this.failures.values())
      .filter(f => f.recoveryStatus === 'active')
      .length * 29; // Approximate average subscription value

    return {
      totalAttempts,
      successfulRetries,
      failedRetries,
      recoveryRate,
      averageAttemptsToSuccess: Math.round(avgAttemptsToSuccess * 10) / 10,
      revenueRecovered,
      revenueAtRisk,
    };
  }

  /**
   * Get at-risk subscriptions
   */
  getAtRiskSubscriptions(): PaymentFailure[] {
    return Array.from(this.failures.values())
      .filter(f => f.recoveryStatus === 'active')
      .sort((a, b) => b.totalAttempts - a.totalAttempts);
  }

  /**
   * Start dunning campaign
   */
  private async startDunningCampaign(userId: string, subscriptionId: string): Promise<void> {
    const campaignId = this.generateId('campaign');

    const campaign: DunningCampaign = {
      id: campaignId,
      userId,
      stage: 'early',
      communicationsSent: 0,
      lastContactAt: new Date(),
      responseReceived: false,
      paymentMethodUpdated: false,
      resolved: false,
    };

    this.campaigns.set(campaignId, campaign);

    // Send first dunning email
    await this.sendDunningEmail(userId, 'early');

    campaign.communicationsSent++;

    logger.info('Dunning campaign started', { campaignId, userId });
  }

  /**
   * Close dunning campaign
   */
  private async closeDunningCampaign(userId: string): Promise<void> {
    for (const campaign of this.campaigns.values()) {
      if (campaign.userId === userId && !campaign.resolved) {
        campaign.resolved = true;

        logger.info('Dunning campaign closed', { campaignId: campaign.id, userId });
      }
    }
  }

  /**
   * Send notification
   */
  private async sendNotification(userId: string, attemptNumber: number, nextRetryAt: Date): Promise<void> {
    logger.info('Sending retry notification', {
      userId,
      attemptNumber,
      nextRetryAt,
    });

    // In production, this would send actual email/SMS
  }

  /**
   * Send dunning email
   */
  private async sendDunningEmail(userId: string, stage: DunningCampaign['stage']): Promise<void> {
    logger.info('Sending dunning email', { userId, stage });

    // In production, this would send actual email
  }

  /**
   * Execute payment
   */
  private async executePayment(attempt: PaymentAttempt): Promise<boolean> {
    // Mock payment execution
    // In production, this would call Stripe, PayPal, etc.

    // Simulate success rate based on attempt number
    const successRate = Math.max(0.2, 0.8 - (attempt.attemptNumber * 0.1));
    return Math.random() < successRate;
  }

  /**
   * Calculate recovery probability
   */
  private calculateRecoveryProbability(failure: PaymentFailure): number {
    // Base probability
    let probability = 0.8;

    // Decrease with each failure
    probability -= failure.failureCount * 0.1;

    // Decrease with age
    const daysSinceFirst = (Date.now() - failure.firstFailureAt.getTime()) / (1000 * 60 * 60 * 24);
    probability -= Math.min(daysSinceFirst * 0.02, 0.3);

    return Math.max(0.1, Math.min(probability, 1));
  }

  /**
   * Start processing loop
   */
  private startProcessing(): void {
    this.processingInterval = setInterval(async () => {
      const now = new Date();

      // Find attempts ready for processing
      const readyAttempts = Array.from(this.attempts.values()).filter(
        a => a.status === 'pending' && a.scheduledAt <= now
      );

      for (const attempt of readyAttempts) {
        try {
          await this.processAttempt(attempt.id);
        } catch (error) {
          logger.error('Error processing payment attempt', error);
        }
      }
    }, 60000); // Check every minute

    logger.info('Payment retry processing started');
  }

  /**
   * Stop processing
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  /**
   * Initialize retry strategies
   */
  private initializeStrategies(): void {
    const strategies: RetryStrategy[] = [
      {
        id: 'standard',
        name: 'Standard Retry Strategy',
        maxAttempts: 7,
        retryIntervals: [1, 3, 5, 7, 14, 21, 30], // hours
        notificationSchedule: [1, 3, 5, 7],
        escalationThreshold: 3,
        giveUpThreshold: 7,
      },
      {
        id: 'aggressive',
        name: 'Aggressive Retry Strategy',
        maxAttempts: 10,
        retryIntervals: [0.5, 1, 2, 4, 8, 12, 24, 48, 72, 96],
        notificationSchedule: [1, 2, 4, 6, 8],
        escalationThreshold: 2,
        giveUpThreshold: 10,
      },
      {
        id: 'gentle',
        name: 'Gentle Retry Strategy',
        maxAttempts: 4,
        retryIntervals: [24, 72, 168, 336], // 1 day, 3 days, 1 week, 2 weeks
        notificationSchedule: [1, 3],
        escalationThreshold: 3,
        giveUpThreshold: 4,
      },
    ];

    for (const strategy of strategies) {
      this.strategies.set(strategy.id, strategy);
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton
let paymentRetrySystem: PaymentRetrySystem;

export function getPaymentRetrySystem(): PaymentRetrySystem {
  if (!paymentRetrySystem) {
    paymentRetrySystem = new PaymentRetrySystem();
  }
  return paymentRetrySystem;
}

export { PaymentRetrySystem };
