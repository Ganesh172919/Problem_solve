interface ABTest {
  id: string;
  name: string;
  description: string;
  variants: ABVariant[];
  status: 'draft' | 'running' | 'paused' | 'completed';
  startDate: Date;
  endDate?: Date;
  targetSampleSize?: number;
  currentSampleSize: number;
  winningVariant?: string;
  confidenceLevel: number;
  createdAt: Date;
}

interface ABVariant {
  id: string;
  name: string;
  weight: number; // Percentage of traffic (0-100)
  config: Record<string, any>;
  metrics: ABMetrics;
}

interface ABMetrics {
  impressions: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  avgTimeOnPage: number;
  bounceRate: number;
}

interface ABAssignment {
  userId: string;
  testId: string;
  variantId: string;
  assignedAt: Date;
}

interface ABEvent {
  userId: string;
  testId: string;
  variantId: string;
  eventType: 'impression' | 'conversion' | 'revenue';
  value?: number;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export class ABTestingFramework {
  private tests: Map<string, ABTest> = new Map();
  private assignments: Map<string, ABAssignment[]> = new Map();
  private events: ABEvent[] = [];

  /**
   * Create A/B test
   */
  createTest(test: Omit<ABTest, 'id' | 'currentSampleSize' | 'createdAt' | 'status'>): ABTest {
    const id = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate variant weights sum to 100
    const totalWeight = test.variants.reduce((sum, v) => sum + v.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      throw new Error('Variant weights must sum to 100');
    }

    const newTest: ABTest = {
      id,
      status: 'draft',
      currentSampleSize: 0,
      confidenceLevel: 0,
      createdAt: new Date(),
      ...test,
      variants: test.variants.map(v => ({
        ...v,
        metrics: {
          impressions: 0,
          conversions: 0,
          conversionRate: 0,
          revenue: 0,
          avgTimeOnPage: 0,
          bounceRate: 0,
        },
      })),
    };

    this.tests.set(id, newTest);
    return newTest;
  }

  /**
   * Start A/B test
   */
  startTest(testId: string): void {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error('Test not found');
    }

    test.status = 'running';
    test.startDate = new Date();
  }

  /**
   * Pause A/B test
   */
  pauseTest(testId: string): void {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error('Test not found');
    }

    test.status = 'paused';
  }

  /**
   * Complete A/B test
   */
  completeTest(testId: string): void {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error('Test not found');
    }

    test.status = 'completed';
    test.endDate = new Date();

    // Determine winning variant
    test.winningVariant = this.determineWinner(testId);
  }

  /**
   * Assign user to variant
   */
  assignVariant(userId: string, testId: string): ABVariant {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error('Test not found');
    }

    if (test.status !== 'running') {
      throw new Error('Test is not running');
    }

    // Check if user already assigned
    const userAssignments = this.assignments.get(userId) || [];
    const existing = userAssignments.find(a => a.testId === testId);
    if (existing) {
      const variant = test.variants.find(v => v.id === existing.variantId);
      if (variant) return variant;
    }

    // Assign based on weights
    const variant = this.selectVariantByWeight(test.variants);

    const assignment: ABAssignment = {
      userId,
      testId,
      variantId: variant.id,
      assignedAt: new Date(),
    };

    if (!this.assignments.has(userId)) {
      this.assignments.set(userId, []);
    }
    this.assignments.get(userId)!.push(assignment);

    test.currentSampleSize++;

    return variant;
  }

  /**
   * Select variant based on weight distribution
   */
  private selectVariantByWeight(variants: ABVariant[]): ABVariant {
    const rand = Math.random() * 100;
    let cumulative = 0;

    for (const variant of variants) {
      cumulative += variant.weight;
      if (rand <= cumulative) {
        return variant;
      }
    }

    return variants[0];
  }

  /**
   * Track event
   */
  trackEvent(event: Omit<ABEvent, 'timestamp'>): void {
    const test = this.tests.get(event.testId);
    if (!test) return;

    const variant = test.variants.find(v => v.id === event.variantId);
    if (!variant) return;

    const fullEvent: ABEvent = {
      ...event,
      timestamp: new Date(),
    };

    this.events.push(fullEvent);

    // Update metrics
    switch (event.eventType) {
      case 'impression':
        variant.metrics.impressions++;
        break;
      case 'conversion':
        variant.metrics.conversions++;
        variant.metrics.conversionRate =
          (variant.metrics.conversions / variant.metrics.impressions) * 100;
        break;
      case 'revenue':
        variant.metrics.revenue += event.value || 0;
        break;
    }

    // Recalculate confidence
    this.calculateConfidence(test);
  }

  /**
   * Calculate statistical confidence
   */
  private calculateConfidence(test: ABTest): void {
    if (test.variants.length < 2) return;

    // Simple two-proportion z-test
    const control = test.variants[0];
    const treatment = test.variants[1];

    const n1 = control.metrics.impressions;
    const n2 = treatment.metrics.impressions;
    const p1 = control.metrics.conversions / n1;
    const p2 = treatment.metrics.conversions / n2;

    if (n1 === 0 || n2 === 0) {
      test.confidenceLevel = 0;
      return;
    }

    const pooled = (control.metrics.conversions + treatment.metrics.conversions) / (n1 + n2);
    const se = Math.sqrt(pooled * (1 - pooled) * (1/n1 + 1/n2));
    const z = Math.abs(p2 - p1) / se;

    // Convert z-score to confidence level (approximate)
    const confidence = this.zScoreToConfidence(z);
    test.confidenceLevel = confidence;
  }

  /**
   * Convert z-score to confidence level
   */
  private zScoreToConfidence(z: number): number {
    if (z < 1.645) return 90;
    if (z < 1.96) return 95;
    if (z < 2.576) return 99;
    return 99.9;
  }

  /**
   * Determine winning variant
   */
  private determineWinner(testId: string): string {
    const test = this.tests.get(testId);
    if (!test) return '';

    // Sort by conversion rate
    const sorted = [...test.variants].sort(
      (a, b) => b.metrics.conversionRate - a.metrics.conversionRate
    );

    return sorted[0].id;
  }

  /**
   * Get test results
   */
  getTestResults(testId: string): {
    test: ABTest;
    winner?: ABVariant;
    significance: boolean;
  } | null {
    const test = this.tests.get(testId);
    if (!test) return null;

    const winner = test.winningVariant
      ? test.variants.find(v => v.id === test.winningVariant)
      : undefined;

    return {
      test,
      winner,
      significance: test.confidenceLevel >= 95,
    };
  }

  /**
   * Get user's variant
   */
  getUserVariant(userId: string, testId: string): ABVariant | null {
    const userAssignments = this.assignments.get(userId) || [];
    const assignment = userAssignments.find(a => a.testId === testId);

    if (!assignment) return null;

    const test = this.tests.get(testId);
    if (!test) return null;

    return test.variants.find(v => v.id === assignment.variantId) || null;
  }

  /**
   * Get all running tests
   */
  getRunningTests(): ABTest[] {
    return Array.from(this.tests.values()).filter(t => t.status === 'running');
  }

  /**
   * Get test summary
   */
  getTestSummary(testId: string): any {
    const test = this.tests.get(testId);
    if (!test) return null;

    return {
      id: test.id,
      name: test.name,
      status: test.status,
      sampleSize: test.currentSampleSize,
      confidenceLevel: test.confidenceLevel,
      duration: test.endDate
        ? test.endDate.getTime() - test.startDate.getTime()
        : Date.now() - test.startDate.getTime(),
      variants: test.variants.map(v => ({
        name: v.name,
        weight: v.weight,
        impressions: v.metrics.impressions,
        conversions: v.metrics.conversions,
        conversionRate: v.metrics.conversionRate.toFixed(2) + '%',
        revenue: v.metrics.revenue,
      })),
      winner: test.winningVariant,
    };
  }

  /**
   * Export test data
   */
  exportTestData(testId: string): any[] {
    return this.events
      .filter(e => e.testId === testId)
      .map(e => ({
        userId: e.userId,
        variant: e.variantId,
        eventType: e.eventType,
        value: e.value,
        timestamp: e.timestamp,
        metadata: e.metadata,
      }));
  }

  /**
   * Calculate sample size needed
   */
  calculateSampleSize(
    baselineRate: number,
    minDetectableEffect: number,
    power: number = 0.8,
    alpha: number = 0.05
  ): number {
    // Simplified sample size calculation
    const z_alpha = 1.96; // for 95% confidence
    const z_beta = 0.84;  // for 80% power

    const p1 = baselineRate;
    const p2 = baselineRate * (1 + minDetectableEffect);

    const numerator = Math.pow(z_alpha + z_beta, 2) * (p1 * (1 - p1) + p2 * (1 - p2));
    const denominator = Math.pow(p2 - p1, 2);

    return Math.ceil(numerator / denominator);
  }
}

// Singleton instance
let abTestingInstance: ABTestingFramework | null = null;

export function getABTestingFramework(): ABTestingFramework {
  if (!abTestingInstance) {
    abTestingInstance = new ABTestingFramework();
  }
  return abTestingInstance;
}

export type { ABTest, ABVariant, ABMetrics, ABEvent };
