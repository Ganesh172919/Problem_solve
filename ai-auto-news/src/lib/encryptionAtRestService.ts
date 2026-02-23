import crypto from 'crypto';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EncryptionKey {
  id: string;
  version: number;
  algorithm: string;
  keyMaterial: Buffer;
  createdAt: string;
  expiresAt: string | null;
  status: 'active' | 'rotated' | 'retired' | 'compromised';
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  keyVersion: number;
  algorithm: string;
  encryptedAt: string;
}

export interface EnvelopeEncryptedPayload {
  encryptedDataKey: string;
  dataKeyIv: string;
  dataKeyAuthTag: string;
  payload: EncryptedPayload;
  masterKeyId: string;
  masterKeyVersion: number;
}

export interface FieldEncryptionMap {
  [fieldPath: string]: EncryptedPayload;
}

export interface EncryptionMetadata {
  entityId: string;
  entityType: string;
  encryptedFields: string[];
  keyId: string;
  keyVersion: number;
  encryptedAt: string;
  lastRotatedAt: string | null;
}

export interface KeyDerivationParams {
  salt: string;
  iterations: number;
  keyLength: number;
  digest: string;
  method: 'pbkdf2' | 'hkdf';
  info?: string;
}

export interface ReEncryptionResult {
  entityId: string;
  success: boolean;
  oldKeyVersion: number;
  newKeyVersion: number;
  fieldsReEncrypted: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const KEY_EXPIRY_DAYS = 90;

// ─── Service ──────────────────────────────────────────────────────────────────

export class EncryptionAtRestService {
  private keys: Map<string, EncryptionKey> = new Map();
  private activeKeyId: string | null = null;
  private metadata: Map<string, EncryptionMetadata> = new Map();
  private log = logger.child({ service: 'EncryptionAtRestService' });

  // ─── Key Management ───────────────────────────────────────────────────────

  generateKey(expiresInDays: number = KEY_EXPIRY_DAYS): EncryptionKey {
    const id = crypto.randomUUID();
    const existing = this.getActiveKey();
    const version = existing ? existing.version + 1 : 1;

    const key: EncryptionKey = {
      id,
      version,
      algorithm: ALGORITHM,
      keyMaterial: crypto.randomBytes(KEY_LENGTH),
      createdAt: new Date().toISOString(),
      expiresAt: expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
        : null,
      status: 'active',
    };

    if (existing) {
      existing.status = 'rotated';
      this.keys.set(existing.id, existing);
    }

    this.keys.set(id, key);
    this.activeKeyId = id;
    this.log.info('Encryption key generated', { keyId: id, version });
    return { ...key, keyMaterial: Buffer.alloc(0) };
  }

  getActiveKey(): EncryptionKey | null {
    if (!this.activeKeyId) return null;
    return this.keys.get(this.activeKeyId) ?? null;
  }

  getKeyById(keyId: string): EncryptionKey | null {
    return this.keys.get(keyId) ?? null;
  }

  getKeyByVersion(version: number): EncryptionKey | null {
    for (const key of this.keys.values()) {
      if (key.version === version) return key;
    }
    return null;
  }

  retireKey(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    key.status = 'retired';
    if (this.activeKeyId === keyId) this.activeKeyId = null;
    this.log.info('Key retired', { keyId });
    return true;
  }

  markKeyCompromised(keyId: string): string[] {
    const key = this.keys.get(keyId);
    if (!key) return [];
    key.status = 'compromised';
    if (this.activeKeyId === keyId) this.activeKeyId = null;

    const affected: string[] = [];
    for (const [entityId, meta] of this.metadata.entries()) {
      if (meta.keyId === keyId) affected.push(entityId);
    }
    this.log.warn('Key marked compromised', { keyId, affectedEntities: affected.length });
    return affected;
  }

  // ─── Key Derivation ───────────────────────────────────────────────────────

  deriveKeyPBKDF2(
    passphrase: string,
    salt?: string,
    iterations: number = PBKDF2_ITERATIONS,
  ): { key: Buffer; params: KeyDerivationParams } {
    const derivedSalt = salt ?? crypto.randomBytes(32).toString('hex');
    const key = crypto.pbkdf2Sync(
      passphrase,
      derivedSalt,
      iterations,
      KEY_LENGTH,
      PBKDF2_DIGEST,
    );
    return {
      key,
      params: {
        salt: derivedSalt,
        iterations,
        keyLength: KEY_LENGTH,
        digest: PBKDF2_DIGEST,
        method: 'pbkdf2',
      },
    };
  }

  deriveKeyHKDF(
    inputKeyMaterial: Buffer,
    info: string,
    salt?: string,
  ): { key: Buffer; params: KeyDerivationParams } {
    const derivedSalt = salt ?? crypto.randomBytes(32).toString('hex');
    const key = crypto.hkdfSync(
      'sha256',
      inputKeyMaterial,
      Buffer.from(derivedSalt, 'hex'),
      info,
      KEY_LENGTH,
    );
    return {
      key: Buffer.from(key),
      params: {
        salt: derivedSalt,
        iterations: 0,
        keyLength: KEY_LENGTH,
        digest: 'sha256',
        method: 'hkdf',
        info,
      },
    };
  }

  // ─── Encrypt / Decrypt ────────────────────────────────────────────────────

  encrypt(plaintext: string | Buffer, keyOverride?: Buffer): EncryptedPayload {
    const activeKey = this.getActiveKey();
    const keyMaterial = keyOverride ?? activeKey?.keyMaterial;
    if (!keyMaterial || keyMaterial.length !== KEY_LENGTH) {
      throw new Error('No valid encryption key available');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, keyMaterial, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyId: activeKey?.id ?? 'external',
      keyVersion: activeKey?.version ?? 0,
      algorithm: ALGORITHM,
      encryptedAt: new Date().toISOString(),
    };
  }

  decrypt(payload: EncryptedPayload, keyOverride?: Buffer): Buffer {
    const keyMaterial = keyOverride ?? this.resolveKeyMaterial(payload.keyId);
    if (!keyMaterial) {
      throw new Error(`Decryption key not found: ${payload.keyId}`);
    }

    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, keyMaterial, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  decryptToString(payload: EncryptedPayload, keyOverride?: Buffer): string {
    return this.decrypt(payload, keyOverride).toString('utf8');
  }

  private resolveKeyMaterial(keyId: string): Buffer | null {
    if (keyId === 'external') return null;
    const key = this.keys.get(keyId);
    return key?.keyMaterial ?? null;
  }

  // ─── Envelope Encryption ──────────────────────────────────────────────────

  envelopeEncrypt(plaintext: string | Buffer): EnvelopeEncryptedPayload {
    const masterKey = this.getActiveKey();
    if (!masterKey) throw new Error('No active master key for envelope encryption');

    const dataKey = crypto.randomBytes(KEY_LENGTH);
    const encryptedDataKeyPayload = this.encrypt(dataKey, masterKey.keyMaterial);
    const dataPayload = this.encrypt(plaintext, dataKey);

    return {
      encryptedDataKey: encryptedDataKeyPayload.ciphertext,
      dataKeyIv: encryptedDataKeyPayload.iv,
      dataKeyAuthTag: encryptedDataKeyPayload.authTag,
      payload: dataPayload,
      masterKeyId: masterKey.id,
      masterKeyVersion: masterKey.version,
    };
  }

  envelopeDecrypt(envelope: EnvelopeEncryptedPayload): Buffer {
    const masterKey = this.keys.get(envelope.masterKeyId);
    if (!masterKey) {
      throw new Error(`Master key not found: ${envelope.masterKeyId}`);
    }

    const dataKeyPayload: EncryptedPayload = {
      ciphertext: envelope.encryptedDataKey,
      iv: envelope.dataKeyIv,
      authTag: envelope.dataKeyAuthTag,
      keyId: envelope.masterKeyId,
      keyVersion: envelope.masterKeyVersion,
      algorithm: ALGORITHM,
      encryptedAt: envelope.payload.encryptedAt,
    };

    const dataKey = this.decrypt(dataKeyPayload, masterKey.keyMaterial);
    return this.decrypt(envelope.payload, dataKey);
  }

  // ─── Field-Level Encryption ───────────────────────────────────────────────

  encryptFields(
    record: Record<string, unknown>,
    fieldsToEncrypt: string[],
    entityId: string,
    entityType: string,
  ): { encrypted: Record<string, unknown>; fieldMap: FieldEncryptionMap } {
    const activeKey = this.getActiveKey();
    if (!activeKey) throw new Error('No active key for field encryption');

    const result: Record<string, unknown> = { ...record };
    const fieldMap: FieldEncryptionMap = {};
    const encryptedFields: string[] = [];

    for (const field of fieldsToEncrypt) {
      const value = this.getNestedValue(record, field);
      if (value === undefined) continue;

      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      const payload = this.encrypt(serialized);
      fieldMap[field] = payload;
      this.setNestedValue(result, field, `__encrypted__:${field}`);
      encryptedFields.push(field);
    }

    this.metadata.set(entityId, {
      entityId,
      entityType,
      encryptedFields,
      keyId: activeKey.id,
      keyVersion: activeKey.version,
      encryptedAt: new Date().toISOString(),
      lastRotatedAt: null,
    });

    this.log.info('Fields encrypted', { entityId, entityType, fieldCount: encryptedFields.length });
    return { encrypted: result, fieldMap };
  }

  decryptFields(
    record: Record<string, unknown>,
    fieldMap: FieldEncryptionMap,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...record };

    for (const [field, payload] of Object.entries(fieldMap)) {
      try {
        const decrypted = this.decryptToString(payload);
        try {
          this.setNestedValue(result, field, JSON.parse(decrypted));
        } catch {
          this.setNestedValue(result, field, decrypted);
        }
      } catch (err) {
        this.log.error('Field decryption failed', err instanceof Error ? err : undefined, { field });
      }
    }

    return result;
  }

  // ─── Re-Encryption Workflow ───────────────────────────────────────────────

  reEncryptPayload(payload: EncryptedPayload): EncryptedPayload {
    const activeKey = this.getActiveKey();
    if (!activeKey) throw new Error('No active key for re-encryption');
    if (payload.keyId === activeKey.id) return payload;

    const plaintext = this.decrypt(payload);
    return this.encrypt(plaintext);
  }

  reEncryptFieldMap(
    fieldMap: FieldEncryptionMap,
    entityId: string,
  ): { fieldMap: FieldEncryptionMap; result: ReEncryptionResult } {
    const activeKey = this.getActiveKey();
    if (!activeKey) throw new Error('No active key for re-encryption');

    const meta = this.metadata.get(entityId);
    const oldVersion = meta?.keyVersion ?? 0;
    const newMap: FieldEncryptionMap = {};
    let count = 0;

    for (const [field, payload] of Object.entries(fieldMap)) {
      try {
        newMap[field] = this.reEncryptPayload(payload);
        count++;
      } catch (err) {
        this.log.error('Re-encryption failed for field', err instanceof Error ? err : undefined, {
          entityId,
          field,
        });
        newMap[field] = payload;
      }
    }

    if (meta) {
      meta.keyId = activeKey.id;
      meta.keyVersion = activeKey.version;
      meta.lastRotatedAt = new Date().toISOString();
    }

    const result: ReEncryptionResult = {
      entityId,
      success: count === Object.keys(fieldMap).length,
      oldKeyVersion: oldVersion,
      newKeyVersion: activeKey.version,
      fieldsReEncrypted: count,
    };

    this.log.info('Re-encryption completed', { entityId, fieldsReEncrypted: count });
    return { fieldMap: newMap, result };
  }

  bulkReEncrypt(
    items: Array<{ entityId: string; fieldMap: FieldEncryptionMap }>,
  ): ReEncryptionResult[] {
    const results: ReEncryptionResult[] = [];
    for (const item of items) {
      try {
        const { result } = this.reEncryptFieldMap(item.fieldMap, item.entityId);
        results.push(result);
      } catch (err) {
        results.push({
          entityId: item.entityId,
          success: false,
          oldKeyVersion: 0,
          newKeyVersion: 0,
          fieldsReEncrypted: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  // ─── Metadata ─────────────────────────────────────────────────────────────

  getEncryptionMetadata(entityId: string): EncryptionMetadata | null {
    return this.metadata.get(entityId) ?? null;
  }

  listEntitiesForKey(keyId: string): string[] {
    const entities: string[] = [];
    for (const [entityId, meta] of this.metadata.entries()) {
      if (meta.keyId === keyId) entities.push(entityId);
    }
    return entities;
  }

  getKeyRotationStatus(): {
    activeKey: { id: string; version: number; expiresAt: string | null } | null;
    totalKeys: number;
    entitiesNeedingRotation: number;
  } {
    const active = this.getActiveKey();
    let needsRotation = 0;
    if (active) {
      for (const meta of this.metadata.values()) {
        if (meta.keyId !== active.id) needsRotation++;
      }
    }
    return {
      activeKey: active ? { id: active.id, version: active.version, expiresAt: active.expiresAt } : null,
      totalKeys: this.keys.size,
      entitiesNeedingRotation: needsRotation,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] == null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getEncryptionAtRestService(): EncryptionAtRestService {
  if (!globalThis.__encryptionAtRestService__) {
    globalThis.__encryptionAtRestService__ = new EncryptionAtRestService();
  }
  return globalThis.__encryptionAtRestService__ as EncryptionAtRestService;
}
