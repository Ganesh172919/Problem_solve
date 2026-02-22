import { getLogger } from './logger';
import { getCache } from './cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PricingModel = 'usage_based' | 'seat_license' | 'flat_rate' | 'enterprise_contract' | 'hybrid';

export type BillingCycle = 'monthly' | 'quarterly' | 'annual';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'past_due' | 'void' | 'uncollectible';

export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'disputed';

export type DunningStage = 'grace' | 'reminder_1' | 'reminder_2' | 'escalated' | 'suspended' | 'collections';

export interface TenantBillingProfile {
  tenantId: string;
  name: string;
  email: string;
  pricingModel: PricingModel;
  billingCycle: BillingCycle;
  currency: string;
  planId: string;
  seatCount?: number;
  seatPriceUsd?: number;
  usageMeters?: UsageMeter[];
  contractId?: string;
  taxId?: string;
  taxRate: number;
  annualDiscountPercent: number;
  volumeDiscountTiers?: VolumeDiscountTier[];
  creditBalance: number;
  suspendedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageMeter {
  meterId: string;
  name: string;
  unit: string;
  pricePerUnit: number;
  includedUnits: number;
  aggregationMode: 'sum' | 'max' | 'latest';
}

export interface UsageRecord {
  tenantId: string;
  meterId: string;
  quantity: number;
  recordedAt: string;
  idempotencyKey?: string;
}

export interface VolumeDiscountTier {
  minUnits: number;
  maxUnits?: number;
  discountPercent: number;
}

export interface EnterpriseContract {
  contractId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  annualValueUsd: number;
  committedSeats?: number;
  customTerms: string;
  includedFeatures: string[];
  overageRateMultiplier: number;
  autoRenew: boolean;
  signedAt: string;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceUsd: number;
  discountPercent: number;
  subtotalUsd: number;
  meterId?: string;
  period?: { start: string; end: string };
}

export interface Invoice {
  invoiceId: string;
  tenantId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  lineItems: InvoiceLineItem[];
  subtotalUsd: number;
  discountUsd: number;
  taxUsd: number;
  totalUsd: number;
  creditAppliedUsd: number;
  amountDueUsd: number;
  currency: string;
  dueDate: string;
  paidAt?: string;
  voidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  paymentId: string;
  invoiceId: string;
  tenantId: string;
  amountUsd: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string;
  processedAt?: string;
  failureReason?: string;
  retryCount: number;
  nextRetryAt?: string;
  createdAt: string;
}

export interface CreditAdjustment {
  adjustmentId: string;
  tenantId: string;
  amountUsd: number;
  type: 'credit' | 'debit';
  reason: string;
  appliedToInvoiceId?: string;
  createdAt: string;
  createdBy: string;
}

export interface DunningRecord {
  tenantId: string;
  invoiceId: string;
  stage: DunningStage;
  startedAt: string;
  lastActionAt: string;
  nextActionAt: string;
  attemptCount: number;
  resolved: boolean;
  resolvedAt?: string;
}

export interface RevenueRecognitionEntry {
  entryId: string;
  tenantId: string;
  invoiceId: string;
  period: string;
  recognizedUsd: number;
  deferredUsd: number;
  recognizedAt: string;
}

export interface BillingPeriodSummary {
  tenantId: string;
  period: string;
  mrr: number;
  invoiceCount: number;
  totalBilledUsd: number;
  totalCollectedUsd: number;
  outstandingUsd: number;
  creditUsedUsd: number;
  usageByMeter: Record<string, number>;
}

export interface TaxCalculation {
  subtotalUsd: number;
  taxRate: number;
  taxableAmountUsd: number;
  taxUsd: number;
  taxJurisdiction: string;
}

export interface ProrationResult {
  proratedAmountUsd: number;
  daysUsed: number;
  totalDays: number;
  dailyRateUsd: number;
  originalAmountUsd: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let invoiceSequence = 1000;

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function nextInvoiceNumber(): string {
  return `INV-${String(++invoiceSequence).padStart(6, '0')}`;
}

function periodEnd(start: string, cycle: BillingCycle): string {
  const d = new Date(start);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function applyVolumeDiscount(units: number, tiers: VolumeDiscountTier[]): number {
  for (const tier of [...tiers].sort((a, b) => b.minUnits - a.minUnits)) {
    if (units >= tier.minUnits && (tier.maxUnits === undefined || units <= tier.maxUnits)) {
      return tier.discountPercent;
    }
  }
  return 0;
}

function dunningNextAction(stage: DunningStage): { nextStage: DunningStage; delayDays: number } {
  switch (stage) {
    case 'grace': return { nextStage: 'reminder_1', delayDays: 3 };
    case 'reminder_1': return { nextStage: 'reminder_2', delayDays: 7 };
    case 'reminder_2': return { nextStage: 'escalated', delayDays: 7 };
    case 'escalated': return { nextStage: 'suspended', delayDays: 14 };
    case 'suspended': return { nextStage: 'collections', delayDays: 30 };
    default: return { nextStage: 'collections', delayDays: 30 };
  }
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class TenantBillingEngine {
  private readonly logger = getLogger();
  private readonly cache = getCache();
  private profiles: Map<string, TenantBillingProfile> = new Map();
  private usageRecords: Map<string, UsageRecord[]> = new Map(); // keyed by tenantId
  private invoices: Map<string, Invoice> = new Map();
  private payments: Map<string, Payment> = new Map();
  private credits: Map<string, CreditAdjustment[]> = new Map();
  private dunning: Map<string, DunningRecord[]> = new Map();
  private contracts: Map<string, EnterpriseContract> = new Map();
  private revenueEntries: RevenueRecognitionEntry[] = [];

  // ── Tenant Profile Management ─────────────────────────────────────────────────

  upsertTenant(profile: Omit<TenantBillingProfile, 'createdAt' | 'updatedAt'>): TenantBillingProfile {
    const existing = this.profiles.get(profile.tenantId);
    const now = new Date().toISOString();
    const full: TenantBillingProfile = {
      ...profile,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.profiles.set(profile.tenantId, full);
    this.logger.info('TenantBillingEngine: tenant upserted', { tenantId: profile.tenantId, pricingModel: profile.pricingModel });
    return full;
  }

  getTenant(tenantId: string): TenantBillingProfile | undefined {
    return this.profiles.get(tenantId);
  }

  listTenants(): TenantBillingProfile[] {
    return [...this.profiles.values()];
  }

  // ── Enterprise Contracts ──────────────────────────────────────────────────────

  registerContract(contract: EnterpriseContract): void {
    this.contracts.set(contract.contractId, contract);
    const profile = this.profiles.get(contract.tenantId);
    if (profile) {
      profile.contractId = contract.contractId;
      profile.pricingModel = 'enterprise_contract';
      profile.updatedAt = new Date().toISOString();
    }
    this.logger.info('TenantBillingEngine: contract registered', { contractId: contract.contractId, tenantId: contract.tenantId, annualValueUsd: contract.annualValueUsd });
  }

  getContract(contractId: string): EnterpriseContract | undefined {
    return this.contracts.get(contractId);
  }

  // ── Usage Recording ───────────────────────────────────────────────────────────

  recordUsage(record: UsageRecord): void {
    const profile = this.profiles.get(record.tenantId);
    if (!profile) throw new Error(`Tenant ${record.tenantId} not found`);

    const records = this.usageRecords.get(record.tenantId) ?? [];

    // Idempotency check
    if (record.idempotencyKey && records.some(r => r.idempotencyKey === record.idempotencyKey)) {
      this.logger.info('TenantBillingEngine: duplicate usage record skipped', { idempotencyKey: record.idempotencyKey });
      return;
    }

    records.push(record);
    this.usageRecords.set(record.tenantId, records);
    this.cache.delete(`usage-agg:${record.tenantId}`);
  }

  aggregateUsage(tenantId: string, periodStart: string, periodEnd: string): Record<string, number> {
    const cacheKey = `usage-agg:${tenantId}:${periodStart}:${periodEnd}`;
    const cached = this.cache.get<Record<string, number>>(cacheKey);
    if (cached) return cached;

    const records = (this.usageRecords.get(tenantId) ?? []).filter(
      r => r.recordedAt >= periodStart && r.recordedAt <= periodEnd,
    );

    const profile = this.profiles.get(tenantId);
    const aggregated: Record<string, number> = {};

    for (const meter of profile?.usageMeters ?? []) {
      const meterRecords = records.filter(r => r.meterId === meter.meterId);
      switch (meter.aggregationMode) {
        case 'sum':
          aggregated[meter.meterId] = meterRecords.reduce((s, r) => s + r.quantity, 0);
          break;
        case 'max':
          aggregated[meter.meterId] = Math.max(0, ...meterRecords.map(r => r.quantity));
          break;
        case 'latest':
          aggregated[meter.meterId] = meterRecords.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]?.quantity ?? 0;
          break;
      }
    }

    this.cache.set(cacheKey, aggregated, 300);
    return aggregated;
  }

  // ── Invoice Generation ────────────────────────────────────────────────────────

  generateInvoice(tenantId: string, periodStart: string): Invoice {
    const profile = this.profiles.get(tenantId);
    if (!profile) throw new Error(`Tenant ${tenantId} not found`);

    const end = periodEnd(periodStart, profile.billingCycle);
    const usage = this.aggregateUsage(tenantId, periodStart, end);
    const lineItems: InvoiceLineItem[] = [];

    switch (profile.pricingModel) {
      case 'seat_license':
        lineItems.push(...this.buildSeatLineItems(profile, periodStart, end));
        break;
      case 'usage_based':
        lineItems.push(...this.buildUsageLineItems(profile, usage, periodStart, end));
        break;
      case 'flat_rate':
        lineItems.push(...this.buildFlatRateLineItems(profile, periodStart, end));
        break;
      case 'enterprise_contract':
        lineItems.push(...this.buildContractLineItems(profile, usage, periodStart, end));
        break;
      case 'hybrid':
        lineItems.push(...this.buildSeatLineItems(profile, periodStart, end));
        lineItems.push(...this.buildUsageLineItems(profile, usage, periodStart, end));
        break;
    }

    const subtotal = lineItems.reduce((s, li) => s + li.subtotalUsd, 0);

    // Annual discount
    let discountAmount = 0;
    if (profile.billingCycle === 'annual' && profile.annualDiscountPercent > 0) {
      discountAmount = subtotal * (profile.annualDiscountPercent / 100);
    }

    const tax = this.calculateTax({ subtotalUsd: subtotal - discountAmount, taxRate: profile.taxRate, taxableAmountUsd: subtotal - discountAmount, taxUsd: 0, taxJurisdiction: 'default' });
    const creditApplied = Math.min(profile.creditBalance, subtotal - discountAmount + tax.taxUsd);
    const amountDue = Math.max(0, subtotal - discountAmount + tax.taxUsd - creditApplied);

    const invoice: Invoice = {
      invoiceId: generateId(),
      tenantId,
      invoiceNumber: nextInvoiceNumber(),
      status: 'open',
      periodStart,
      periodEnd: end,
      lineItems,
      subtotalUsd: Math.round(subtotal * 100) / 100,
      discountUsd: Math.round(discountAmount * 100) / 100,
      taxUsd: Math.round(tax.taxUsd * 100) / 100,
      totalUsd: Math.round((subtotal - discountAmount + tax.taxUsd) * 100) / 100,
      creditAppliedUsd: Math.round(creditApplied * 100) / 100,
      amountDueUsd: Math.round(amountDue * 100) / 100,
      currency: profile.currency,
      dueDate: addDays(new Date().toISOString().split('T')[0], 30),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Apply credit
    if (creditApplied > 0) {
      profile.creditBalance = Math.round((profile.creditBalance - creditApplied) * 100) / 100;
      profile.updatedAt = new Date().toISOString();
    }

    this.invoices.set(invoice.invoiceId, invoice);
    this.logger.info('TenantBillingEngine: invoice generated', { invoiceId: invoice.invoiceId, tenantId, amountDue: invoice.amountDueUsd });
    return invoice;
  }

  private buildSeatLineItems(profile: TenantBillingProfile, start: string, end: string): InvoiceLineItem[] {
    const seats = profile.seatCount ?? 1;
    const pricePerSeat = profile.seatPriceUsd ?? 0;
    const volumeDiscount = profile.volumeDiscountTiers ? applyVolumeDiscount(seats, profile.volumeDiscountTiers) : 0;
    const subtotal = seats * pricePerSeat * (1 - volumeDiscount / 100);
    return [{
      id: generateId(),
      description: `Seat licenses (${seats} seats × $${pricePerSeat})`,
      quantity: seats,
      unitPriceUsd: pricePerSeat,
      discountPercent: volumeDiscount,
      subtotalUsd: Math.round(subtotal * 100) / 100,
      period: { start, end },
    }];
  }

  private buildUsageLineItems(profile: TenantBillingProfile, usage: Record<string, number>, start: string, end: string): InvoiceLineItem[] {
    const items: InvoiceLineItem[] = [];
    for (const meter of profile.usageMeters ?? []) {
      const totalUnits = usage[meter.meterId] ?? 0;
      const billableUnits = Math.max(0, totalUnits - meter.includedUnits);
      if (billableUnits === 0) continue;
      const volumeDiscount = profile.volumeDiscountTiers ? applyVolumeDiscount(billableUnits, profile.volumeDiscountTiers) : 0;
      const subtotal = billableUnits * meter.pricePerUnit * (1 - volumeDiscount / 100);
      items.push({
        id: generateId(),
        description: `${meter.name} usage (${billableUnits} ${meter.unit} × $${meter.pricePerUnit})`,
        quantity: billableUnits,
        unitPriceUsd: meter.pricePerUnit,
        discountPercent: volumeDiscount,
        subtotalUsd: Math.round(subtotal * 100) / 100,
        meterId: meter.meterId,
        period: { start, end },
      });
    }
    return items;
  }

  private buildFlatRateLineItems(profile: TenantBillingProfile, start: string, end: string): InvoiceLineItem[] {
    const monthlyRate = profile.seatPriceUsd ?? 0;
    return [{
      id: generateId(),
      description: `${profile.planId} subscription`,
      quantity: 1,
      unitPriceUsd: monthlyRate,
      discountPercent: 0,
      subtotalUsd: monthlyRate,
      period: { start, end },
    }];
  }

  private buildContractLineItems(profile: TenantBillingProfile, usage: Record<string, number>, start: string, end: string): InvoiceLineItem[] {
    const contract = profile.contractId ? this.contracts.get(profile.contractId) : undefined;
    if (!contract) return this.buildFlatRateLineItems(profile, start, end);

    const monthlyContractValue = contract.annualValueUsd / 12;
    const items: InvoiceLineItem[] = [{
      id: generateId(),
      description: `Enterprise contract (${contract.contractId})`,
      quantity: 1,
      unitPriceUsd: monthlyContractValue,
      discountPercent: 0,
      subtotalUsd: Math.round(monthlyContractValue * 100) / 100,
      period: { start, end },
    }];

    // Overage usage
    for (const meter of profile.usageMeters ?? []) {
      const totalUnits = usage[meter.meterId] ?? 0;
      const committedUnits = contract.committedSeats ?? meter.includedUnits;
      const overageUnits = Math.max(0, totalUnits - committedUnits);
      if (overageUnits > 0) {
        const overagePrice = meter.pricePerUnit * contract.overageRateMultiplier;
        items.push({
          id: generateId(),
          description: `${meter.name} overage (${overageUnits} ${meter.unit})`,
          quantity: overageUnits,
          unitPriceUsd: overagePrice,
          discountPercent: 0,
          subtotalUsd: Math.round(overageUnits * overagePrice * 100) / 100,
          meterId: meter.meterId,
          period: { start, end },
        });
      }
    }

    return items;
  }

  // ── Tax Calculation ───────────────────────────────────────────────────────────

  calculateTax(params: Omit<TaxCalculation, 'taxUsd'>): TaxCalculation {
    const taxUsd = params.taxableAmountUsd * (params.taxRate / 100);
    return { ...params, taxUsd: Math.round(taxUsd * 100) / 100 };
  }

  // ── Proration ─────────────────────────────────────────────────────────────────

  prorate(originalAmountUsd: number, startDate: string, endDate: string, cycleStartDate: string): ProrationResult {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const cycleStart = new Date(cycleStartDate);
    const totalDays = daysInMonth(cycleStart.getFullYear(), cycleStart.getMonth());
    const daysUsed = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
    const dailyRate = originalAmountUsd / totalDays;
    const proratedAmount = Math.round(dailyRate * daysUsed * 100) / 100;
    return { proratedAmountUsd: proratedAmount, daysUsed, totalDays, dailyRateUsd: Math.round(dailyRate * 100) / 100, originalAmountUsd };
  }

  // ── Payment Collection ────────────────────────────────────────────────────────

  async collectPayment(invoiceId: string, paymentMethod: string): Promise<Payment> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status === 'paid') throw new Error(`Invoice ${invoiceId} is already paid`);

    const payment: Payment = {
      paymentId: generateId(),
      invoiceId,
      tenantId: invoice.tenantId,
      amountUsd: invoice.amountDueUsd,
      currency: invoice.currency,
      status: 'processing',
      paymentMethod,
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.payments.set(payment.paymentId, payment);

    // Simulate payment processing (in production, call payment gateway)
    const success = Math.random() > 0.05; // 95% success rate simulation
    if (success) {
      payment.status = 'succeeded';
      payment.processedAt = new Date().toISOString();
      invoice.status = 'paid';
      invoice.paidAt = payment.processedAt;
      invoice.updatedAt = payment.processedAt;
      this.recordRevenueRecognition(invoice);
      this.logger.info('TenantBillingEngine: payment collected', { paymentId: payment.paymentId, invoiceId, amountUsd: payment.amountUsd });
    } else {
      payment.status = 'failed';
      payment.failureReason = 'Payment declined by processor';
      invoice.status = 'past_due';
      invoice.updatedAt = new Date().toISOString();
      await this.initiateDunning(invoice.tenantId, invoiceId);
      this.logger.warn('TenantBillingEngine: payment failed', { paymentId: payment.paymentId, invoiceId });
    }

    return payment;
  }

  // ── Dunning Management ────────────────────────────────────────────────────────

  async initiateDunning(tenantId: string, invoiceId: string): Promise<DunningRecord> {
    const now = new Date().toISOString();
    const { delayDays } = dunningNextAction('grace');
    const record: DunningRecord = {
      tenantId,
      invoiceId,
      stage: 'grace',
      startedAt: now,
      lastActionAt: now,
      nextActionAt: addDays(now.split('T')[0], delayDays),
      attemptCount: 0,
      resolved: false,
    };

    const existing = this.dunning.get(tenantId) ?? [];
    existing.push(record);
    this.dunning.set(tenantId, existing);
    this.logger.info('TenantBillingEngine: dunning initiated', { tenantId, invoiceId, stage: record.stage });
    return record;
  }

  advanceDunning(tenantId: string, invoiceId: string): DunningRecord | undefined {
    const records = this.dunning.get(tenantId) ?? [];
    const record = records.find(r => r.invoiceId === invoiceId && !r.resolved);
    if (!record) return undefined;

    const { nextStage, delayDays } = dunningNextAction(record.stage);
    const now = new Date().toISOString();
    record.stage = nextStage;
    record.lastActionAt = now;
    record.nextActionAt = addDays(now.split('T')[0], delayDays);
    record.attemptCount++;

    if (nextStage === 'suspended') {
      const profile = this.profiles.get(tenantId);
      if (profile) { profile.suspendedAt = now; profile.updatedAt = now; }
    }

    this.logger.info('TenantBillingEngine: dunning advanced', { tenantId, invoiceId, stage: record.stage });
    return record;
  }

  resolveDunning(tenantId: string, invoiceId: string): void {
    const records = this.dunning.get(tenantId) ?? [];
    const record = records.find(r => r.invoiceId === invoiceId && !r.resolved);
    if (record) {
      record.resolved = true;
      record.resolvedAt = new Date().toISOString();
    }
    const profile = this.profiles.get(tenantId);
    if (profile?.suspendedAt) { delete profile.suspendedAt; profile.updatedAt = new Date().toISOString(); }
    this.logger.info('TenantBillingEngine: dunning resolved', { tenantId, invoiceId });
  }

  getDueDunningActions(): DunningRecord[] {
    const now = new Date().toISOString().split('T')[0];
    const due: DunningRecord[] = [];
    for (const records of this.dunning.values()) {
      for (const r of records) {
        if (!r.resolved && r.nextActionAt <= now) due.push(r);
      }
    }
    return due;
  }

  // ── Credit & Debit Adjustments ────────────────────────────────────────────────

  applyCredit(tenantId: string, amountUsd: number, reason: string, createdBy: string): CreditAdjustment {
    const profile = this.profiles.get(tenantId);
    if (!profile) throw new Error(`Tenant ${tenantId} not found`);

    const adjustment: CreditAdjustment = {
      adjustmentId: generateId(),
      tenantId,
      amountUsd,
      type: 'credit',
      reason,
      createdAt: new Date().toISOString(),
      createdBy,
    };

    profile.creditBalance = Math.round((profile.creditBalance + amountUsd) * 100) / 100;
    profile.updatedAt = new Date().toISOString();

    const list = this.credits.get(tenantId) ?? [];
    list.push(adjustment);
    this.credits.set(tenantId, list);

    this.logger.info('TenantBillingEngine: credit applied', { tenantId, amountUsd, creditBalance: profile.creditBalance });
    return adjustment;
  }

  applyDebit(tenantId: string, amountUsd: number, reason: string, createdBy: string): CreditAdjustment {
    const profile = this.profiles.get(tenantId);
    if (!profile) throw new Error(`Tenant ${tenantId} not found`);
    if (profile.creditBalance < amountUsd) throw new Error(`Insufficient credit balance (${profile.creditBalance} < ${amountUsd})`);

    const adjustment: CreditAdjustment = {
      adjustmentId: generateId(),
      tenantId,
      amountUsd,
      type: 'debit',
      reason,
      createdAt: new Date().toISOString(),
      createdBy,
    };

    profile.creditBalance = Math.round((profile.creditBalance - amountUsd) * 100) / 100;
    profile.updatedAt = new Date().toISOString();

    const list = this.credits.get(tenantId) ?? [];
    list.push(adjustment);
    this.credits.set(tenantId, list);

    this.logger.info('TenantBillingEngine: debit applied', { tenantId, amountUsd, creditBalance: profile.creditBalance });
    return adjustment;
  }

  getCreditHistory(tenantId: string): CreditAdjustment[] {
    return this.credits.get(tenantId) ?? [];
  }

  // ── Revenue Recognition ───────────────────────────────────────────────────────

  private recordRevenueRecognition(invoice: Invoice): void {
    // Spread revenue recognition over the billing period
    const startDate = new Date(invoice.periodStart);
    const endDate = new Date(invoice.periodEnd);
    const periodMonths = Math.ceil((endDate.getTime() - startDate.getTime()) / (30 * 86_400_000)) || 1;
    const revenuePerMonth = invoice.totalUsd / periodMonths;

    for (let i = 0; i < periodMonths; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const isLast = i === periodMonths - 1;
      const recognized = isLast ? invoice.totalUsd - revenuePerMonth * (periodMonths - 1) : revenuePerMonth;
      const deferred = invoice.totalUsd - recognized;

      this.revenueEntries.push({
        entryId: generateId(),
        tenantId: invoice.tenantId,
        invoiceId: invoice.invoiceId,
        period,
        recognizedUsd: Math.round(recognized * 100) / 100,
        deferredUsd: Math.round(Math.max(0, deferred) * 100) / 100,
        recognizedAt: new Date().toISOString(),
      });
    }
  }

  getRevenueRecognition(tenantId: string, period?: string): RevenueRecognitionEntry[] {
    return this.revenueEntries.filter(e => e.tenantId === tenantId && (period === undefined || e.period === period));
  }

  // ── Billing Period Summary ────────────────────────────────────────────────────

  getBillingPeriodSummary(tenantId: string, period: string): BillingPeriodSummary {
    const cacheKey = `billing-summary:${tenantId}:${period}`;
    const cached = this.cache.get<BillingPeriodSummary>(cacheKey);
    if (cached) return cached;

    const periodInvoices = [...this.invoices.values()].filter(
      inv => inv.tenantId === tenantId && inv.periodStart.startsWith(period),
    );
    const periodPayments = [...this.payments.values()].filter(
      p => p.tenantId === tenantId && p.status === 'succeeded' && (p.processedAt ?? '').startsWith(period),
    );

    const totalBilled = periodInvoices.reduce((s, i) => s + i.totalUsd, 0);
    const totalCollected = periodPayments.reduce((s, p) => s + p.amountUsd, 0);
    const outstanding = periodInvoices.filter(i => i.status === 'open' || i.status === 'past_due').reduce((s, i) => s + i.amountDueUsd, 0);
    const creditUsed = periodInvoices.reduce((s, i) => s + i.creditAppliedUsd, 0);

    const profile = this.profiles.get(tenantId);
    const [year, month] = period.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0).toISOString();
    const usageByMeter = this.aggregateUsage(tenantId, startDate, endDate);

    const summary: BillingPeriodSummary = {
      tenantId,
      period,
      mrr: profile?.billingCycle === 'monthly' ? totalBilled : totalBilled / 12,
      invoiceCount: periodInvoices.length,
      totalBilledUsd: Math.round(totalBilled * 100) / 100,
      totalCollectedUsd: Math.round(totalCollected * 100) / 100,
      outstandingUsd: Math.round(outstanding * 100) / 100,
      creditUsedUsd: Math.round(creditUsed * 100) / 100,
      usageByMeter,
    };

    this.cache.set(cacheKey, summary, 300);
    return summary;
  }

  // ── Invoice Lookup ────────────────────────────────────────────────────────────

  getInvoice(invoiceId: string): Invoice | undefined {
    return this.invoices.get(invoiceId);
  }

  listInvoices(tenantId: string, status?: InvoiceStatus[]): Invoice[] {
    return [...this.invoices.values()].filter(
      inv => inv.tenantId === tenantId && (status === undefined || status.includes(inv.status)),
    );
  }

  voidInvoice(invoiceId: string, reason: string): Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status === 'paid') throw new Error('Cannot void a paid invoice');
    invoice.status = 'void';
    invoice.voidedAt = new Date().toISOString();
    invoice.updatedAt = invoice.voidedAt;
    this.logger.info('TenantBillingEngine: invoice voided', { invoiceId, reason });
    return invoice;
  }

  // ── Payment Failure Recovery ──────────────────────────────────────────────────

  async retryFailedPayment(paymentId: string): Promise<Payment> {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`Payment ${paymentId} not found`);
    if (payment.status === 'succeeded') throw new Error('Payment already succeeded');
    if (payment.retryCount >= 3) throw new Error('Maximum retry attempts reached');

    payment.retryCount++;
    payment.status = 'processing';

    const success = Math.random() > 0.3; // higher retry success
    if (success) {
      payment.status = 'succeeded';
      payment.processedAt = new Date().toISOString();
      const invoice = this.invoices.get(payment.invoiceId);
      if (invoice) {
        invoice.status = 'paid';
        invoice.paidAt = payment.processedAt;
        invoice.updatedAt = payment.processedAt;
        this.recordRevenueRecognition(invoice);
        this.resolveDunning(payment.tenantId, payment.invoiceId);
      }
      this.logger.info('TenantBillingEngine: payment retry succeeded', { paymentId, retryCount: payment.retryCount });
    } else {
      payment.status = 'failed';
      payment.failureReason = 'Retry declined';
      const backoffDays = Math.pow(2, payment.retryCount);
      payment.nextRetryAt = addDays(new Date().toISOString().split('T')[0], backoffDays);
      this.logger.warn('TenantBillingEngine: payment retry failed', { paymentId, retryCount: payment.retryCount, nextRetryAt: payment.nextRetryAt });
    }

    return payment;
  }

  getPayment(paymentId: string): Payment | undefined {
    return this.payments.get(paymentId);
  }

  listPayments(tenantId: string): Payment[] {
    return [...this.payments.values()].filter(p => p.tenantId === tenantId);
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getTenantBillingEngine(): TenantBillingEngine {
  if (!globalThis.__tenantBillingEngine__) {
    globalThis.__tenantBillingEngine__ = new TenantBillingEngine();
  }
  return globalThis.__tenantBillingEngine__ as TenantBillingEngine;
}
