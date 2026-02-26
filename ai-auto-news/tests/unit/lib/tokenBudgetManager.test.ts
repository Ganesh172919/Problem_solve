import { describe, it, expect, beforeEach } from '@jest/globals';
import { TokenBudgetManager } from '@/lib/tokenBudgetManager';

describe('TokenBudgetManager', () => {
  let manager: TokenBudgetManager;

  beforeEach(() => {
    manager = new TokenBudgetManager();
  });

  describe('createBudget', () => {
    it('should create a budget with default settings', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test Budget',
        totalTokens: 100000,
      });
      expect(budget.id).toContain('budget_');
      expect(budget.tenantId).toBe('tenant1');
      expect(budget.totalTokens).toBe(100000);
      expect(budget.usedTokens).toBe(0);
      expect(budget.hardLimit).toBe(true);
    });

    it('should create a budget with custom settings', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Custom Budget',
        totalTokens: 50000,
        periodDays: 7,
        alertThresholds: [0.8, 0.95],
        hardLimit: false,
      });
      expect(budget.alertThresholds).toEqual([0.8, 0.95]);
      expect(budget.hardLimit).toBe(false);
    });
  });

  describe('recordUsage', () => {
    it('should record token usage', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100000,
      });

      const record = manager.recordUsage({
        budgetId: budget.id,
        model: 'gpt-3.5-turbo',
        promptTokens: 100,
        completionTokens: 200,
        operationType: 'generation',
      });

      expect(record).not.toBeNull();
      expect(record!.totalTokens).toBe(300);
      expect(record!.estimatedCost).toBeGreaterThan(0);
    });

    it('should enforce hard limits', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Small',
        totalTokens: 100,
        hardLimit: true,
      });

      const record = manager.recordUsage({
        budgetId: budget.id,
        model: 'gpt-4',
        promptTokens: 80,
        completionTokens: 80,
        operationType: 'generation',
      });

      expect(record).toBeNull();
    });

    it('should return null for non-existent budget', () => {
      const record = manager.recordUsage({
        budgetId: 'nonexistent',
        model: 'gpt-4',
        promptTokens: 10,
        completionTokens: 10,
        operationType: 'test',
      });
      expect(record).toBeNull();
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for known models', () => {
      const cost = manager.calculateCost('gpt-4', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it('should use default pricing for unknown models', () => {
      const cost = manager.calculateCost('unknown-model', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('forecast', () => {
    it('should generate a forecast', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100000,
      });

      manager.recordUsage({
        budgetId: budget.id,
        model: 'gpt-3.5-turbo',
        promptTokens: 1000,
        completionTokens: 500,
        operationType: 'generation',
      });

      const forecast = manager.forecast(budget.id);
      expect(forecast).not.toBeNull();
      expect(forecast!.daysRemaining).toBeGreaterThanOrEqual(0);
      expect(forecast!.burnRate).toBeGreaterThanOrEqual(0);
    });

    it('should return null for non-existent budget', () => {
      expect(manager.forecast('nonexistent')).toBeNull();
    });
  });

  describe('reserveTokens', () => {
    it('should create a reservation', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100000,
      });

      const reservationId = manager.reserveTokens(budget.id, 5000);
      expect(reservationId).not.toBeNull();
    });

    it('should fail when exceeding available tokens', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100,
      });

      const reservationId = manager.reserveTokens(budget.id, 200);
      expect(reservationId).toBeNull();
    });

    it('should release reservation', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100000,
      });

      const reservationId = manager.reserveTokens(budget.id, 5000);
      expect(manager.releaseReservation(reservationId!)).toBe(true);
    });
  });

  describe('optimizeModelSelection', () => {
    it('should return a model name', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100000,
      });

      const model = manager.optimizeModelSelection('code_gen', ['complex_reasoning'], budget.id);
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    });

    it('should select cheaper model when budget is tight', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Tight',
        totalTokens: 1000,
      });

      // Use 95% of budget
      manager.recordUsage({
        budgetId: budget.id,
        model: 'gpt-3.5-turbo',
        promptTokens: 900,
        completionTokens: 50,
        operationType: 'test',
      });

      const model = manager.optimizeModelSelection('test', [], budget.id);
      expect(model).toBe('gpt-3.5-turbo');
    });
  });

  describe('generateCostReport', () => {
    it('should generate a cost report', () => {
      const budget = manager.createBudget({
        tenantId: 'tenant1',
        name: 'Test',
        totalTokens: 100000,
      });

      manager.recordUsage({
        budgetId: budget.id,
        model: 'gpt-4',
        promptTokens: 500,
        completionTokens: 200,
        operationType: 'generation',
      });

      const report = manager.generateCostReport(budget.id);
      expect(report).not.toBeNull();
      expect(report!.totalTokens).toBe(700);
      expect(report!.totalCost).toBeGreaterThan(0);
      expect(report!.byModel['gpt-4']).toBeDefined();
    });
  });
});
