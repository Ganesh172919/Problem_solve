import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentMethod = 'card' | 'bank_transfer' | 'wire' | 'check' | 'other';

export type ReconciliationStatus = 'matched' | 'partial' | 'unmatched' | 'overpaid' | 'refunded';

export interface Payment {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string;
  invoiceId: string | null;
  status: ReconciliationStatus;
  matchedAmount: number;
  refundedAmount: number;
  receivedAt: string;
  reconciledAt: string | null;
  metadata: Record<string, unknown>;
}

export interface ReconciliationRule {
  id: string;
  name: string;
  priority: number;
  match: (payment: Payment, invoices: InvoiceRef[]) => InvoiceRef | null;
  enabled: boolean;
}

export interface InvoiceRef {
  id: string;
  customerId: string;
  amountDue: number;
  total: number;
  invoiceNumber: string;
  issuedAt: string;
}

export interface CustomerBalance {
  customerId: string;
  balance: number;
  totalPaid: number;
  totalInvoiced: number;
  totalRefunded: number;
  lastPaymentAt: string | null;
}

export interface ReconciliationReport {
  totalPayments: number;
  totalAmount: number;
  matchedCount: number;
  matchedAmount: number;
  partialCount: number;
  partialAmount: number;
  unmatchedCount: number;
  unmatchedAmount: number;
  overpaidCount: number;
  overpaidAmount: number;
  refundedCount: number;
  refundedAmount: number;
  discrepancyAmount: number;
  generatedAt: string;
}

export interface ManualQueueItem {
  id: string;
  paymentId: string;
  reason: string;
  suggestedInvoiceId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ReconciliationEngineConfig {
  autoReconcileEnabled: boolean;
  toleranceAmount: number;
  tolerancePercent: number;
  defaultCurrency: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${ts}${rand}`;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ReconciliationEngineConfig = {
  autoReconcileEnabled: true,
  toleranceAmount: 0.50,
  tolerancePercent: 0.01,
  defaultCurrency: 'USD',
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class PaymentReconciliationEngine {
  private payments = new Map<string, Payment>();
  private invoiceRefs = new Map<string, InvoiceRef>();
  private balances = new Map<string, CustomerBalance>();
  private manualQueue: ManualQueueItem[] = [];
  private rules: ReconciliationRule[] = [];
  private config: ReconciliationEngineConfig;

  constructor(config: Partial<ReconciliationEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initDefaultRules();
    logger.info('PaymentReconciliationEngine initialized', { config: this.config });
  }

  // ---- default rules ------------------------------------------------------

  private initDefaultRules(): void {
    this.rules = [
      {
        id: 'rule_exact_match',
        name: 'Exact invoice match by reference',
        priority: 1,
        enabled: true,
        match: (payment, invoices) =>
          invoices.find(
            (inv) =>
              inv.customerId === payment.customerId &&
              Math.abs(inv.amountDue - payment.amount) <= this.config.toleranceAmount,
          ) ?? null,
      },
      {
        id: 'rule_reference_match',
        name: 'Match by payment reference containing invoice number',
        priority: 2,
        enabled: true,
        match: (payment, invoices) =>
          invoices.find(
            (inv) =>
              payment.reference.includes(inv.invoiceNumber) &&
              inv.customerId === payment.customerId,
          ) ?? null,
      },
      {
        id: 'rule_customer_oldest',
        name: 'Match to oldest unpaid invoice for customer',
        priority: 3,
        enabled: true,
        match: (payment, invoices) => {
          const customerInvoices = invoices
            .filter((inv) => inv.customerId === payment.customerId && inv.amountDue > 0)
            .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
          return customerInvoices[0] ?? null;
        },
      },
    ];
  }

  addRule(rule: ReconciliationRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
    logger.info('Reconciliation rule added', { ruleId: rule.id, name: rule.name });
  }

  // ---- invoice registration -----------------------------------------------

  registerInvoice(ref: InvoiceRef): void {
    this.invoiceRefs.set(ref.id, ref);
    this.ensureBalance(ref.customerId);
    const bal = this.balances.get(ref.customerId)!;
    bal.totalInvoiced = parseFloat((bal.totalInvoiced + ref.total).toFixed(2));
    bal.balance = parseFloat((bal.totalInvoiced - bal.totalPaid + bal.totalRefunded).toFixed(2));
  }

  updateInvoiceAmountDue(invoiceId: string, amountDue: number): void {
    const ref = this.invoiceRefs.get(invoiceId);
    if (ref) ref.amountDue = amountDue;
  }

  // ---- payment recording --------------------------------------------------

  recordPayment(
    customerId: string,
    amount: number,
    method: PaymentMethod,
    reference: string,
    metadata: Record<string, unknown> = {},
  ): Payment {
    const payment: Payment = {
      id: generateId('pay'),
      customerId,
      amount,
      currency: this.config.defaultCurrency,
      method,
      reference,
      invoiceId: null,
      status: 'unmatched',
      matchedAmount: 0,
      refundedAmount: 0,
      receivedAt: new Date().toISOString(),
      reconciledAt: null,
      metadata,
    };

    this.payments.set(payment.id, payment);
    this.ensureBalance(customerId);
    const bal = this.balances.get(customerId)!;
    bal.totalPaid = parseFloat((bal.totalPaid + amount).toFixed(2));
    bal.lastPaymentAt = payment.receivedAt;
    bal.balance = parseFloat((bal.totalInvoiced - bal.totalPaid + bal.totalRefunded).toFixed(2));

    logger.info('Payment recorded', { paymentId: payment.id, customerId, amount });

    if (this.config.autoReconcileEnabled) {
      this.reconcilePayment(payment.id);
    }

    return payment;
  }

  // ---- reconciliation -----------------------------------------------------

  reconcilePayment(paymentId: string): Payment {
    const payment = this.getPaymentOrThrow(paymentId);
    if (payment.status === 'matched' || payment.status === 'refunded') return payment;

    const openInvoices = [...this.invoiceRefs.values()].filter((inv) => inv.amountDue > 0);
    const sortedRules = this.rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

    let matchedInvoice: InvoiceRef | null = null;
    for (const rule of sortedRules) {
      matchedInvoice = rule.match(payment, openInvoices);
      if (matchedInvoice) break;
    }

    if (!matchedInvoice) {
      this.addToManualQueue(payment.id, 'No matching invoice found');
      logger.warn('Payment unmatched, added to manual queue', { paymentId });
      return payment;
    }

    return this.applyMatch(payment, matchedInvoice);
  }

  private applyMatch(payment: Payment, invoice: InvoiceRef): Payment {
    const remaining = payment.amount - payment.matchedAmount;
    const applyAmount = Math.min(remaining, invoice.amountDue);

    payment.invoiceId = invoice.id;
    payment.matchedAmount = parseFloat((payment.matchedAmount + applyAmount).toFixed(2));
    invoice.amountDue = parseFloat((invoice.amountDue - applyAmount).toFixed(2));

    if (payment.matchedAmount >= payment.amount - this.config.toleranceAmount) {
      if (payment.amount > invoice.total + this.config.toleranceAmount && payment.invoiceId) {
        payment.status = 'overpaid';
      } else {
        payment.status = 'matched';
      }
    } else {
      payment.status = 'partial';
    }

    payment.reconciledAt = new Date().toISOString();
    this.invoiceRefs.set(invoice.id, invoice);

    logger.info('Payment reconciled', {
      paymentId: payment.id,
      invoiceId: invoice.id,
      appliedAmount: applyAmount,
      status: payment.status,
    });

    return payment;
  }

  reconcileAll(): { reconciled: number; queued: number } {
    let reconciled = 0;
    let queued = 0;

    for (const payment of this.payments.values()) {
      if (payment.status === 'unmatched' || payment.status === 'partial') {
        const result = this.reconcilePayment(payment.id);
        if (result.status === 'matched' || result.status === 'overpaid') {
          reconciled += 1;
        } else {
          queued += 1;
        }
      }
    }

    logger.info('Bulk reconciliation complete', { reconciled, queued });
    return { reconciled, queued };
  }

  // ---- manual queue -------------------------------------------------------

  private addToManualQueue(paymentId: string, reason: string): void {
    const existing = this.manualQueue.find((q) => q.paymentId === paymentId && !q.resolvedAt);
    if (existing) return;

    this.manualQueue.push({
      id: generateId('mq'),
      paymentId,
      reason,
      suggestedInvoiceId: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    });
  }

  getManualQueue(): ManualQueueItem[] {
    return this.manualQueue.filter((q) => !q.resolvedAt);
  }

  resolveManualItem(queueItemId: string, invoiceId: string): Payment {
    const item = this.manualQueue.find((q) => q.id === queueItemId);
    if (!item) throw new Error(`Manual queue item not found: ${queueItemId}`);

    const payment = this.getPaymentOrThrow(item.paymentId);
    const invoice = this.invoiceRefs.get(invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

    const result = this.applyMatch(payment, invoice);
    item.resolvedAt = new Date().toISOString();
    item.suggestedInvoiceId = invoiceId;

    logger.info('Manual queue item resolved', { queueItemId, paymentId: payment.id, invoiceId });
    return result;
  }

  // ---- refunds ------------------------------------------------------------

  processRefund(paymentId: string, amount: number): Payment {
    const payment = this.getPaymentOrThrow(paymentId);
    if (amount > payment.amount - payment.refundedAmount) {
      throw new Error('Refund amount exceeds available payment amount');
    }

    payment.refundedAmount = parseFloat((payment.refundedAmount + amount).toFixed(2));
    if (payment.refundedAmount >= payment.amount) {
      payment.status = 'refunded';
    }

    const bal = this.balances.get(payment.customerId);
    if (bal) {
      bal.totalRefunded = parseFloat((bal.totalRefunded + amount).toFixed(2));
      bal.balance = parseFloat((bal.totalInvoiced - bal.totalPaid + bal.totalRefunded).toFixed(2));
    }

    logger.info('Refund processed', { paymentId, amount, totalRefunded: payment.refundedAmount });
    return payment;
  }

  // ---- balance management -------------------------------------------------

  private ensureBalance(customerId: string): void {
    if (!this.balances.has(customerId)) {
      this.balances.set(customerId, {
        customerId,
        balance: 0,
        totalPaid: 0,
        totalInvoiced: 0,
        totalRefunded: 0,
        lastPaymentAt: null,
      });
    }
  }

  getCustomerBalance(customerId: string): CustomerBalance {
    this.ensureBalance(customerId);
    return this.balances.get(customerId)!;
  }

  // ---- reporting ----------------------------------------------------------

  generateReport(): ReconciliationReport {
    const all = [...this.payments.values()];
    const matched = all.filter((p) => p.status === 'matched');
    const partial = all.filter((p) => p.status === 'partial');
    const unmatched = all.filter((p) => p.status === 'unmatched');
    const overpaid = all.filter((p) => p.status === 'overpaid');
    const refunded = all.filter((p) => p.status === 'refunded');

    const sum = (arr: Payment[]) => parseFloat(arr.reduce((s, p) => s + p.amount, 0).toFixed(2));
    const totalAmount = sum(all);
    const matchedAmount = sum(matched);

    const report: ReconciliationReport = {
      totalPayments: all.length,
      totalAmount,
      matchedCount: matched.length,
      matchedAmount,
      partialCount: partial.length,
      partialAmount: sum(partial),
      unmatchedCount: unmatched.length,
      unmatchedAmount: sum(unmatched),
      overpaidCount: overpaid.length,
      overpaidAmount: sum(overpaid),
      refundedCount: refunded.length,
      refundedAmount: sum(refunded),
      discrepancyAmount: parseFloat((totalAmount - matchedAmount - sum(partial) - sum(unmatched) - sum(overpaid) - sum(refunded)).toFixed(2)),
      generatedAt: new Date().toISOString(),
    };

    logger.info('Reconciliation report generated', { totalPayments: report.totalPayments, matchedCount: report.matchedCount });
    return report;
  }

  // ---- queries ------------------------------------------------------------

  getPayment(paymentId: string): Payment | undefined {
    return this.payments.get(paymentId);
  }

  getPaymentsByCustomer(customerId: string): Payment[] {
    return [...this.payments.values()].filter((p) => p.customerId === customerId);
  }

  getPaymentsByStatus(status: ReconciliationStatus): Payment[] {
    return [...this.payments.values()].filter((p) => p.status === status);
  }

  // ---- internals ----------------------------------------------------------

  private getPaymentOrThrow(id: string): Payment {
    const p = this.payments.get(id);
    if (!p) throw new Error(`Payment not found: ${id}`);
    return p;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__paymentReconciliationEngine__';

export function getPaymentReconciliationEngine(
  config?: Partial<ReconciliationEngineConfig>,
): PaymentReconciliationEngine {
  const g = globalThis as unknown as Record<string, PaymentReconciliationEngine>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PaymentReconciliationEngine(config);
  }
  return g[GLOBAL_KEY];
}
