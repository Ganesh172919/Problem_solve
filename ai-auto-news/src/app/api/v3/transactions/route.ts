import { NextRequest, NextResponse } from 'next/server';
import { getTransactionManager } from '../../../../lib/crossServiceTransactionManager';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const manager = getTransactionManager();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: manager.getSummary() });
    }
    if (action === 'list') {
      const status = searchParams.get('status') as Parameters<typeof manager.listTransactions>[1];
      return NextResponse.json({ success: true, data: manager.listTransactions(tenantId, status) });
    }
    if (action === 'get') {
      const txId = searchParams.get('txId');
      if (!txId) return NextResponse.json({ error: 'txId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: manager.getTransaction(txId) });
    }
    if (action === 'outbox') {
      const status = searchParams.get('status') as Parameters<typeof manager.listOutbox>[0];
      return NextResponse.json({ success: true, data: manager.listOutbox(status) });
    }
    if (action === 'compensations') {
      const txId = searchParams.get('txId');
      return NextResponse.json({ success: true, data: manager.listCompensations(txId ?? undefined) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const manager = getTransactionManager();

    if (action === 'initiate') {
      const tx = manager.initiate(body);
      return NextResponse.json({ success: true, data: tx });
    }
    if (action === 'prepare') {
      const ok = manager.prepare(body.transactionId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'participant_prepared') {
      const ok = manager.participantPrepared(body.transactionId, body.serviceId, body.commitPayload);
      return NextResponse.json({ success: ok });
    }
    if (action === 'commit') {
      const ok = manager.commit(body.transactionId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'participant_committed') {
      const ok = manager.participantCommitted(body.transactionId, body.serviceId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'rollback') {
      const ok = manager.rollback(body.transactionId, body.reason ?? 'manual');
      return NextResponse.json({ success: ok });
    }
    if (action === 'acquire_lock') {
      const ok = manager.acquireLock(body.resourceId, body.tenantId, body.transactionId, body.ttlMs);
      return NextResponse.json({ success: ok });
    }
    if (action === 'release_lock') {
      const ok = manager.releaseLock(body.resourceId, body.tenantId, body.transactionId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'detect_timeouts') {
      const timedOut = manager.detectTimedOutTransactions();
      return NextResponse.json({ success: true, data: timedOut });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
