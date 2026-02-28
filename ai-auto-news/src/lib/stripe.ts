import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
  typescript: true,
});

interface CreateCustomerParams {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}

interface CreateSubscriptionParams {
  customerId: string;
  priceId: string;
  metadata?: Record<string, string>;
  trialPeriodDays?: number;
}

interface CreatePaymentIntentParams {
  amount: number;
  currency: string;
  customerId?: string;
  metadata?: Record<string, string>;
}

export class StripeService {
  // Customer Management
  async createCustomer(params: CreateCustomerParams): Promise<Stripe.Customer> {
    return await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata || {},
    });
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer | null> {
    try {
      return await stripe.customers.retrieve(customerId) as Stripe.Customer;
    } catch {
      return null;
    }
  }

  async updateCustomer(
    customerId: string,
    params: Partial<CreateCustomerParams>
  ): Promise<Stripe.Customer> {
    return await stripe.customers.update(customerId, params);
  }

  async deleteCustomer(customerId: string): Promise<Stripe.DeletedCustomer> {
    return await stripe.customers.del(customerId);
  }

  // Subscription Management
  async createSubscription(
    params: CreateSubscriptionParams
  ): Promise<Stripe.Subscription> {
    return await stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      metadata: params.metadata || {},
      trial_period_days: params.trialPeriodDays,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch {
      return null;
    }
  }

  async updateSubscription(
    subscriptionId: string,
    priceId: string
  ): Promise<Stripe.Subscription> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return await stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: priceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });
  }

  async cancelSubscription(
    subscriptionId: string,
    immediate: boolean = false
  ): Promise<Stripe.Subscription> {
    if (immediate) {
      return await stripe.subscriptions.cancel(subscriptionId);
    } else {
      return await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }
  }

  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
  }

  async listCustomerSubscriptions(customerId: string): Promise<Stripe.Subscription[]> {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
    });
    return subscriptions.data;
  }

  // Payment Methods
  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string
  ): Promise<Stripe.PaymentMethod> {
    return await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return await stripe.paymentMethods.detach(paymentMethodId);
  }

  async listPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return paymentMethods.data;
  }

  async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<Stripe.Customer> {
    return await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  // Payment Intents
  async createPaymentIntent(
    params: CreatePaymentIntentParams
  ): Promise<Stripe.PaymentIntent> {
    return await stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      customer: params.customerId,
      metadata: params.metadata || {},
      automatic_payment_methods: { enabled: true },
    });
  }

  async confirmPaymentIntent(
    paymentIntentId: string
  ): Promise<Stripe.PaymentIntent> {
    return await stripe.paymentIntents.confirm(paymentIntentId);
  }

  async cancelPaymentIntent(
    paymentIntentId: string
  ): Promise<Stripe.PaymentIntent> {
    return await stripe.paymentIntents.cancel(paymentIntentId);
  }

  // Invoices
  async createInvoice(customerId: string): Promise<Stripe.Invoice> {
    return await stripe.invoices.create({
      customer: customerId,
      auto_advance: true,
    });
  }

  async finalizeInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return await stripe.invoices.finalizeInvoice(invoiceId);
  }

  async payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return await stripe.invoices.pay(invoiceId);
  }

  async voidInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return await stripe.invoices.voidInvoice(invoiceId);
  }

  async listInvoices(customerId: string): Promise<Stripe.Invoice[]> {
    const invoices = await stripe.invoices.list({
      customer: customerId,
    });
    return invoices.data;
  }

  async getUpcomingInvoice(customerId: string): Promise<Stripe.UpcomingInvoice | null> {
    try {
      return await stripe.invoices.retrieveUpcoming({
        customer: customerId,
      });
    } catch {
      return null;
    }
  }

  // Usage Records (for metered billing)
  async createUsageRecord(
    subscriptionItemId: string,
    quantity: number,
    timestamp?: number
  ): Promise<Stripe.UsageRecord> {
    return await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      action: 'increment',
    });
  }

  // Prices and Products
  async listPrices(productId?: string): Promise<Stripe.Price[]> {
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
    });
    return prices.data;
  }

  async listProducts(): Promise<Stripe.Product[]> {
    const products = await stripe.products.list({
      active: true,
    });
    return products.data;
  }

  // Webhooks
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): Stripe.Event {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscriptionEvent(event);
        break;
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
        await this.handleInvoiceEvent(event);
        break;
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentEvent(event);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;
    console.log(`Subscription ${event.type}:`, subscription.id);
    // Implement your subscription handling logic here
  }

  private async handleInvoiceEvent(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    console.log(`Invoice ${event.type}:`, invoice.id);
    // Implement your invoice handling logic here
  }

  private async handlePaymentIntentEvent(event: Stripe.Event): Promise<void> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.log(`PaymentIntent ${event.type}:`, paymentIntent.id);
    // Implement your payment intent handling logic here
  }

  // Checkout Sessions
  async createCheckoutSession(params: {
    customerId?: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    return await stripe.checkout.sessions.create({
      customer: params.customerId,
      line_items: [
        {
          price: params.priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata || {},
    });
  }

  // Portal Sessions
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  // Refunds
  async createRefund(
    paymentIntentId: string,
    amount?: number
  ): Promise<Stripe.Refund> {
    return await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount,
    });
  }

  // Balance and Payouts
  async getBalance(): Promise<Stripe.Balance> {
    return await stripe.balance.retrieve();
  }

  async listPayouts(): Promise<Stripe.Payout[]> {
    const payouts = await stripe.payouts.list();
    return payouts.data;
  }
}

// Singleton instance
let stripeServiceInstance: StripeService | null = null;

export function getStripeService(): StripeService {
  if (!stripeServiceInstance) {
    stripeServiceInstance = new StripeService();
  }
  return stripeServiceInstance;
}

export default stripe;
