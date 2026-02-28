import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getUserPrivacyManager } from '@/lib/userPrivacyManager';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const purpose = searchParams.get('purpose');

  try {
    const manager = getUserPrivacyManager();

    const platformMetrics = manager.getPrivacyMetrics();

    let consentStatus: { userId: string; purpose: string; granted: boolean } | null = null;
    if (userId && purpose) {
      const granted = manager.checkConsent(userId, purpose);
      consentStatus = { userId, purpose, granted };
    }

    logger.info('Privacy metrics retrieved', { userId, purpose });

    return NextResponse.json({
      success: true,
      data: {
        metrics: {
          pendingRequests: platformMetrics.pendingRequests,
          avgCompletionDays: platformMetrics.avgCompletionDays,
          consentRate: platformMetrics.consentRate,
          deletionRequests: platformMetrics.deletionRequests,
          portabilityRequests: platformMetrics.portabilityRequests,
        },
        ...(consentStatus ? { consentStatus } : {}),
      },
    });
  } catch (error) {
    logger.error('Failed to retrieve privacy metrics', undefined, { userId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    action: 'request' | 'consent' | 'revoke' | 'export' | 'delete';
    userId: string;
    right?: string;
    regulation?: string;
    purpose?: string;
    format?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, userId, right, regulation, purpose, format } = body;

  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const manager = getUserPrivacyManager();

    if (action === 'request') {
      if (!right) {
        return NextResponse.json({ error: 'right is required for action=request' }, { status: 400 });
      }
      const privacyRequest = manager.submitRequest(
        userId,
        right as Parameters<typeof manager.submitRequest>[1],
        regulation as Parameters<typeof manager.submitRequest>[2],
      );
      logger.info('Privacy request submitted', { userId, right, regulation });
      return NextResponse.json({ success: true, data: { request: privacyRequest } });
    }

    if (action === 'consent') {
      if (!purpose) {
        return NextResponse.json({ error: 'purpose is required for action=consent' }, { status: 400 });
      }
      const consentRecord = manager.recordConsent(userId, purpose, true, {
        ipAddress: 'api',
        userAgent: 'platform-api/v3',
      });
      logger.info('Consent recorded', { userId, purpose });
      return NextResponse.json({ success: true, data: { consent: consentRecord } });
    }

    if (action === 'revoke') {
      if (!purpose) {
        return NextResponse.json({ error: 'purpose is required for action=revoke' }, { status: 400 });
      }
      manager.revokeConsent(userId, purpose);
      logger.info('Consent revoked', { userId, purpose });
      return NextResponse.json({ success: true, data: { userId, purpose, revoked: true } });
    }

    if (action === 'export') {
      const exportResult = manager.exportUserData(userId, (format === 'csv' ? 'csv' : 'json'));
      logger.info('User data exported', { userId, format });
      return NextResponse.json({ success: true, data: { export: exportResult } });
    }

    if (action === 'delete') {
      const deletionResult = await manager.deleteUserData(userId, regulation ?? 'user_request');
      logger.info('User data deletion initiated', { userId, regulation });
      return NextResponse.json({ success: true, data: { deletion: deletionResult } });
    }

    return NextResponse.json(
      { error: `Unknown action '${action}'. Valid actions: request, consent, revoke, export, delete` },
      { status: 400 },
    );
  } catch (error) {
    logger.error('Privacy API error', undefined, { action, userId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
