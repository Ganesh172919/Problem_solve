import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthState = 'healthy' | 'draining' | 'shuttingDown' | 'terminated';

interface ShutdownHook {
  name: string;
  handler: () => void | Promise<void>;
  priority: number;
  timeoutMs: number;
}

interface DrainableConnection {
  id: string;
  close: () => void | Promise<void>;
  registeredAt: number;
}

interface ShutdownMetrics {
  hooksRegistered: number;
  hooksExecuted: number;
  hooksFailed: number;
  hooksTimedOut: number;
  connectionsRegistered: number;
  connectionsDrained: number;
  shutdownDurationMs: number | null;
}

// ─── ShutdownCoordinator ──────────────────────────────────────────────────────

export class ShutdownCoordinator {
  private hooks: ShutdownHook[] = [];
  private connections: Map<string, DrainableConnection> = new Map();
  private state: HealthState = 'healthy';
  private shutdownPromise: Promise<void> | null = null;
  private signalHandlers: Map<string, () => void> = new Map();
  private metrics: ShutdownMetrics = {
    hooksRegistered: 0,
    hooksExecuted: 0,
    hooksFailed: 0,
    hooksTimedOut: 0,
    connectionsRegistered: 0,
    connectionsDrained: 0,
    shutdownDurationMs: null,
  };
  private defaultHookTimeout: number;
  private globalTimeout: number;

  constructor(options?: {
    defaultHookTimeout?: number;
    globalTimeout?: number;
    registerSignalHandlers?: boolean;
  }) {
    this.defaultHookTimeout = options?.defaultHookTimeout ?? 10000;
    this.globalTimeout = options?.globalTimeout ?? 30000;

    if (options?.registerSignalHandlers !== false) {
      this.registerSignalHandlers();
    }

    logger.info('ShutdownCoordinator initialized', {
      defaultHookTimeout: this.defaultHookTimeout,
      globalTimeout: this.globalTimeout,
    });
  }

  getState(): HealthState {
    return this.state;
  }

  isHealthy(): boolean {
    return this.state === 'healthy';
  }

  registerHook(
    name: string,
    handler: () => void | Promise<void>,
    options?: { priority?: number; timeoutMs?: number },
  ): void {
    if (this.state !== 'healthy') {
      logger.warn('ShutdownCoordinator: cannot register hook during shutdown', { name, state: this.state });
      return;
    }

    if (!name || typeof handler !== 'function') {
      throw new Error('ShutdownCoordinator: hook requires a name and handler function');
    }

    // Prevent duplicate names
    const existing = this.hooks.findIndex((h) => h.name === name);
    if (existing !== -1) {
      this.hooks.splice(existing, 1);
      logger.debug('ShutdownCoordinator: replacing existing hook', { name });
    }

    const hook: ShutdownHook = {
      name,
      handler,
      priority: options?.priority ?? 0,
      timeoutMs: options?.timeoutMs ?? this.defaultHookTimeout,
    };

    this.hooks.push(hook);
    // Sort descending by priority so higher priority runs first
    this.hooks.sort((a, b) => b.priority - a.priority);
    this.metrics.hooksRegistered = this.hooks.length;

    logger.debug('ShutdownCoordinator: hook registered', { name, priority: hook.priority });
  }

  removeHook(name: string): boolean {
    const idx = this.hooks.findIndex((h) => h.name === name);
    if (idx === -1) return false;
    this.hooks.splice(idx, 1);
    this.metrics.hooksRegistered = this.hooks.length;
    logger.debug('ShutdownCoordinator: hook removed', { name });
    return true;
  }

  registerConnection(id: string, close: () => void | Promise<void>): void {
    if (this.state !== 'healthy') {
      logger.warn('ShutdownCoordinator: cannot register connection during shutdown', { id });
      return;
    }

    this.connections.set(id, { id, close, registeredAt: Date.now() });
    this.metrics.connectionsRegistered++;
    logger.debug('ShutdownCoordinator: connection registered', { id });
  }

  removeConnection(id: string): boolean {
    const removed = this.connections.delete(id);
    if (removed) {
      logger.debug('ShutdownCoordinator: connection removed', { id });
    }
    return removed;
  }

  async shutdown(): Promise<void> {
    // Ensure shutdown runs only once; return existing promise if already running
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.executeShutdown();
    return this.shutdownPromise;
  }

  getMetrics(): ShutdownMetrics {
    return { ...this.metrics };
  }

  getRegisteredHooks(): ReadonlyArray<{ name: string; priority: number; timeoutMs: number }> {
    return this.hooks.map((h) => ({ name: h.name, priority: h.priority, timeoutMs: h.timeoutMs }));
  }

  getActiveConnections(): number {
    return this.connections.size;
  }

  destroy(): void {
    this.removeSignalHandlers();
    this.hooks = [];
    this.connections.clear();
    this.state = 'healthy';
    this.shutdownPromise = null;
    this.metrics = {
      hooksRegistered: 0,
      hooksExecuted: 0,
      hooksFailed: 0,
      hooksTimedOut: 0,
      connectionsRegistered: 0,
      connectionsDrained: 0,
      shutdownDurationMs: null,
    };
    logger.info('ShutdownCoordinator destroyed');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async executeShutdown(): Promise<void> {
    const startTime = Date.now();
    logger.info('ShutdownCoordinator: initiating graceful shutdown', {
      hooks: this.hooks.length,
      connections: this.connections.size,
    });

    // Global timeout to force termination
    const globalTimer = setTimeout(() => {
      logger.error('ShutdownCoordinator: global timeout reached, forcing termination');
      this.state = 'terminated';
    }, this.globalTimeout);

    if (typeof globalTimer === 'object' && 'unref' in globalTimer) {
      globalTimer.unref();
    }

    try {
      // Phase 1: Draining
      this.state = 'draining';
      logger.info('ShutdownCoordinator: draining connections', { count: this.connections.size });
      await this.drainConnections();

      // Phase 2: Shutting down
      if (this.state === 'terminated') return;
      this.state = 'shuttingDown';
      logger.info('ShutdownCoordinator: executing shutdown hooks', { count: this.hooks.length });
      await this.executeHooks();

      // Phase 3: Terminated
      this.state = 'terminated';
      this.metrics.shutdownDurationMs = Date.now() - startTime;
      logger.info('ShutdownCoordinator: shutdown complete', {
        durationMs: this.metrics.shutdownDurationMs,
        executed: this.metrics.hooksExecuted,
        failed: this.metrics.hooksFailed,
        timedOut: this.metrics.hooksTimedOut,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('ShutdownCoordinator: unexpected error during shutdown', error);
      this.state = 'terminated';
    } finally {
      clearTimeout(globalTimer);
      this.removeSignalHandlers();
    }
  }

  private async drainConnections(): Promise<void> {
    const entries = Array.from(this.connections.values());
    const results = await Promise.allSettled(
      entries.map(async (conn) => {
        try {
          await Promise.resolve(conn.close());
          this.metrics.connectionsDrained++;
          logger.debug('ShutdownCoordinator: connection drained', { id: conn.id });
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error('ShutdownCoordinator: failed to drain connection', error, { id: conn.id });
        }
      }),
    );

    // Clear all connections regardless of outcome
    this.connections.clear();

    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      logger.warn('ShutdownCoordinator: some connections failed to drain', { failures });
    }
  }

  private async executeHooks(): Promise<void> {
    // Hooks are already sorted by priority (descending)
    for (const hook of this.hooks) {
      if (this.state === 'terminated') {
        logger.warn('ShutdownCoordinator: aborting hooks, global timeout reached');
        break;
      }

      try {
        await this.executeHookWithTimeout(hook);
        this.metrics.hooksExecuted++;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (error.message === 'HOOK_TIMEOUT') {
          this.metrics.hooksTimedOut++;
          logger.error('ShutdownCoordinator: hook timed out', undefined, {
            name: hook.name,
            timeoutMs: hook.timeoutMs,
          });
        } else {
          this.metrics.hooksFailed++;
          logger.error('ShutdownCoordinator: hook failed', error, { name: hook.name });
        }
      }
    }
  }

  private executeHookWithTimeout(hook: ShutdownHook): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('HOOK_TIMEOUT'));
      }, hook.timeoutMs);

      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }

      try {
        const result = hook.handler();
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>)
            .then(() => {
              clearTimeout(timer);
              resolve();
            })
            .catch((err: unknown) => {
              clearTimeout(timer);
              reject(err instanceof Error ? err : new Error(String(err)));
            });
        } else {
          clearTimeout(timer);
          resolve();
        }
      } catch (err: unknown) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private registerSignalHandlers(): void {
    if (typeof process === 'undefined' || !process.on) return;

    const handler = () => {
      logger.info('ShutdownCoordinator: received shutdown signal');
      this.shutdown().catch((err: unknown) => {
        logger.error(
          'ShutdownCoordinator: shutdown failed after signal',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    };

    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, handler);
      this.signalHandlers.set(signal, handler);
    }
  }

  private removeSignalHandlers(): void {
    if (typeof process === 'undefined' || !process.removeListener) return;

    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers.clear();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export function getShutdownCoordinator(): ShutdownCoordinator {
  const g = globalThis as unknown as Record<string, ShutdownCoordinator>;
  if (!g.__shutdownCoordinator__) {
    g.__shutdownCoordinator__ = new ShutdownCoordinator();
  }
  return g.__shutdownCoordinator__;
}
