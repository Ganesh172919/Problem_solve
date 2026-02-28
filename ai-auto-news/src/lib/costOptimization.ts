interface CostMetrics {
  totalCost: number;
  breakdown: {
    ai: number;
    database: number;
    storage: number;
    bandwidth: number;
    compute: number;
    other: number;
  };
  period: {
    start: Date;
    end: Date;
  };
}

interface CostAlert {
  id: string;
  threshold: number;
  currentCost: number;
  triggered: boolean;
  triggeredAt?: Date;
  notificationsSent: number;
}

interface OptimizationRecommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  estimatedSavings: number;
  savingsPercentage: number;
  effort: 'low' | 'medium' | 'high';
  priority: 'low' | 'medium' | 'high' | 'critical';
  implementation: string;
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
}

interface ResourceUsage {
  resource: string;
  current: number;
  limit: number;
  utilizationPercentage: number;
  cost: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export class CostOptimizationEngine {
  private costs: CostMetrics[] = [];
  private alerts: Map<string, CostAlert> = new Map();
  private recommendations: Map<string, OptimizationRecommendation> = new Map();
  private resourceUsage: Map<string, ResourceUsage> = new Map();

  // Cost rates (example rates)
  private readonly RATES = {
    AI_GEMINI_INPUT: 0.00025 / 1000,  // per 1K tokens
    AI_GEMINI_OUTPUT: 0.0005 / 1000,
    AI_PERPLEXITY: 0.001 / 1000,
    DATABASE_READ: 0.000001,  // per read
    DATABASE_WRITE: 0.000005,
    STORAGE_GB: 0.02,  // per GB/month
    BANDWIDTH_GB: 0.09,  // per GB
    COMPUTE_HOUR: 0.05,  // per hour
  };

  /**
   * Track AI cost
   */
  trackAICost(provider: string, inputTokens: number, outputTokens: number): number {
    const cost = provider === 'gemini'
      ? inputTokens * this.RATES.AI_GEMINI_INPUT + outputTokens * this.RATES.AI_GEMINI_OUTPUT
      : inputTokens * this.RATES.AI_PERPLEXITY;

    this.addCost('ai', cost);
    return cost;
  }

  /**
   * Track database cost
   */
  trackDatabaseCost(reads: number, writes: number): number {
    const cost = reads * this.RATES.DATABASE_READ + writes * this.RATES.DATABASE_WRITE;
    this.addCost('database', cost);
    return cost;
  }

  /**
   * Track storage cost
   */
  trackStorageCost(sizeGB: number): number {
    const cost = sizeGB * this.RATES.STORAGE_GB;
    this.addCost('storage', cost);
    return cost;
  }

  /**
   * Track bandwidth cost
   */
  trackBandwidthCost(sizeGB: number): number {
    const cost = sizeGB * this.RATES.BANDWIDTH_GB;
    this.addCost('bandwidth', cost);
    return cost;
  }

  /**
   * Track compute cost
   */
  trackComputeCost(hours: number): number {
    const cost = hours * this.RATES.COMPUTE_HOUR;
    this.addCost('compute', cost);
    return cost;
  }

  /**
   * Add cost to current period
   */
  private addCost(category: keyof CostMetrics['breakdown'], amount: number): void {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    let currentPeriod = this.costs.find(
      c => c.period.start.getTime() === startOfMonth.getTime()
    );

    if (!currentPeriod) {
      currentPeriod = {
        totalCost: 0,
        breakdown: {
          ai: 0,
          database: 0,
          storage: 0,
          bandwidth: 0,
          compute: 0,
          other: 0,
        },
        period: {
          start: startOfMonth,
          end: endOfMonth,
        },
      };
      this.costs.push(currentPeriod);
    }

    currentPeriod.breakdown[category] += amount;
    currentPeriod.totalCost += amount;

    // Check alerts
    this.checkAlerts(currentPeriod.totalCost);
  }

  /**
   * Set cost alert
   */
  setCostAlert(threshold: number): string {
    const id = `alert_${Date.now()}`;
    this.alerts.set(id, {
      id,
      threshold,
      currentCost: this.getCurrentCost(),
      triggered: false,
      notificationsSent: 0,
    });
    return id;
  }

  /**
   * Check alerts
   */
  private checkAlerts(currentCost: number): void {
    for (const alert of this.alerts.values()) {
      if (!alert.triggered && currentCost >= alert.threshold) {
        alert.triggered = true;
        alert.triggeredAt = new Date();
        alert.currentCost = currentCost;
        this.sendCostAlert(alert);
      }
    }
  }

  /**
   * Send cost alert
   */
  private sendCostAlert(alert: CostAlert): void {
    console.warn(`COST ALERT: Current cost $${alert.currentCost.toFixed(2)} exceeds threshold $${alert.threshold.toFixed(2)}`);
    alert.notificationsSent++;
  }

  /**
   * Get current cost
   */
  getCurrentCost(): number {
    const now = new Date();
    const currentPeriod = this.costs.find(
      c => c.period.start <= now && c.period.end >= now
    );
    return currentPeriod?.totalCost || 0;
  }

  /**
   * Get cost metrics
   */
  getCostMetrics(period?: { start: Date; end: Date }): CostMetrics[] {
    if (!period) {
      return this.costs;
    }

    return this.costs.filter(
      c => c.period.start >= period.start && c.period.end <= period.end
    );
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const currentCost = this.getCurrentCost();
    const currentPeriod = this.costs.find(
      c => c.period.start <= new Date() && c.period.end >= new Date()
    );

    if (!currentPeriod) return [];

    // AI cost optimization
    if (currentPeriod.breakdown.ai > currentCost * 0.4) {
      recommendations.push({
        id: 'ai-cache',
        category: 'AI',
        title: 'Implement AI Response Caching',
        description: 'Cache common AI responses to reduce redundant API calls',
        estimatedSavings: currentPeriod.breakdown.ai * 0.3,
        savingsPercentage: 30,
        effort: 'medium',
        priority: 'high',
        implementation: 'Add Redis caching layer for AI responses with 24-hour TTL',
        status: 'pending',
      });

      recommendations.push({
        id: 'ai-model-optimization',
        category: 'AI',
        title: 'Optimize AI Model Usage',
        description: 'Use cheaper models for simple tasks, reserve advanced models for complex operations',
        estimatedSavings: currentPeriod.breakdown.ai * 0.2,
        savingsPercentage: 20,
        effort: 'low',
        priority: 'high',
        implementation: 'Implement model routing based on task complexity',
        status: 'pending',
      });
    }

    // Database optimization
    if (currentPeriod.breakdown.database > currentCost * 0.2) {
      recommendations.push({
        id: 'db-query-optimization',
        category: 'Database',
        title: 'Optimize Database Queries',
        description: 'Add indexes and optimize slow queries',
        estimatedSavings: currentPeriod.breakdown.database * 0.4,
        savingsPercentage: 40,
        effort: 'medium',
        priority: 'high',
        implementation: 'Run EXPLAIN ANALYZE on slow queries and add appropriate indexes',
        status: 'pending',
      });

      recommendations.push({
        id: 'db-connection-pooling',
        category: 'Database',
        title: 'Implement Connection Pooling',
        description: 'Reduce database connection overhead',
        estimatedSavings: currentPeriod.breakdown.database * 0.15,
        savingsPercentage: 15,
        effort: 'low',
        priority: 'medium',
        implementation: 'Configure Prisma connection pooling with optimal pool size',
        status: 'pending',
      });
    }

    // Storage optimization
    if (currentPeriod.breakdown.storage > currentCost * 0.15) {
      recommendations.push({
        id: 'storage-compression',
        category: 'Storage',
        title: 'Enable Data Compression',
        description: 'Compress stored content to reduce storage costs',
        estimatedSavings: currentPeriod.breakdown.storage * 0.5,
        savingsPercentage: 50,
        effort: 'low',
        priority: 'medium',
        implementation: 'Enable gzip compression for text content',
        status: 'pending',
      });
    }

    // Bandwidth optimization
    if (currentPeriod.breakdown.bandwidth > currentCost * 0.1) {
      recommendations.push({
        id: 'cdn-implementation',
        category: 'Bandwidth',
        title: 'Implement CDN',
        description: 'Use CDN to reduce bandwidth costs and improve performance',
        estimatedSavings: currentPeriod.breakdown.bandwidth * 0.6,
        savingsPercentage: 60,
        effort: 'medium',
        priority: 'high',
        implementation: 'Configure CloudFront or Cloudflare CDN',
        status: 'pending',
      });
    }

    // Store recommendations
    recommendations.forEach(rec => {
      this.recommendations.set(rec.id, rec);
    });

    return recommendations;
  }

  /**
   * Get recommendations
   */
  getRecommendations(status?: OptimizationRecommendation['status']): OptimizationRecommendation[] {
    const all = Array.from(this.recommendations.values());
    return status ? all.filter(r => r.status === status) : all;
  }

  /**
   * Update recommendation status
   */
  updateRecommendationStatus(id: string, status: OptimizationRecommendation['status']): void {
    const rec = this.recommendations.get(id);
    if (rec) {
      rec.status = status;
    }
  }

  /**
   * Calculate potential savings
   */
  calculatePotentialSavings(): number {
    return this.getRecommendations('pending').reduce(
      (sum, rec) => sum + rec.estimatedSavings,
      0
    );
  }

  /**
   * Track resource usage
   */
  trackResourceUsage(
    resource: string,
    current: number,
    limit: number,
    cost: number
  ): void {
    const utilization = (current / limit) * 100;

    // Determine trend (simplified)
    const existing = this.resourceUsage.get(resource);
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    if (existing) {
      if (current > existing.current * 1.1) trend = 'increasing';
      else if (current < existing.current * 0.9) trend = 'decreasing';
    }

    this.resourceUsage.set(resource, {
      resource,
      current,
      limit,
      utilizationPercentage: utilization,
      cost,
      trend,
    });
  }

  /**
   * Get resource usage
   */
  getResourceUsage(): ResourceUsage[] {
    return Array.from(this.resourceUsage.values());
  }

  /**
   * Get cost forecast
   */
  getCostForecast(days: number = 30): number {
    const currentPeriod = this.costs[this.costs.length - 1];
    if (!currentPeriod) return 0;

    const daysElapsed = Math.floor(
      (Date.now() - currentPeriod.period.start.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysElapsed === 0) return currentPeriod.totalCost;

    const dailyRate = currentPeriod.totalCost / daysElapsed;
    return dailyRate * days;
  }

  /**
   * Get cost efficiency score (0-100)
   */
  getCostEfficiencyScore(): number {
    const current = this.getCurrentCost();
    const potential = this.calculatePotentialSavings();

    if (current === 0) return 100;

    const efficiency = ((current - potential) / current) * 100;
    return Math.max(0, Math.min(100, efficiency));
  }

  /**
   * Generate cost report
   */
  generateCostReport(): any {
    const current = this.getCurrentCost();
    const forecast = this.getCostForecast(30);
    const savings = this.calculatePotentialSavings();
    const efficiency = this.getCostEfficiencyScore();

    return {
      current,
      forecast,
      potentialSavings: savings,
      efficiencyScore: efficiency,
      breakdown: this.costs[this.costs.length - 1]?.breakdown || {},
      recommendations: this.getRecommendations('pending'),
      alerts: Array.from(this.alerts.values()).filter(a => a.triggered),
      resourceUsage: this.getResourceUsage(),
    };
  }
}

// Singleton instance
let costEngineInstance: CostOptimizationEngine | null = null;

export function getCostOptimizationEngine(): CostOptimizationEngine {
  if (!costEngineInstance) {
    costEngineInstance = new CostOptimizationEngine();
  }
  return costEngineInstance;
}

export type { CostMetrics, CostAlert, OptimizationRecommendation, ResourceUsage };
