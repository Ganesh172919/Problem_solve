interface CircuitState {
  status: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextAttemptTime?: number;
}

interface CircuitBreakerConfig {
  failureThreshold: number;  // Number of failures before opening
  successThreshold: number;  // Number of successes in half-open before closing
  timeout: number;           // Time in ms before trying again (half-open)
  resetTimeout: number;      // Time in ms to reset failure count
}

interface RequestLog {
  timestamp: number;
  success: boolean;
  duration: number;
  error?: string;
}

export class CircuitBreaker {
  private state: CircuitState;
  private config: CircuitBreakerConfig;
  private requestLog: RequestLog[] = [];
  private readonly MAX_LOG_SIZE = 1000;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 60000,  // 1 minute
      resetTimeout: config.resetTimeout || 300000,  // 5 minutes
    };

    this.state = {
      status: 'closed',
      failureCount: 0,
      successCount: 0,
    };
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.status === 'open') {
      if (this.shouldAttemptReset()) {
        this.state.status = 'half-open';
        console.log('Circuit breaker transitioning to half-open');
      } else {
        throw new Error('Circuit breaker is OPEN - rejecting request');
      }
    }

    const startTime = Date.now();

    try {
      const result = await fn();
      this.onSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.onFailure(Date.now() - startTime, error);
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  private onSuccess(duration: number): void {
    this.logRequest(true, duration);

    this.state.lastSuccessTime = Date.now();
    this.state.successCount++;

    if (this.state.status === 'half-open') {
      if (this.state.successCount >= this.config.successThreshold) {
        this.close();
      }
    } else if (this.state.status === 'closed') {
      // Reset failure count after success
      this.state.failureCount = 0;
    }
  }

  /**
   * Handle failed request
   */
  private onFailure(duration: number, error: any): void {
    this.logRequest(false, duration, error.message);

    this.state.lastFailureTime = Date.now();
    this.state.failureCount++;

    if (this.state.status === 'half-open') {
      this.open();
    } else if (this.state.status === 'closed') {
      if (this.state.failureCount >= this.config.failureThreshold) {
        this.open();
      }
    }
  }

  /**
   * Open circuit breaker
   */
  private open(): void {
    this.state.status = 'open';
    this.state.nextAttemptTime = Date.now() + this.config.timeout;
    console.error('Circuit breaker OPENED - rejecting requests');
  }

  /**
   * Close circuit breaker
   */
  private close(): void {
    this.state.status = 'closed';
    this.state.failureCount = 0;
    this.state.successCount = 0;
    this.state.nextAttemptTime = undefined;
    console.log('Circuit breaker CLOSED - accepting requests');
  }

  /**
   * Check if should attempt reset
   */
  private shouldAttemptReset(): boolean {
    return (
      this.state.nextAttemptTime !== undefined &&
      Date.now() >= this.state.nextAttemptTime
    );
  }

  /**
   * Log request
   */
  private logRequest(success: boolean, duration: number, error?: string): void {
    this.requestLog.push({
      timestamp: Date.now(),
      success,
      duration,
      error,
    });

    // Trim log if too large
    if (this.requestLog.length > this.MAX_LOG_SIZE) {
      this.requestLog = this.requestLog.slice(-this.MAX_LOG_SIZE);
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return { ...this.state };
  }

  /**
   * Get statistics
   */
  getStatistics(windowMs: number = 60000): {
    totalRequests: number;
    successRate: number;
    failureRate: number;
    avgDuration: number;
    recentErrors: string[];
  } {
    const cutoff = Date.now() - windowMs;
    const recentLogs = this.requestLog.filter(log => log.timestamp >= cutoff);

    const totalRequests = recentLogs.length;
    const successes = recentLogs.filter(log => log.success).length;
    const failures = totalRequests - successes;

    const avgDuration = totalRequests > 0
      ? recentLogs.reduce((sum, log) => sum + log.duration, 0) / totalRequests
      : 0;

    const recentErrors = recentLogs
      .filter(log => !log.success && log.error)
      .slice(-5)
      .map(log => log.error!);

    return {
      totalRequests,
      successRate: totalRequests > 0 ? (successes / totalRequests) * 100 : 0,
      failureRate: totalRequests > 0 ? (failures / totalRequests) * 100 : 0,
      avgDuration,
      recentErrors,
    };
  }

  /**
   * Force open
   */
  forceOpen(): void {
    this.open();
  }

  /**
   * Force close
   */
  forceClose(): void {
    this.close();
  }

  /**
   * Reset
   */
  reset(): void {
    this.state = {
      status: 'closed',
      failureCount: 0,
      successCount: 0,
    };
    this.requestLog = [];
  }
}

/**
 * Circuit Breaker Manager - manages multiple circuit breakers
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create circuit breaker
   */
  getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(config));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Execute with named circuit breaker
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const breaker = this.getBreaker(name, config);
    return await breaker.execute(fn);
  }

  /**
   * Get all breakers status
   */
  getAllStatus(): Record<string, CircuitState> {
    const status: Record<string, CircuitState> = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getState();
    }
    return status;
  }

  /**
   * Get all breakers statistics
   */
  getAllStatistics(): Record<string, ReturnType<CircuitBreaker['getStatistics']>> {
    const stats: Record<string, ReturnType<CircuitBreaker['getStatistics']>> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStatistics();
    }
    return stats;
  }

  /**
   * Reset all breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Remove breaker
   */
  removeBreaker(name: string): void {
    this.breakers.delete(name);
  }
}

// Singleton instance
let circuitBreakerManagerInstance: CircuitBreakerManager | null = null;

export function getCircuitBreakerManager(): CircuitBreakerManager {
  if (!circuitBreakerManagerInstance) {
    circuitBreakerManagerInstance = new CircuitBreakerManager();
  }
  return circuitBreakerManagerInstance;
}

// Pre-configured breakers for common services
export const SERVICE_BREAKERS = {
  GEMINI: 'gemini-api',
  PERPLEXITY: 'perplexity-api',
  DATABASE: 'database',
  REDIS: 'redis',
  STRIPE: 'stripe',
  EMAIL: 'email',
};

export type { CircuitState, CircuitBreakerConfig };
