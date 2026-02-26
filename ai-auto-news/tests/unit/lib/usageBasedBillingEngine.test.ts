import { describe, it, expect, beforeEach } from '@jest/globals';
import { UsageBasedBillingEngine } from '@/lib/usageBasedBillingEngine';

describe('UsageBasedBillingEngine', () => {
  let engine: UsageBasedBillingEngine;

  beforeEach(() => {
    engine = new UsageBasedBillingEngine();
  });

  describe('registerMeter', () => {
    it('should register a usage meter', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API Calls',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [
          { id: 't1', name: 'Free tier', from: 0, to: 1000, pricePerUnit: 0, flatFee: 0, currency: 'USD' },
          { id: 't2', name: 'Standard', from: 1000, to: null, pricePerUnit: 0.001, flatFee: 0, currency: 'USD' },
        ],
        metadata: {},
      });

      expect(engine.getMeters()).toHaveLength(1);
    });
  });

  describe('recordUsage', () => {
    it('should record usage events', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API Calls',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [],
        metadata: {},
      });

      const success = engine.recordUsage({
        id: 'u1',
        meterId: 'api_calls',
        tenantId: 'tenant1',
        quantity: 50,
        timestamp: Date.now(),
        properties: {},
        idempotencyKey: 'key1',
      });

      expect(success).toBe(true);
    });

    it('should reject duplicate idempotency keys', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API Calls',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [],
        metadata: {},
      });

      engine.recordUsage({
        id: 'u1',
        meterId: 'api_calls',
        tenantId: 'tenant1',
        quantity: 50,
        timestamp: Date.now(),
        properties: {},
        idempotencyKey: 'key1',
      });

      const success = engine.recordUsage({
        id: 'u2',
        meterId: 'api_calls',
        tenantId: 'tenant1',
        quantity: 50,
        timestamp: Date.now(),
        properties: {},
        idempotencyKey: 'key1',
      });

      expect(success).toBe(false);
    });

    it('should reject unknown meters', () => {
      const success = engine.recordUsage({
        id: 'u1',
        meterId: 'unknown',
        tenantId: 'tenant1',
        quantity: 50,
        timestamp: Date.now(),
        properties: {},
        idempotencyKey: 'key1',
      });

      expect(success).toBe(false);
    });
  });

  describe('calculateCost', () => {
    it('should calculate tiered pricing correctly', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API Calls',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [
          { id: 't1', name: 'Free', from: 0, to: 1000, pricePerUnit: 0, flatFee: 0, currency: 'USD' },
          { id: 't2', name: 'Paid', from: 1000, to: null, pricePerUnit: 0.01, flatFee: 5, currency: 'USD' },
        ],
        metadata: {},
      });

      // 500 calls should be free
      const freeCost = engine.calculateCost('tenant1', 'api_calls', 500);
      expect(freeCost).toBe(0);

      // 1500 calls: 1000 free + 500 @ $0.01 + $5 flat
      const paidCost = engine.calculateCost('tenant1', 'api_calls', 1500);
      expect(paidCost).toBe(10);
    });

    it('should return 0 for no meter', () => {
      expect(engine.calculateCost('tenant1', 'unknown')).toBe(0);
    });
  });

  describe('generateInvoice', () => {
    it('should generate an invoice with line items', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API Calls',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [
          { id: 't1', name: 'Standard', from: 0, to: null, pricePerUnit: 0.001, flatFee: 0, currency: 'USD' },
        ],
        metadata: {},
      });

      const now = Date.now();
      engine.recordUsage({
        id: 'u1',
        meterId: 'api_calls',
        tenantId: 'tenant1',
        quantity: 5000,
        timestamp: now,
        properties: {},
        idempotencyKey: 'inv_key1',
      });

      const invoice = engine.generateInvoice('tenant1', now - 1000, now + 1000, 0.1);
      expect(invoice.id).toContain('inv_');
      expect(invoice.lineItems.length).toBeGreaterThan(0);
      expect(invoice.subtotal).toBeGreaterThan(0);
      expect(invoice.tax).toBeGreaterThan(0);
      expect(invoice.total).toBeGreaterThan(invoice.subtotal);
      expect(invoice.status).toBe('draft');
    });
  });

  describe('markInvoicePaid', () => {
    it('should mark invoice as paid', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [
          { id: 't1', name: 'Free', from: 0, to: null, pricePerUnit: 0, flatFee: 10, currency: 'USD' },
        ],
        metadata: {},
      });

      const now = Date.now();
      engine.recordUsage({
        id: 'u1', meterId: 'api_calls', tenantId: 'tenant1',
        quantity: 1, timestamp: now, properties: {}, idempotencyKey: 'pay_key',
      });

      const invoice = engine.generateInvoice('tenant1', now - 1000, now + 1000);
      const success = engine.markInvoicePaid(invoice.id, 'tenant1');
      expect(success).toBe(true);

      const invoices = engine.getInvoices('tenant1', 'paid');
      expect(invoices.length).toBe(1);
      expect(invoices[0].paidAt).not.toBeNull();
    });
  });

  describe('alerts', () => {
    it('should trigger alerts when threshold is reached', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [],
        metadata: {},
      });

      engine.setupAlert({
        tenantId: 'tenant1',
        meterId: 'api_calls',
        threshold: 100,
        alertType: 'warning',
        message: 'Approaching limit',
      });

      engine.recordUsage({
        id: 'u1', meterId: 'api_calls', tenantId: 'tenant1',
        quantity: 150, timestamp: Date.now(), properties: {}, idempotencyKey: 'alert_key',
      });

      const alerts = engine.getAlerts('tenant1');
      expect(alerts.length).toBe(1);
      expect(alerts[0].triggered).toBe(true);
    });
  });

  describe('billing dashboard', () => {
    it('should return dashboard data', () => {
      engine.registerMeter({
        id: 'api_calls',
        name: 'API Calls',
        unit: 'calls',
        aggregation: 'sum',
        resetPeriod: 'monthly',
        pricingTiers: [
          { id: 't1', name: 'Free', from: 0, to: null, pricePerUnit: 0.001, flatFee: 0, currency: 'USD' },
        ],
        metadata: {},
      });

      const dashboard = engine.getBillingDashboard('tenant1');
      expect(dashboard).toHaveProperty('currentPeriodUsage');
      expect(dashboard).toHaveProperty('currentPeriodCost');
      expect(dashboard).toHaveProperty('invoiceHistory');
      expect(dashboard).toHaveProperty('alerts');
      expect(dashboard).toHaveProperty('projectedMonthlyCost');
    });
  });
});
