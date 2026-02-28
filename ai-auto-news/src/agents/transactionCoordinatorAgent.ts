/**
 * @module transactionCoordinatorAgent
 * @description Autonomous agent that monitors distributed transactions for timeouts,
 * drives rollback compensation workflows, publishes outbox messages, and provides
 * real-time transaction health monitoring.
 */

import { getTransactionManager } from '../lib/crossServiceTransactionManager';
import { getLogger } from '../lib/logger';

const logger = getLogger();

class TransactionCoordinatorAgent {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly monitorIntervalMs: number;

  constructor(monitorIntervalMs = 5000) {
    this.monitorIntervalMs = monitorIntervalMs;
  }

  start(): void {
    if (this.interval) return;
    logger.info('TransactionCoordinatorAgent starting');
    this.interval = setInterval(() => this._runMonitor(), this.monitorIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('TransactionCoordinatorAgent stopped');
    }
  }

  private _runMonitor(): void {
    try {
      const manager = getTransactionManager();

      // Detect and handle timed-out transactions
      const timedOut = manager.detectTimedOutTransactions();
      for (const tx of timedOut) {
        manager.rollback(tx.id, 'timeout');
        logger.warn('Auto-rolling back timed-out transaction', { transactionId: tx.id });
      }

      // Flush outbox
      const published = manager.publishOutboxMessages((_msg) => {
        // In production, this would publish to an event bus
        return true;
      });

      if (published > 0 || timedOut.length > 0) {
        logger.debug('TransactionCoordinatorAgent cycle', { timedOut: timedOut.length, outboxPublished: published });
      }
    } catch (err) {
      logger.error('TransactionCoordinatorAgent monitor error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  getHealth(): { activeTransactions: number; pendingOutbox: number; activeLocks: number } {
    const manager = getTransactionManager();
    const summary = manager.getSummary();
    return {
      activeTransactions: summary.activeTransactions,
      pendingOutbox: summary.pendingOutboxMessages,
      activeLocks: summary.activeDistributedLocks,
    };
  }
}

const KEY = '__transactionCoordinatorAgent__';
export function getTransactionCoordinatorAgent(): TransactionCoordinatorAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new TransactionCoordinatorAgent();
  }
  return (globalThis as Record<string, unknown>)[KEY] as TransactionCoordinatorAgent;
}
