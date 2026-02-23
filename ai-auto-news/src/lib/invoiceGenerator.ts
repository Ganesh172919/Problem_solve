import { logger } from '@/lib/logger';
import { TIER_LIMITS } from '@/lib/config';
import { SubscriptionTier } from '@/types/saas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void' | 'overdue';

export type LineItemType = 'recurring' | 'one_time' | 'credit' | 'discount' | 'tax' | 'proration';

export interface InvoiceLineItem {
  id: string;
  description: string;
  type: LineItemType;
  quantity: number;
  unitPrice: number;
  amount: number;
  metadata: Record<string, unknown>;
}

export interface TaxConfig {
  enabled: boolean;
  rates: TaxRate[];
  defaultRate: number;
}

export interface TaxRate {
  name: string;
  rate: number;
  region: string;
  inclusive: boolean;
}

export interface InvoiceNumberConfig {
  prefix: string;
  separator: string;
  padLength: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  tier: SubscriptionTier;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  creditTotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreditMemo {
  id: string;
  memoNumber: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  reason: string;
  lineItems: InvoiceLineItem[];
  status: 'issued' | 'applied' | 'void';
  createdAt: string;
}

export interface InvoiceGeneratorConfig {
  numberConfig: InvoiceNumberConfig;
  taxConfig: TaxConfig;
  defaultCurrency: string;
  defaultPaymentTermDays: number;
}

export interface UsageRecord {
  description: string;
  quantity: number;
  unitPrice: number;
  type: LineItemType;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${ts}${rand}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: InvoiceGeneratorConfig = {
  numberConfig: { prefix: 'INV', separator: '-', padLength: 7 },
  taxConfig: { enabled: false, rates: [], defaultRate: 0 },
  defaultCurrency: 'USD',
  defaultPaymentTermDays: 30,
};

// ---------------------------------------------------------------------------
// InvoiceGenerator
// ---------------------------------------------------------------------------

export class InvoiceGenerator {
  private invoices = new Map<string, Invoice>();
  private creditMemos = new Map<string, CreditMemo>();
  private invoiceCounter = 0;
  private memoCounter = 0;
  private config: InvoiceGeneratorConfig;

  constructor(config: Partial<InvoiceGeneratorConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      numberConfig: { ...DEFAULT_CONFIG.numberConfig, ...config.numberConfig },
      taxConfig: { ...DEFAULT_CONFIG.taxConfig, ...config.taxConfig },
    };
    logger.info('InvoiceGenerator initialized', { config: this.config });
  }

  // ---- numbering ----------------------------------------------------------

  private nextInvoiceNumber(): string {
    this.invoiceCounter += 1;
    const { prefix, separator, padLength } = this.config.numberConfig;
    return `${prefix}${separator}${String(this.invoiceCounter).padStart(padLength, '0')}`;
  }

  private nextMemoNumber(): string {
    this.memoCounter += 1;
    const { prefix, separator, padLength } = this.config.numberConfig;
    return `CM${separator}${prefix}${separator}${String(this.memoCounter).padStart(padLength, '0')}`;
  }

  // ---- line items ---------------------------------------------------------

  private createLineItem(record: UsageRecord): InvoiceLineItem {
    const amount = parseFloat((record.quantity * record.unitPrice).toFixed(2));
    return {
      id: generateId('li'),
      description: record.description,
      type: record.type,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      amount: record.type === 'credit' || record.type === 'discount' ? -Math.abs(amount) : amount,
      metadata: record.metadata ?? {},
    };
  }

  // ---- tax calculation ----------------------------------------------------

  calculateTax(subtotal: number, region?: string): { taxAmount: number; appliedRates: TaxRate[] } {
    if (!this.config.taxConfig.enabled || subtotal <= 0) {
      return { taxAmount: 0, appliedRates: [] };
    }

    const applicableRates = region
      ? this.config.taxConfig.rates.filter((r) => r.region === region)
      : [];

    if (applicableRates.length === 0 && this.config.taxConfig.defaultRate > 0) {
      const taxAmount = parseFloat((subtotal * this.config.taxConfig.defaultRate).toFixed(2));
      return { taxAmount, appliedRates: [{ name: 'Default', rate: this.config.taxConfig.defaultRate, region: 'default', inclusive: false }] };
    }

    let taxAmount = 0;
    for (const rate of applicableRates) {
      if (rate.inclusive) {
        taxAmount += subtotal - subtotal / (1 + rate.rate);
      } else {
        taxAmount += subtotal * rate.rate;
      }
    }

    return { taxAmount: parseFloat(taxAmount.toFixed(2)), appliedRates: applicableRates };
  }

  // ---- invoice generation -------------------------------------------------

  generateInvoice(
    customerId: string,
    tier: SubscriptionTier,
    usageRecords: UsageRecord[],
    options: {
      periodStart?: string;
      periodEnd?: string;
      notes?: string;
      region?: string;
      metadata?: Record<string, unknown>;
      asDraft?: boolean;
    } = {},
  ): Invoice {
    const now = new Date();
    const lineItems = usageRecords.map((r) => this.createLineItem(r));

    const subtotal = parseFloat(
      lineItems.filter((li) => li.type !== 'credit' && li.type !== 'discount' && li.type !== 'tax')
        .reduce((sum, li) => sum + li.amount, 0)
        .toFixed(2),
    );

    const discountTotal = parseFloat(
      Math.abs(lineItems.filter((li) => li.type === 'discount').reduce((sum, li) => sum + li.amount, 0)).toFixed(2),
    );

    const creditTotal = parseFloat(
      Math.abs(lineItems.filter((li) => li.type === 'credit').reduce((sum, li) => sum + li.amount, 0)).toFixed(2),
    );

    const taxableAmount = Math.max(0, subtotal - discountTotal);
    const { taxAmount, appliedRates } = this.calculateTax(taxableAmount, options.region);

    if (taxAmount > 0) {
      lineItems.push({
        id: generateId('li'),
        description: appliedRates.map((r) => `${r.name} (${(r.rate * 100).toFixed(1)}%)`).join(', '),
        type: 'tax',
        quantity: 1,
        unitPrice: taxAmount,
        amount: taxAmount,
        metadata: { appliedRates },
      });
    }

    const total = parseFloat((subtotal - discountTotal - creditTotal + taxAmount).toFixed(2));
    const status: InvoiceStatus = options.asDraft ? 'draft' : 'issued';

    const invoice: Invoice = {
      id: generateId('inv'),
      invoiceNumber: this.nextInvoiceNumber(),
      customerId,
      tier,
      status,
      lineItems,
      subtotal,
      taxTotal: taxAmount,
      discountTotal,
      creditTotal,
      total: Math.max(0, total),
      amountPaid: 0,
      amountDue: Math.max(0, total),
      currency: this.config.defaultCurrency,
      issuedAt: status === 'issued' ? now.toISOString() : null,
      dueAt: status === 'issued' ? addDays(now, this.config.defaultPaymentTermDays).toISOString() : null,
      paidAt: null,
      voidedAt: null,
      periodStart: options.periodStart ?? now.toISOString(),
      periodEnd: options.periodEnd ?? addDays(now, 30).toISOString(),
      notes: options.notes ?? null,
      metadata: options.metadata ?? {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.invoices.set(invoice.id, invoice);
    logger.info('Invoice generated', { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total });
    return invoice;
  }

  // ---- recurring invoice shortcut -----------------------------------------

  generateRecurringInvoice(
    customerId: string,
    tier: SubscriptionTier,
    periodStart: string,
    periodEnd: string,
    options: { region?: string; notes?: string; metadata?: Record<string, unknown> } = {},
  ): Invoice {
    const price = TIER_LIMITS[tier].monthlyPriceUsd;
    const records: UsageRecord[] = [
      { description: `${tier} plan – monthly subscription`, quantity: 1, unitPrice: price, type: 'recurring' },
    ];
    return this.generateInvoice(customerId, tier, records, { periodStart, periodEnd, ...options });
  }

  // ---- enterprise aggregate invoice ---------------------------------------

  generateAggregateInvoice(
    customerId: string,
    childInvoiceIds: string[],
    options: { notes?: string; region?: string; metadata?: Record<string, unknown> } = {},
  ): Invoice {
    const allItems: UsageRecord[] = [];
    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    for (const childId of childInvoiceIds) {
      const child = this.invoices.get(childId);
      if (!child) {
        logger.warn('Child invoice not found for aggregate', { childId });
        continue;
      }
      for (const li of child.lineItems) {
        allItems.push({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, type: li.type, metadata: { sourceInvoice: childId } });
      }
      if (!periodStart || child.periodStart < periodStart) periodStart = child.periodStart;
      if (!periodEnd || child.periodEnd > periodEnd) periodEnd = child.periodEnd;
    }

    return this.generateInvoice('enterprise', 'enterprise', allItems, {
      periodStart,
      periodEnd,
      notes: options.notes,
      region: options.region,
      metadata: { ...options.metadata, aggregatedFrom: childInvoiceIds, parentCustomerId: customerId },
    });
  }

  // ---- status management --------------------------------------------------

  issueInvoice(invoiceId: string): Invoice {
    const inv = this.getOrThrow(invoiceId);
    if (inv.status !== 'draft') throw new Error(`Cannot issue invoice with status=${inv.status}`);
    const now = new Date();
    inv.status = 'issued';
    inv.issuedAt = now.toISOString();
    inv.dueAt = addDays(now, this.config.defaultPaymentTermDays).toISOString();
    inv.updatedAt = now.toISOString();
    logger.info('Invoice issued', { invoiceId, invoiceNumber: inv.invoiceNumber });
    return inv;
  }

  recordPayment(invoiceId: string, amount: number): Invoice {
    const inv = this.getOrThrow(invoiceId);
    if (inv.status === 'void' || inv.status === 'paid') throw new Error(`Cannot pay invoice with status=${inv.status}`);
    inv.amountPaid = parseFloat((inv.amountPaid + amount).toFixed(2));
    inv.amountDue = parseFloat(Math.max(0, inv.total - inv.amountPaid).toFixed(2));
    if (inv.amountDue <= 0) {
      inv.status = 'paid';
      inv.paidAt = new Date().toISOString();
    }
    inv.updatedAt = new Date().toISOString();
    logger.info('Payment recorded on invoice', { invoiceId, amount, amountDue: inv.amountDue });
    return inv;
  }

  voidInvoice(invoiceId: string): Invoice {
    const inv = this.getOrThrow(invoiceId);
    if (inv.status === 'paid') throw new Error('Cannot void a paid invoice');
    inv.status = 'void';
    inv.voidedAt = new Date().toISOString();
    inv.amountDue = 0;
    inv.updatedAt = new Date().toISOString();
    logger.info('Invoice voided', { invoiceId });
    return inv;
  }

  markOverdue(invoiceId: string): Invoice {
    const inv = this.getOrThrow(invoiceId);
    if (inv.status !== 'issued') throw new Error(`Cannot mark overdue for status=${inv.status}`);
    inv.status = 'overdue';
    inv.updatedAt = new Date().toISOString();
    logger.warn('Invoice marked overdue', { invoiceId, invoiceNumber: inv.invoiceNumber });
    return inv;
  }

  checkOverdueInvoices(): Invoice[] {
    const now = new Date();
    const overdue: Invoice[] = [];
    for (const inv of this.invoices.values()) {
      if (inv.status === 'issued' && inv.dueAt && new Date(inv.dueAt) < now) {
        inv.status = 'overdue';
        inv.updatedAt = now.toISOString();
        overdue.push(inv);
      }
    }
    if (overdue.length > 0) logger.info('Overdue invoices detected', { count: overdue.length });
    return overdue;
  }

  // ---- credit memo --------------------------------------------------------

  generateCreditMemo(
    invoiceId: string,
    amount: number,
    reason: string,
    lineItems: UsageRecord[] = [],
  ): CreditMemo {
    const inv = this.getOrThrow(invoiceId);
    const items = lineItems.length > 0
      ? lineItems.map((r) => this.createLineItem(r))
      : [{ id: generateId('li'), description: reason, type: 'credit' as LineItemType, quantity: 1, unitPrice: amount, amount: -amount, metadata: {} }];

    const memo: CreditMemo = {
      id: generateId('cm'),
      memoNumber: this.nextMemoNumber(),
      invoiceId,
      customerId: inv.customerId,
      amount,
      reason,
      lineItems: items,
      status: 'issued',
      createdAt: new Date().toISOString(),
    };

    this.creditMemos.set(memo.id, memo);
    logger.info('Credit memo generated', { memoId: memo.id, invoiceId, amount });
    return memo;
  }

  applyCreditMemo(memoId: string): CreditMemo {
    const memo = this.creditMemos.get(memoId);
    if (!memo) throw new Error(`Credit memo not found: ${memoId}`);
    if (memo.status !== 'issued') throw new Error(`Credit memo already ${memo.status}`);

    const inv = this.invoices.get(memo.invoiceId);
    if (inv) {
      this.recordPayment(inv.id, memo.amount);
    }

    memo.status = 'applied';
    logger.info('Credit memo applied', { memoId, invoiceId: memo.invoiceId });
    return memo;
  }

  // ---- queries ------------------------------------------------------------

  getInvoice(invoiceId: string): Invoice | undefined {
    return this.invoices.get(invoiceId);
  }

  getInvoicesByCustomer(customerId: string): Invoice[] {
    return [...this.invoices.values()].filter((i) => i.customerId === customerId);
  }

  getInvoicesByStatus(status: InvoiceStatus): Invoice[] {
    return [...this.invoices.values()].filter((i) => i.status === status);
  }

  getCreditMemo(memoId: string): CreditMemo | undefined {
    return this.creditMemos.get(memoId);
  }

  getTotalRevenue(): number {
    return parseFloat(
      [...this.invoices.values()]
        .filter((i) => i.status === 'paid')
        .reduce((sum, i) => sum + i.total, 0)
        .toFixed(2),
    );
  }

  getOutstandingAmount(): number {
    return parseFloat(
      [...this.invoices.values()]
        .filter((i) => i.status === 'issued' || i.status === 'overdue')
        .reduce((sum, i) => sum + i.amountDue, 0)
        .toFixed(2),
    );
  }

  // ---- internals ----------------------------------------------------------

  private getOrThrow(id: string): Invoice {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`Invoice not found: ${id}`);
    return inv;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__invoiceGenerator__';

export function getInvoiceGenerator(config?: Partial<InvoiceGeneratorConfig>): InvoiceGenerator {
  const g = globalThis as unknown as Record<string, InvoiceGenerator>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new InvoiceGenerator(config);
  }
  return g[GLOBAL_KEY];
}
