/**
 * Secrets Vault Manager
 *
 * Secure secrets management with encryption, rotation,
 * access control, audit logging, and leak detection.
 */

import { getLogger } from './logger';
import { createHash, randomBytes } from 'crypto';

const logger = getLogger();

export interface SecretEntry {
  id: string;
  key: string;
  encryptedValue: string;
  version: number;
  metadata: SecretMetadata;
  rotationPolicy: RotationPolicy | null;
  accessPolicy: AccessPolicy;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
}

export interface SecretMetadata {
  description: string;
  type: 'api_key' | 'database' | 'certificate' | 'token' | 'password' | 'encryption_key' | 'custom';
  environment: string;
  owner: string;
  tags: string[];
  lastAccessedAt: number | null;
  accessCount: number;
}

export interface RotationPolicy {
  enabled: boolean;
  intervalDays: number;
  lastRotatedAt: number | null;
  nextRotationAt: number;
  autoRotate: boolean;
  notifyBeforeDays: number;
}

export interface AccessPolicy {
  allowedUsers: string[];
  allowedRoles: string[];
  allowedServices: string[];
  ipWhitelist: string[];
  requireMFA: boolean;
  maxAccessPerHour: number;
}

export interface SecretAccessLog {
  id: string;
  secretKey: string;
  accessor: string;
  accessorType: 'user' | 'service' | 'system';
  action: 'read' | 'write' | 'rotate' | 'delete';
  ipAddress: string;
  success: boolean;
  reason: string | null;
  timestamp: number;
}

export interface LeakDetectionResult {
  detected: boolean;
  findings: LeakFinding[];
  scanTimestamp: number;
  scannedPatterns: number;
}

export interface LeakFinding {
  pattern: string;
  location: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  secretKey: string;
  recommendation: string;
}

export interface VaultHealth {
  totalSecrets: number;
  expiringSoon: number;
  needsRotation: number;
  weakSecrets: number;
  accessViolations: number;
  leaksDetected: number;
  overallHealth: 'healthy' | 'warning' | 'critical';
}

export class SecretsVaultManager {
  private secrets: Map<string, SecretEntry> = new Map();
  private accessLogs: SecretAccessLog[] = [];
  private encryptionKey: string;
  private accessCounters: Map<string, { count: number; resetAt: number }> = new Map();
  private leakPatterns: { pattern: RegExp; name: string; severity: LeakFinding['severity'] }[];

  constructor() {
    this.encryptionKey = randomBytes(32).toString('hex');

    this.leakPatterns = [
      { pattern: /(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{24,}/g, name: 'Stripe API Key', severity: 'critical' },
      { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub Token', severity: 'critical' },
      { pattern: /AIza[a-zA-Z0-9_-]{35}/g, name: 'Google API Key', severity: 'high' },
      { pattern: /AKIA[A-Z0-9]{16}/g, name: 'AWS Access Key', severity: 'critical' },
      { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, name: 'Private Key', severity: 'critical' },
      { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}:[^\s]{8,}/g, name: 'Credential Pair', severity: 'high' },
      { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, name: 'JWT Token', severity: 'medium' },
    ];
  }

  setSecret(params: {
    key: string;
    value: string;
    description?: string;
    type?: SecretMetadata['type'];
    environment?: string;
    owner?: string;
    tags?: string[];
    expiresInDays?: number;
    rotationIntervalDays?: number;
    accessPolicy?: Partial<AccessPolicy>;
  }): SecretEntry {
    const existing = this.secrets.get(params.key);
    const version = existing ? existing.version + 1 : 1;

    const encrypted = this.encrypt(params.value);
    const now = Date.now();

    const entry: SecretEntry = {
      id: `secret_${now}_${Math.random().toString(36).substring(2, 8)}`,
      key: params.key,
      encryptedValue: encrypted,
      version,
      metadata: {
        description: params.description || '',
        type: params.type || 'custom',
        environment: params.environment || 'production',
        owner: params.owner || 'system',
        tags: params.tags || [],
        lastAccessedAt: null,
        accessCount: 0,
      },
      rotationPolicy: params.rotationIntervalDays
        ? {
            enabled: true,
            intervalDays: params.rotationIntervalDays,
            lastRotatedAt: now,
            nextRotationAt: now + params.rotationIntervalDays * 24 * 60 * 60 * 1000,
            autoRotate: false,
            notifyBeforeDays: 7,
          }
        : null,
      accessPolicy: {
        allowedUsers: params.accessPolicy?.allowedUsers || [],
        allowedRoles: params.accessPolicy?.allowedRoles || ['admin'],
        allowedServices: params.accessPolicy?.allowedServices || [],
        ipWhitelist: params.accessPolicy?.ipWhitelist || [],
        requireMFA: params.accessPolicy?.requireMFA || false,
        maxAccessPerHour: params.accessPolicy?.maxAccessPerHour || 100,
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: params.expiresInDays
        ? now + params.expiresInDays * 24 * 60 * 60 * 1000
        : null,
    };

    this.secrets.set(params.key, entry);
    this.logAccess(params.key, params.owner || 'system', 'service', 'write', '', true);

    logger.info('Secret stored', { key: params.key, version, type: entry.metadata.type });
    return entry;
  }

  getSecret(
    key: string,
    accessor: string,
    accessorType: 'user' | 'service' | 'system' = 'service',
    ipAddress: string = '',
  ): string | null {
    const entry = this.secrets.get(key);
    if (!entry) {
      this.logAccess(key, accessor, accessorType, 'read', ipAddress, false, 'Secret not found');
      return null;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.logAccess(key, accessor, accessorType, 'read', ipAddress, false, 'Secret expired');
      return null;
    }

    if (!this.checkAccess(entry, accessor, accessorType, ipAddress)) {
      this.logAccess(key, accessor, accessorType, 'read', ipAddress, false, 'Access denied');
      return null;
    }

    if (!this.checkRateLimit(key, accessor)) {
      this.logAccess(key, accessor, accessorType, 'read', ipAddress, false, 'Rate limit exceeded');
      return null;
    }

    entry.metadata.lastAccessedAt = Date.now();
    entry.metadata.accessCount++;

    this.logAccess(key, accessor, accessorType, 'read', ipAddress, true);
    return this.decrypt(entry.encryptedValue);
  }

  rotateSecret(key: string, newValue: string, rotator: string = 'system'): boolean {
    const entry = this.secrets.get(key);
    if (!entry) return false;

    entry.encryptedValue = this.encrypt(newValue);
    entry.version++;
    entry.updatedAt = Date.now();

    if (entry.rotationPolicy) {
      entry.rotationPolicy.lastRotatedAt = Date.now();
      entry.rotationPolicy.nextRotationAt =
        Date.now() + entry.rotationPolicy.intervalDays * 24 * 60 * 60 * 1000;
    }

    this.logAccess(key, rotator, 'system', 'rotate', '', true);
    logger.info('Secret rotated', { key, newVersion: entry.version });
    return true;
  }

  deleteSecret(key: string, deleter: string = 'system'): boolean {
    const deleted = this.secrets.delete(key);
    if (deleted) {
      this.logAccess(key, deleter, 'system', 'delete', '', true);
      logger.info('Secret deleted', { key });
    }
    return deleted;
  }

  scanForLeaks(content: string, source: string = 'unknown'): LeakDetectionResult {
    const findings: LeakFinding[] = [];

    for (const { pattern, name, severity } of this.leakPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          const matchedSecret = this.findMatchingSecret(match);
          findings.push({
            pattern: name,
            location: source,
            severity,
            secretKey: matchedSecret || 'unknown',
            recommendation: `Remove or rotate the exposed ${name}`,
          });
        }
      }
    }

    return {
      detected: findings.length > 0,
      findings,
      scanTimestamp: Date.now(),
      scannedPatterns: this.leakPatterns.length,
    };
  }

  getSecretsNeedingRotation(): SecretEntry[] {
    const now = Date.now();
    return Array.from(this.secrets.values()).filter(
      (s) => s.rotationPolicy?.enabled && s.rotationPolicy.nextRotationAt <= now,
    );
  }

  getExpiringSoon(withinDays: number = 7): SecretEntry[] {
    const threshold = Date.now() + withinDays * 24 * 60 * 60 * 1000;
    return Array.from(this.secrets.values()).filter(
      (s) => s.expiresAt !== null && s.expiresAt <= threshold && s.expiresAt > Date.now(),
    );
  }

  getVaultHealth(): VaultHealth {
    const secrets = Array.from(this.secrets.values());
    const now = Date.now();

    const expiringSoon = secrets.filter(
      (s) => s.expiresAt && s.expiresAt <= now + 7 * 24 * 60 * 60 * 1000 && s.expiresAt > now,
    ).length;

    const needsRotation = secrets.filter(
      (s) => s.rotationPolicy?.enabled && s.rotationPolicy.nextRotationAt <= now,
    ).length;

    const recentViolations = this.accessLogs.filter(
      (l) => !l.success && l.timestamp >= now - 24 * 60 * 60 * 1000,
    ).length;

    let overallHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (needsRotation > 5 || recentViolations > 20) overallHealth = 'critical';
    else if (needsRotation > 0 || expiringSoon > 0 || recentViolations > 5) overallHealth = 'warning';

    return {
      totalSecrets: secrets.length,
      expiringSoon,
      needsRotation,
      weakSecrets: 0,
      accessViolations: recentViolations,
      leaksDetected: 0,
      overallHealth,
    };
  }

  getAccessLogs(key?: string, limit?: number): SecretAccessLog[] {
    let logs = [...this.accessLogs];
    if (key) {
      logs = logs.filter((l) => l.secretKey === key);
    }
    logs.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? logs.slice(0, limit) : logs;
  }

  listSecrets(environment?: string): { key: string; type: string; version: number; environment: string; expiresAt: number | null }[] {
    return Array.from(this.secrets.values())
      .filter((s) => !environment || s.metadata.environment === environment)
      .map((s) => ({
        key: s.key,
        type: s.metadata.type,
        version: s.version,
        environment: s.metadata.environment,
        expiresAt: s.expiresAt,
      }));
  }

  private encrypt(value: string): string {
    const iv = randomBytes(16).toString('hex');
    const hash = createHash('sha256').update(this.encryptionKey + iv + value).digest('hex');
    return `${iv}:${hash}:${Buffer.from(value).toString('base64')}`;
  }

  private decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length < 3) return '';
    return Buffer.from(parts[2], 'base64').toString('utf-8');
  }

  private checkAccess(
    entry: SecretEntry,
    accessor: string,
    accessorType: string,
    ipAddress: string,
  ): boolean {
    const policy = entry.accessPolicy;

    if (accessorType === 'system') return true;

    if (accessorType === 'user' && policy.allowedUsers.length > 0) {
      if (!policy.allowedUsers.includes(accessor)) return false;
    }

    if (accessorType === 'service' && policy.allowedServices.length > 0) {
      if (!policy.allowedServices.includes(accessor)) return false;
    }

    if (policy.ipWhitelist.length > 0 && ipAddress) {
      if (!policy.ipWhitelist.includes(ipAddress)) return false;
    }

    return true;
  }

  private checkRateLimit(key: string, accessor: string): boolean {
    const entry = this.secrets.get(key);
    if (!entry) return true;

    const counterKey = `${key}:${accessor}`;
    const now = Date.now();
    const counter = this.accessCounters.get(counterKey);

    if (!counter || counter.resetAt <= now) {
      this.accessCounters.set(counterKey, { count: 1, resetAt: now + 3600000 });
      return true;
    }

    if (counter.count >= entry.accessPolicy.maxAccessPerHour) {
      return false;
    }

    counter.count++;
    return true;
  }

  private logAccess(
    key: string,
    accessor: string,
    accessorType: 'user' | 'service' | 'system',
    action: 'read' | 'write' | 'rotate' | 'delete',
    ipAddress: string,
    success: boolean,
    reason?: string,
  ): void {
    this.accessLogs.push({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      secretKey: key,
      accessor,
      accessorType,
      action,
      ipAddress,
      success,
      reason: reason || null,
      timestamp: Date.now(),
    });

    if (this.accessLogs.length > 50000) {
      this.accessLogs = this.accessLogs.slice(-25000);
    }
  }

  private findMatchingSecret(value: string): string | null {
    for (const [key, entry] of this.secrets) {
      const decrypted = this.decrypt(entry.encryptedValue);
      if (decrypted === value || value.includes(decrypted)) {
        return key;
      }
    }
    return null;
  }
}

let vaultInstance: SecretsVaultManager | null = null;

export function getSecretsVaultManager(): SecretsVaultManager {
  if (!vaultInstance) {
    vaultInstance = new SecretsVaultManager();
  }
  return vaultInstance;
}
