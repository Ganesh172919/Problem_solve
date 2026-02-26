import { NextRequest, NextResponse } from 'next/server';
import { getSecretsVaultManager } from '@/lib/secretsVaultManager';

export async function GET(request: NextRequest) {
  const vault = getSecretsVaultManager();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'health';

  switch (action) {
    case 'health':
      return NextResponse.json(vault.getVaultHealth());

    case 'list': {
      const environment = searchParams.get('environment') || undefined;
      return NextResponse.json(vault.listSecrets(environment));
    }

    case 'expiring':
      return NextResponse.json(vault.getExpiringSoon(Number(searchParams.get('days') || '7')));

    case 'needs_rotation':
      return NextResponse.json(vault.getSecretsNeedingRotation());

    case 'access_logs': {
      const key = searchParams.get('key') || undefined;
      return NextResponse.json(vault.getAccessLogs(key, Number(searchParams.get('limit') || '50')));
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const vault = getSecretsVaultManager();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'set': {
      const entry = vault.setSecret(body.data);
      return NextResponse.json({ key: entry.key, version: entry.version }, { status: 201 });
    }

    case 'get': {
      const value = vault.getSecret(body.key, body.accessor || 'api', body.accessorType || 'service');
      if (value === null) return NextResponse.json({ error: 'Access denied or secret not found' }, { status: 403 });
      return NextResponse.json({ value });
    }

    case 'rotate': {
      const success = vault.rotateSecret(body.key, body.newValue);
      return NextResponse.json({ success });
    }

    case 'delete': {
      const success = vault.deleteSecret(body.key);
      return NextResponse.json({ success });
    }

    case 'scan': {
      const result = vault.scanForLeaks(body.content, body.source);
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
