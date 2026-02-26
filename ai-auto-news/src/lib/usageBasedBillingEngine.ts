/**
 * Usage-Based Billing Engine
 *
 * Metered billing with real-time usage tracking, overage calculation,
 * invoice generation, and cost allocation across multi-tenant accounts.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface UsageMeter {
  id: string;
  name: string;
  unit: string;
  aggregation: 'sum' | 'max' | 'avg' | 'count' | 'unique';
  resetPeriod: 'hourly' | 'daily' | 'monthly' | 'never';
  pricingTiers: PricingTier[];
  metadata: Record<string, unknown>;
}

export interface PricingTier {
  id: string;
  name: string;
  from: number;
  to: number | null;
  pricePerUnit: number;
  flatFee: number;
  currency: string;
}

export interface UsageRecord {
  id: string;
  meterId: string;
  tenantId: string;
  quantity: number;
  timestamp: number;
  properties: Record<string, unknown>;
  idempotencyKey: string;
}

export interface UsageAggregate {
  meterId: string;
  tenantId: string;
  periodStart: number;
  periodEnd: number;
  totalQuantity: number;
  recordCount: number;
  peakQuantity: number;
  avgQuantity: number;
  uniqueValues: number;
}

export interface BillingLineItem {
  id: string;
  meterId: string;
  meterName: string;
  quantity: number;
  unitPrice: number;
  flatFee: number;
  tierName: string;
  subtotal: number;
  currency: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  periodStart: number;
  periodEnd: number;
  lineItems: BillingLineItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  currency: string;
  status: 'draft' | 'pending' | 'paid' | 'overdue' | 'cancelled';
  dueDate: number;
  createdAt: number;
  paidAt: number | null;
}

export interface CostAllocation {
  tenantId: string;
  department?: string;
  project?: string;
  costCenter?: string;
  allocations: { meterId: string; amount: number; percentage: number }[];
  totalCost: number;
  period: string;
}

export interface UsageAlert {
  id: string;
  tenantId: string;
  meterId: string;
  threshold: number;
  currentUsage: number;
  alertType: 'warning' | 'critical' | 'limit_reached';
  message: string;
  triggered: boolean;
  triggeredAt: number | null;
}

export interface BillingPlan {
  id: string;
  name: string;
  basePrice: number;
  meters: string[];
  includedUsage: Record<string, number>;
  overageRates: Record<string, number>;
  features: string[];
  currency: string;
}

export class UsageBasedBillingEngine {
  private meters: Map<string, UsageMeter> = new Map();
  private records: Map<string, UsageRecord[]> = new Map();
  private aggregates: Map<string, UsageAggregate> = new Map();
  private invoices: Map<string, Invoice[]> = new Map();
  private alerts: Map<string, UsageAlert[]> = new Map();
  private plans: Map<string, BillingPlan> = new Map();
  private processedIdempotencyKeys: Set<string> = new Set();

  registerMeter(meter: UsageMeter): void {
    this.meters.set(meter.id, meter);
    logger.info('Usage meter registered', { meterId: meter.id, name: meter.name });
  }

  registerPlan(plan: BillingPlan): void {
    this.plans.set(plan.id, plan);
  }

  recordUsage(record: UsageRecord): boolean {
    if (this.processedIdempotencyKeys.has(record.idempotencyKey)) {
      logger.debug('Duplicate usage record skipped', { key: record.idempotencyKey });
      return false;
    }

    const meter = this.meters.get(record.meterId);
    if (!meter) {
      logger.warn('Meter not found', { meterId: record.meterId });
      return false;
    }

    const key = `${record.tenantId}:${record.meterId}`;
    const existing = this.records.get(key) || [];
    existing.push(record);
    this.records.set(key, existing);

    this.processedIdempotencyKeys.add(record.idempotencyKey);
    this.updateAggregate(record, meter);
    this.checkAlerts(record.tenantId, record.meterId);

    if (this.processedIdempotencyKeys.size > 100000) {
      const entries = Array.from(this.processedIdempotencyKeys);
      this.processedIdempotencyKeys = new Set(entries.slice(-50000));
    }

    return true;
  }

  getUsage(tenantId: string, meterId: string, periodStart?: number, periodEnd?: number): UsageAggregate {
    const key = this.getAggregateKey(tenantId, meterId);
    const aggregate = this.aggregates.get(key);

    if (!aggregate) {
      return {
        meterId,
        tenantId,
        periodStart: periodStart || 0,
        periodEnd: periodEnd || Date.now(),
        totalQuantity: 0,
        recordCount: 0,
        peakQuantity: 0,
        avgQuantity: 0,
        uniqueValues: 0,
      };
    }

    if (periodStart || periodEnd) {
      return this.computeAggregate(tenantId, meterId, periodStart || 0, periodEnd || Date.now());
    }

    return aggregate;
  }

  calculateCost(tenantId: string, meterId: string, quantity?: number): number {
    const meter = this.meters.get(meterId);
    if (!meter || meter.pricingTiers.length === 0) return 0;

    const usedQuantity = quantity ?? this.getUsage(tenantId, meterId).totalQuantity;
    let totalCost = 0;
    let remaining = usedQuantity;

    const sortedTiers = [...meter.pricingTiers].sort((a, b) => a.from - b.from);

    for (const tier of sortedTiers) {
      if (remaining <= 0) break;

      const tierCapacity = tier.to !== null ? tier.to - tier.from : remaining;
      const tierUsage = Math.min(remaining, tierCapacity);

      totalCost += tier.flatFee + tierUsage * tier.pricePerUnit;
      remaining -= tierUsage;
    }

    return parseFloat(totalCost.toFixed(4));
  }

  generateInvoice(tenantId: string, periodStart: number, periodEnd: number, taxRate: number = 0): Invoice {
    const lineItems: BillingLineItem[] = [];

    for (const [meterId, meter] of this.meters) {
      const usage = this.computeAggregate(tenantId, meterId, periodStart, periodEnd);
      if (usage.totalQuantity === 0) continue;

      let remaining = usage.totalQuantity;
      const sortedTiers = [...meter.pricingTiers].sort((a, b) => a.from - b.from);

      for (const tier of sortedTiers) {
        if (remaining <= 0) break;

        const tierCapacity = tier.to !== null ? tier.to - tier.from : remaining;
        const tierUsage = Math.min(remaining, tierCapacity);
        const subtotal = tier.flatFee + tierUsage * tier.pricePerUnit;

        lineItems.push({
          id: `li_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          meterId,
          meterName: meter.name,
          quantity: tierUsage,
          unitPrice: tier.pricePerUnit,
          flatFee: tier.flatFee,
          tierName: tier.name,
          subtotal: parseFloat(subtotal.toFixed(4)),
          currency: tier.currency,
        });

        remaining -= tierUsage;
      }
    }

    const subtotal = parseFloat(lineItems.reduce((sum, li) => sum + li.subtotal, 0).toFixed(2));
    const tax = parseFloat((subtotal * taxRate).toFixed(2));
    const total = parseFloat((subtotal + tax).toFixed(2));

    const invoice: Invoice = {
      id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      tenantId,
      periodStart,
      periodEnd,
      lineItems,
      subtotal,
      tax,
      taxRate,
      total,
      currency: 'USD',
      status: 'draft',
      dueDate: periodEnd + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
      paidAt: null,
    };

    const existing = this.invoices.get(tenantId) || [];
    existing.push(invoice);
    this.invoices.set(tenantId, existing);

    logger.info('Invoice generated', { invoiceId: invoice.id, tenantId, total });
    return invoice;
  }

  markInvoicePaid(invoiceId: string, tenantId: string): boolean {
    const invoices = this.invoices.get(tenantId);
    if (!invoices) return false;

    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) return false;

    invoice.status = 'paid';
    invoice.paidAt = Date.now();
    return true;
  }

  setupAlert(params: {
    tenantId: string;
    meterId: string;
    threshold: number;
    alertType: 'warning' | 'critical' | 'limit_reached';
    message: string;
  }): UsageAlert {
    const alert: UsageAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      tenantId: params.tenantId,
      meterId: params.meterId,
      threshold: params.threshold,
      currentUsage: 0,
      alertType: params.alertType,
      message: params.message,
      triggered: false,
      triggeredAt: null,
    };

    const existing = this.alerts.get(params.tenantId) || [];
    existing.push(alert);
    this.alerts.set(params.tenantId, existing);

    return alert;
  }

  allocateCosts(
    tenantId: string,
    period: string,
    department?: string,
    project?: string,
  ): CostAllocation {
    const allocations: { meterId: string; amount: number; percentage: number }[] = [];
    let totalCost = 0;

    for (const meterId of this.meters.keys()) {
      const cost = this.calculateCost(tenantId, meterId);
      if (cost > 0) {
        allocations.push({ meterId, amount: cost, percentage: 0 });
        totalCost += cost;
      }
    }

    for (const alloc of allocations) {
      alloc.percentage = totalCost > 0 ? parseFloat((alloc.amount / totalCost * 100).toFixed(2)) : 0;
    }

    return {
      tenantId,
      department,
      project,
      costCenter: department || project || 'default',
      allocations,
      totalCost: parseFloat(totalCost.toFixed(2)),
      period,
    };
  }

  getInvoices(tenantId: string, status?: string): Invoice[] {
    const invoices = this.invoices.get(tenantId) || [];
    return status ? invoices.filter((i) => i.status === status) : invoices;
  }

  getMeters(): UsageMeter[] {
    return Array.from(this.meters.values());
  }

  getAlerts(tenantId: string): UsageAlert[] {
    return this.alerts.get(tenantId) || [];
  }

  getRevenueByMeter(): Record<string, number> {
    const revenue: Record<string, number> = {};

    for (const invoicesList of this.invoices.values()) {
      for (const invoice of invoicesList) {
        if (invoice.status !== 'paid') continue;
        for (const li of invoice.lineItems) {
          revenue[li.meterId] = (revenue[li.meterId] || 0) + li.subtotal;
        }
      }
    }

    return revenue;
  }

  getBillingDashboard(tenantId: string): {
    currentPeriodUsage: Record<string, number>;
    currentPeriodCost: number;
    invoiceHistory: { month: string; total: number; status: string }[];
    alerts: UsageAlert[];
    projectedMonthlyCost: number;
  } {
    const usage: Record<string, number> = {};
    let currentCost = 0;

    for (const meterId of this.meters.keys()) {
      const aggregate = this.getUsage(tenantId, meterId);
      usage[meterId] = aggregate.totalQuantity;
      currentCost += this.calculateCost(tenantId, meterId);
    }

    const invoiceHistory = (this.invoices.get(tenantId) || []).map((inv) => ({
      month: new Date(inv.periodStart).toISOString().substring(0, 7),
      total: inv.total,
      status: inv.status,
    }));

    const now = Date.now();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const elapsed = now - monthStart;
    const monthDuration = 30 * 24 * 60 * 60 * 1000;
    const projectedCost = elapsed > 0 ? (currentCost / elapsed) * monthDuration : 0;

    return {
      currentPeriodUsage: usage,
      currentPeriodCost: parseFloat(currentCost.toFixed(2)),
      invoiceHistory,
      alerts: this.alerts.get(tenantId) || [],
      projectedMonthlyCost: parseFloat(projectedCost.toFixed(2)),
    };
  }

  private updateAggregate(record: UsageRecord, meter: UsageMeter): void {
    const key = this.getAggregateKey(record.tenantId, record.meterId);
    const existing = this.aggregates.get(key) || {
      meterId: record.meterId,
      tenantId: record.tenantId,
      periodStart: record.timestamp,
      periodEnd: record.timestamp,
      totalQuantity: 0,
      recordCount: 0,
      peakQuantity: 0,
      avgQuantity: 0,
      uniqueValues: 0,
    };

    switch (meter.aggregation) {
      case 'sum':
        existing.totalQuantity += record.quantity;
        break;
      case 'max':
        existing.totalQuantity = Math.max(existing.totalQuantity, record.quantity);
        break;
      case 'count':
        existing.totalQuantity += 1;
        break;
      default:
        existing.totalQuantity += record.quantity;
    }

    existing.recordCount++;
    existing.peakQuantity = Math.max(existing.peakQuantity, record.quantity);
    existing.avgQuantity = existing.totalQuantity / existing.recordCount;
    existing.periodEnd = Math.max(existing.periodEnd, record.timestamp);

    this.aggregates.set(key, existing);
  }

  private computeAggregate(
    tenantId: string,
    meterId: string,
    periodStart: number,
    periodEnd: number,
  ): UsageAggregate {
    const key = `${tenantId}:${meterId}`;
    const records = (this.records.get(key) || []).filter(
      (r) => r.timestamp >= periodStart && r.timestamp <= periodEnd,
    );

    if (records.length === 0) {
      return {
        meterId,
        tenantId,
        periodStart,
        periodEnd,
        totalQuantity: 0,
        recordCount: 0,
        peakQuantity: 0,
        avgQuantity: 0,
        uniqueValues: 0,
      };
    }

    const totalQuantity = records.reduce((sum, r) => sum + r.quantity, 0);
    const peakQuantity = Math.max(...records.map((r) => r.quantity));
    const uniqueValues = new Set(records.map((r) => r.quantity)).size;

    return {
      meterId,
      tenantId,
      periodStart,
      periodEnd,
      totalQuantity,
      recordCount: records.length,
      peakQuantity,
      avgQuantity: totalQuantity / records.length,
      uniqueValues,
    };
  }

  private checkAlerts(tenantId: string, meterId: string): void {
    const alerts = this.alerts.get(tenantId);
    if (!alerts) return;

    const usage = this.getUsage(tenantId, meterId);

    for (const alert of alerts) {
      if (alert.meterId !== meterId || alert.triggered) continue;

      alert.currentUsage = usage.totalQuantity;
      if (usage.totalQuantity >= alert.threshold) {
        alert.triggered = true;
        alert.triggeredAt = Date.now();
        logger.info('Usage alert triggered', {
          alertId: alert.id,
          tenantId,
          meterId,
          usage: usage.totalQuantity,
          threshold: alert.threshold,
        });
      }
    }
  }

  private getAggregateKey(tenantId: string, meterId: string): string {
    return `${tenantId}:${meterId}`;
  }
}

let billingEngineInstance: UsageBasedBillingEngine | null = null;

export function getUsageBasedBillingEngine(): UsageBasedBillingEngine {
  if (!billingEngineInstance) {
    billingEngineInstance = new UsageBasedBillingEngine();
  }
  return billingEngineInstance;
}
