import crypto from 'crypto';
import { getActiveWebhooksForEvent, recordWebhookDelivery } from '@/db/webhooks';
import { logger } from '@/lib/logger';
import { APP_CONFIG } from '@/lib/config';

const log = logger.child({ module: 'WebhookWorker' });

export interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
  deliveryId: string;
}

function buildSignature(secret: string, payload: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return 'sha256=' + hmac.digest('hex');
}

async function deliverWebhook(
  webhookId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  attempt = 1,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const signature = buildSignature(secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.webhookTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AIAutoNews-Signature': signature,
        'X-AIAutoNews-Event': payload.event,
        'X-AIAutoNews-Delivery': payload.deliveryId,
        'User-Agent': 'AIAutoNews-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const success = response.status >= 200 && response.status < 300;

    log.info('Webhook delivered', {
      webhookId,
      url,
      event: payload.event,
      statusCode: response.status,
      success,
      attempt,
    });

    recordWebhookDelivery(webhookId, success);
    return success;
  } catch (error) {
    clearTimeout(timeout);
    log.error('Webhook delivery failed', error instanceof Error ? error : undefined, {
      webhookId,
      url,
      event: payload.event,
      attempt,
    });
    recordWebhookDelivery(webhookId, false);
    return false;
  }
}

export async function dispatchWebhookEvent(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const webhooks = getActiveWebhooksForEvent(event);
  if (webhooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    data,
    timestamp: new Date().toISOString(),
    deliveryId: crypto.randomUUID(),
  };

  log.info('Dispatching webhook event', { event, recipientCount: webhooks.length });

  const deliveries = webhooks.map(async (webhook) => {
    let success = false;
    for (let attempt = 1; attempt <= APP_CONFIG.webhookMaxRetries; attempt++) {
      success = await deliverWebhook(webhook.id, webhook.url, webhook.secret, payload, attempt);
      if (success) break;

      if (attempt < APP_CONFIG.webhookMaxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
    return { webhookId: webhook.id, success };
  });

  const results = await Promise.allSettled(deliveries);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    log.warn('Some webhook deliveries failed', { event, failed, total: webhooks.length });
  }
}
