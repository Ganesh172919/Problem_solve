import { NextRequest, NextResponse } from 'next/server';
import { getSecureDataVault } from '../../../../lib/secureDataVault';
import type { DataClassification, MaskingPolicy } from '../../../../lib/secureDataVault';

const vault = getSecureDataVault();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? '';
  const recordId = searchParams.get('recordId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(vault.getSummary());
    if (action === 'keys') {
      return NextResponse.json(vault.listKeys(tenantId || undefined));
    }
    if (action === 'near_expiry') {
      const warningDays = parseInt(searchParams.get('warningDays') ?? '30', 10);
      return NextResponse.json(vault.getKeysNearExpiry(warningDays));
    }
    if (action === 'audit_log') {
      if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
      const limit = parseInt(searchParams.get('limit') ?? '100', 10);
      return NextResponse.json(vault.getAuditLog(tenantId, limit));
    }
    if (action === 'decrypt' && recordId) {
      const requestId = searchParams.get('requestId') ?? 'api';
      const userId = searchParams.get('userId') ?? undefined;
      const plaintext = vault.decrypt(recordId, { requestId, userId });
      if (plaintext === null) return NextResponse.json({ error: 'Decryption failed or record expired' }, { status: 400 });
      return NextResponse.json({ plaintext });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'create_key') {
      const key = vault.createKey(body.tenantId as string, body.expiryDays as number | undefined);
      return NextResponse.json({ keyId: key.id, version: key.version, expiresAt: key.expiresAt });
    }
    if (action === 'encrypt') {
      const record = vault.encrypt(
        body.tenantId as string,
        body.plaintext as string,
        body.classification as DataClassification,
        {
          fieldPath: body.fieldPath as string | undefined,
          expiryDays: body.expiryDays as number | undefined,
          requestId: body.requestId as string | undefined,
          userId: body.userId as string | undefined,
        }
      );
      return NextResponse.json({ recordId: record.id, keyId: record.keyId, encryptedAt: record.encryptedAt });
    }
    if (action === 'decrypt') {
      const plaintext = vault.decrypt(body.recordId as string, {
        requestId: body.requestId as string | undefined,
        userId: body.userId as string | undefined,
      });
      if (plaintext === null) return NextResponse.json({ error: 'Decryption failed or record expired' }, { status: 400 });
      return NextResponse.json({ plaintext });
    }
    if (action === 'tokenize') {
      const token = vault.tokenize(body.tenantId as string, body.value as string, body.dataType as string);
      return NextResponse.json({ token: token.token, id: token.id, format: token.originalFormat });
    }
    if (action === 'detokenize') {
      const original = vault.detokenize(body.token as string, body.tenantId as string);
      if (original === null) return NextResponse.json({ error: 'Token not found or inactive' }, { status: 404 });
      return NextResponse.json({ original });
    }
    if (action === 'mask') {
      const masked = vault.applyMaskingPolicy(body.value as string, body.fieldPath as string, body.tenantId as string);
      return NextResponse.json({ masked });
    }
    if (action === 'register_masking_policy') {
      vault.registerMaskingPolicy(body.policy as MaskingPolicy);
      return NextResponse.json({ success: true });
    }
    if (action === 'rotate_key') {
      const newKey = vault.rotateKey(body.tenantId as string);
      return NextResponse.json({ newKeyId: newKey.id, version: newKey.version });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
