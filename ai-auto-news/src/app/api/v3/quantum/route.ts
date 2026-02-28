import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getQuantumResistantEncryption } from '@/lib/quantumResistantEncryption';
import type { QuantumAlgorithm, SecurityLevel } from '@/lib/quantumResistantEncryption';

const logger = getLogger();

const SUPPORTED_ALGORITHMS: QuantumAlgorithm[] = ['kyber', 'dilithium', 'sphincs_plus', 'ntru', 'classic_mceliece'];
const SUPPORTED_LEVELS: SecurityLevel[] = [128, 192, 256];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? 'metrics';

  try {
    const qre = getQuantumResistantEncryption();

    switch (action) {
      case 'metrics': {
        const metrics = qre.getSecurityMetrics();
        logger.info('Quantum security metrics retrieved');
        return NextResponse.json({
          success: true,
          data: {
            metrics,
            supportedAlgorithms: SUPPORTED_ALGORITHMS,
            supportedSecurityLevels: SUPPORTED_LEVELS,
          },
        });
      }
      default:
        return NextResponse.json({ error: 'Unknown action. Use: metrics' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Quantum GET failed', undefined, { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    action: 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'keygen' | 'key_exchange';
    payload?: string;
    algorithm?: QuantumAlgorithm;
    securityLevel?: SecurityLevel;
    publicKey?: string;
    privateKey?: string;
    signature?: Record<string, unknown>;
    myPrivateKey?: string;
    theirPublicKey?: string;
    keyId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, algorithm = 'kyber', securityLevel = 256 } = body;

  if (!action) {
    return NextResponse.json(
      { error: 'action is required: encrypt | decrypt | sign | verify | keygen | key_exchange' },
      { status: 400 }
    );
  }

  if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
    return NextResponse.json({ error: `Unsupported algorithm. Supported: ${SUPPORTED_ALGORITHMS.join(', ')}` }, { status: 400 });
  }

  if (!SUPPORTED_LEVELS.includes(securityLevel)) {
    return NextResponse.json({ error: `Unsupported security level. Supported: ${SUPPORTED_LEVELS.join(', ')}` }, { status: 400 });
  }

  try {
    const qre = getQuantumResistantEncryption();

    switch (action) {
      case 'keygen': {
        const keyPair = qre.generateKeyPair(algorithm, securityLevel);
        logger.info('Quantum key pair generated', { algorithm, securityLevel, keyId: keyPair.id });
        return NextResponse.json({
          success: true,
          data: {
            keyId: keyPair.id,
            algorithm: keyPair.algorithm,
            securityLevel: keyPair.securityLevel,
            publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
            privateKey: Buffer.from(keyPair.privateKey).toString('base64'),
            createdAt: keyPair.createdAt,
          },
        });
      }
      case 'encrypt': {
        if (!body.payload || !body.publicKey) {
          return NextResponse.json({ error: 'payload and publicKey are required for encrypt' }, { status: 400 });
        }
        const plaintext = Buffer.from(body.payload, 'base64');
        const pubKey = Buffer.from(body.publicKey, 'base64');
        const cipherText = qre.encrypt(plaintext, pubKey);
        logger.info('Payload encrypted', { algorithm, securityLevel, payloadSize: plaintext.length });
        return NextResponse.json({
          success: true,
          data: {
            ciphertext: Buffer.from(cipherText.ciphertext).toString('base64'),
            encapsulatedKey: cipherText.encapsulatedKey ? Buffer.from(cipherText.encapsulatedKey).toString('base64') : undefined,
            algorithm: cipherText.algorithm,
            nonce: Buffer.from(cipherText.context.nonce).toString('base64'),
            sessionId: cipherText.context.sessionId,
          },
        });
      }
      case 'decrypt': {
        if (!body.payload || !body.privateKey) {
          return NextResponse.json({ error: 'payload (ciphertext JSON) and privateKey are required for decrypt' }, { status: 400 });
        }
        const privKey = Buffer.from(body.privateKey, 'base64');
        const cipherData = JSON.parse(body.payload) as {
          ciphertext: string;
          encapsulatedKey?: string;
          algorithm: QuantumAlgorithm;
          nonce: string;
          sessionId: string;
        };
        const cipherTextObj = {
          ciphertext: Buffer.from(cipherData.ciphertext, 'base64'),
          encapsulatedKey: cipherData.encapsulatedKey ? Buffer.from(cipherData.encapsulatedKey, 'base64') : undefined,
          algorithm: cipherData.algorithm,
          context: {
            algorithm: cipherData.algorithm,
            securityLevel: securityLevel,
            nonce: Buffer.from(cipherData.nonce, 'base64'),
            sessionId: cipherData.sessionId,
          },
          createdAt: new Date(),
        };
        const decrypted = qre.decrypt(cipherTextObj, privKey);
        logger.info('Payload decrypted', { algorithm });
        return NextResponse.json({
          success: true,
          data: { plaintext: Buffer.from(decrypted).toString('base64') },
        });
      }
      case 'sign': {
        if (!body.payload || !body.privateKey) {
          return NextResponse.json({ error: 'payload and privateKey are required for sign' }, { status: 400 });
        }
        const message = Buffer.from(body.payload, 'base64');
        const privKey = Buffer.from(body.privateKey, 'base64');
        const sigResult = qre.sign(message, privKey);
        logger.info('Payload signed', { algorithm });
        return NextResponse.json({
          success: true,
          data: {
            signature: Buffer.from(sigResult.signature).toString('base64'),
            algorithm: sigResult.algorithm,
            signedAt: sigResult.signedAt,
          },
        });
      }
      case 'verify': {
        if (!body.payload || !body.signature || !body.publicKey) {
          return NextResponse.json({ error: 'payload, signature, and publicKey are required for verify' }, { status: 400 });
        }
        const message = Buffer.from(body.payload, 'base64');
        const pubKey = Buffer.from(body.publicKey, 'base64');
        const sigObj = body.signature as { signature: string; algorithm: QuantumAlgorithm; signedAt: number; keyFingerprint: string };
        const sigResult = {
          message,
          signature: Buffer.from(sigObj.signature, 'base64'),
          algorithm: sigObj.algorithm,
          keyFingerprint: sigObj.keyFingerprint ?? '',
          signedAt: new Date(sigObj.signedAt),
        };
        const valid = qre.verify(message, sigResult, pubKey);
        logger.info('Signature verified', { algorithm, valid });
        return NextResponse.json({ success: true, data: { valid } });
      }
      case 'key_exchange': {
        if (!body.myPrivateKey || !body.theirPublicKey) {
          return NextResponse.json({ error: 'myPrivateKey and theirPublicKey are required for key_exchange' }, { status: 400 });
        }
        const myPriv = Buffer.from(body.myPrivateKey, 'base64');
        const theirPub = Buffer.from(body.theirPublicKey, 'base64');
        const exchangeResult = qre.performKeyExchange(myPriv, theirPub);
        logger.info('Key exchange performed', { algorithm });
        return NextResponse.json({
          success: true,
          data: {
            sharedSecret: Buffer.from(exchangeResult.sharedSecret).toString('base64'),
            algorithm: exchangeResult.algorithm,
            sessionId: exchangeResult.sessionId,
            securityBits: exchangeResult.securityBits,
          },
        });
      }
      default:
        return NextResponse.json(
          { error: 'Unknown action. Use: encrypt | decrypt | sign | verify | keygen | key_exchange' },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Quantum operation failed', undefined, { action, algorithm, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
