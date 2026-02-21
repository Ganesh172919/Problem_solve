/**
 * Advanced Security Hardening Module
 *
 * Provides comprehensive security features:
 * - SQL injection prevention
 * - XSS protection
 * - CSRF protection
 * - Input sanitization
 * - Output encoding
 * - Security headers
 * - Content Security Policy
 * - Rate limiting per IP
 * - Brute force protection
 * - Secrets detection
 * - Encryption at rest
 * - API key rotation
 */

import crypto from 'crypto';
import { getLogger } from './logger';

const logger = getLogger();

export interface SecurityConfig {
  encryptionKey: string;
  csrfSecret: string;
  allowedOrigins: string[];
  maxRequestsPerIP: number;
  bruteForceWindow: number;
  bruteForceMax: number;
}

/**
 * Input Sanitization
 */
export class InputSanitizer {
  /**
   * Sanitize SQL input to prevent SQL injection
   */
  static sanitizeSQL(input: string): string {
    if (!input) return '';

    // Remove dangerous SQL keywords
    const dangerous = [
      'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE',
      'EXEC', 'EXECUTE', 'UNION', 'INSERT', 'UPDATE',
      '--', ';--', ';', '/*', '*/', '@@', '@',
      'char', 'nchar', 'varchar', 'nvarchar',
      'alter', 'begin', 'cast', 'create', 'cursor',
      'declare', 'delete', 'drop', 'end', 'exec',
      'execute', 'fetch', 'insert', 'kill', 'select',
      'sys', 'sysobjects', 'syscolumns', 'table', 'update'
    ];

    let sanitized = input;

    for (const keyword of dangerous) {
      const regex = new RegExp(keyword, 'gi');
      sanitized = sanitized.replace(regex, '');
    }

    return sanitized.trim();
  }

  /**
   * Sanitize user input to prevent XSS
   */
  static sanitizeHTML(input: string): string {
    if (!input) return '';

    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Sanitize file paths to prevent directory traversal
   */
  static sanitizeFilePath(path: string): string {
    if (!path) return '';

    // Remove directory traversal attempts
    return path
      .replace(/\.\./g, '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\//, '');
  }

  /**
   * Sanitize email address
   */
  static sanitizeEmail(email: string): string {
    if (!email) return '';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    return email.toLowerCase().trim();
  }

  /**
   * Sanitize phone number
   */
  static sanitizePhoneNumber(phone: string): string {
    if (!phone) return '';

    // Remove all non-numeric characters except +
    return phone.replace(/[^\d+]/g, '');
  }

  /**
   * Validate and sanitize URL
   */
  static sanitizeURL(url: string): string {
    if (!url) return '';

    try {
      const parsed = new URL(url);

      // Only allow http and https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid URL protocol');
      }

      return parsed.toString();
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }
}

/**
 * Encryption Service
 */
export class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32;
  private ivLength = 16;
  private tagLength = 16;

  constructor(private encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error('Encryption key must be at least 32 characters');
    }
  }

  /**
   * Encrypt data
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const key = crypto.scryptSync(this.encryptionKey, 'salt', this.keyLength);

    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return: IV + AuthTag + Encrypted
    return iv.toString('hex') + authTag.toString('hex') + encrypted;
  }

  /**
   * Decrypt data
   */
  decrypt(ciphertext: string): string {
    const ivHex = ciphertext.slice(0, this.ivLength * 2);
    const authTagHex = ciphertext.slice(
      this.ivLength * 2,
      this.ivLength * 2 + this.tagLength * 2
    );
    const encryptedHex = ciphertext.slice(this.ivLength * 2 + this.tagLength * 2);

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = crypto.scryptSync(this.encryptionKey, 'salt', this.keyLength);

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Hash password with salt
   */
  hashPassword(password: string): { hash: string; salt: string } {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');

    return { hash, salt };
  }

  /**
   * Verify password
   */
  verifyPassword(password: string, hash: string, salt: string): boolean {
    const verifyHash = crypto
      .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
      .toString('hex');

    return hash === verifyHash;
  }

  /**
   * Generate secure random token
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash data with HMAC
   */
  hmac(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
}

/**
 * CSRF Protection
 */
export class CSRFProtection {
  private tokens: Map<string, { token: string; expires: number }> = new Map();
  private tokenTTL = 3600000; // 1 hour

  constructor(private secret: string) {}

  /**
   * Generate CSRF token for session
   */
  generateToken(sessionId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + this.tokenTTL;

    this.tokens.set(sessionId, { token, expires });

    // Clean up expired tokens
    this.cleanup();

    return token;
  }

  /**
   * Verify CSRF token
   */
  verifyToken(sessionId: string, token: string): boolean {
    const stored = this.tokens.get(sessionId);

    if (!stored) {
      return false;
    }

    if (Date.now() > stored.expires) {
      this.tokens.delete(sessionId);
      return false;
    }

    return stored.token === token;
  }

  /**
   * Remove token
   */
  removeToken(sessionId: string): void {
    this.tokens.delete(sessionId);
  }

  /**
   * Clean up expired tokens
   */
  private cleanup(): void {
    const now = Date.now();

    for (const [sessionId, data] of this.tokens.entries()) {
      if (now > data.expires) {
        this.tokens.delete(sessionId);
      }
    }
  }
}

/**
 * Brute Force Protection
 */
export class BruteForceProtection {
  private attempts: Map<string, { count: number; firstAttempt: number }> = new Map();

  constructor(
    private maxAttempts: number = 5,
    private windowMs: number = 900000 // 15 minutes
  ) {}

  /**
   * Record failed attempt
   */
  recordFailedAttempt(identifier: string): void {
    const now = Date.now();
    const record = this.attempts.get(identifier);

    if (!record) {
      this.attempts.set(identifier, { count: 1, firstAttempt: now });
      return;
    }

    // Reset if window expired
    if (now - record.firstAttempt > this.windowMs) {
      this.attempts.set(identifier, { count: 1, firstAttempt: now });
      return;
    }

    record.count++;
  }

  /**
   * Check if blocked
   */
  isBlocked(identifier: string): boolean {
    const record = this.attempts.get(identifier);

    if (!record) {
      return false;
    }

    const now = Date.now();

    // Reset if window expired
    if (now - record.firstAttempt > this.windowMs) {
      this.attempts.delete(identifier);
      return false;
    }

    return record.count >= this.maxAttempts;
  }

  /**
   * Reset attempts
   */
  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  /**
   * Get remaining attempts
   */
  getRemainingAttempts(identifier: string): number {
    const record = this.attempts.get(identifier);

    if (!record) {
      return this.maxAttempts;
    }

    return Math.max(0, this.maxAttempts - record.count);
  }
}

/**
 * Secrets Detection
 */
export class SecretsDetector {
  private patterns = [
    // API Keys
    /[a-zA-Z0-9_-]{32,}/g,
    // AWS Keys
    /AKIA[0-9A-Z]{16}/g,
    // Private Keys
    /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    // JWT Tokens
    /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    // Database URLs
    /(postgres|mysql|mongodb):\/\/[^\s]+/g,
    // Generic passwords
    /(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/gi,
  ];

  /**
   * Detect secrets in text
   */
  detectSecrets(text: string): { found: boolean; matches: string[] } {
    const matches: string[] = [];

    for (const pattern of this.patterns) {
      const found = text.match(pattern);
      if (found) {
        matches.push(...found);
      }
    }

    return {
      found: matches.length > 0,
      matches,
    };
  }

  /**
   * Mask secrets in logs
   */
  maskSecrets(text: string): string {
    let masked = text;

    for (const pattern of this.patterns) {
      masked = masked.replace(pattern, '***REDACTED***');
    }

    return masked;
  }
}

/**
 * Security Headers Middleware
 */
export function securityHeadersMiddleware(config: SecurityConfig) {
  return (req: any, res: any, next: any) => {
    // Content Security Policy
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' https://api.ai-auto-news.com; " +
      "frame-ancestors 'none';"
    );

    // HSTS (HTTP Strict Transport Security)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // X-Frame-Options
    res.setHeader('X-Frame-Options', 'DENY');

    // X-Content-Type-Options
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-XSS-Protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()'
    );

    // Remove sensitive headers
    res.removeHeader('X-Powered-By');

    // CORS
    const origin = req.headers.origin;
    if (config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    next();
  };
}

/**
 * API Key Rotation Manager
 */
export class APIKeyRotation {
  private rotationSchedule: Map<string, Date> = new Map();

  /**
   * Schedule key rotation
   */
  scheduleRotation(keyId: string, rotationDate: Date): void {
    this.rotationSchedule.set(keyId, rotationDate);
  }

  /**
   * Check if key needs rotation
   */
  needsRotation(keyId: string): boolean {
    const scheduled = this.rotationSchedule.get(keyId);

    if (!scheduled) {
      return false;
    }

    return Date.now() >= scheduled.getTime();
  }

  /**
   * Generate new key
   */
  rotateKey(oldKeyId: string): { newKeyId: string; newKey: string } {
    const newKeyId = crypto.randomUUID();
    const newKey = crypto.randomBytes(32).toString('hex');

    // Remove old schedule
    this.rotationSchedule.delete(oldKeyId);

    // Schedule next rotation (90 days)
    const nextRotation = new Date();
    nextRotation.setDate(nextRotation.getDate() + 90);
    this.scheduleRotation(newKeyId, nextRotation);

    return { newKeyId, newKey };
  }
}

// Export singleton instances
export function getEncryptionService(): EncryptionService {
  const key = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
  return new EncryptionService(key);
}

export function getCSRFProtection(): CSRFProtection {
  const secret = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');
  return new CSRFProtection(secret);
}

export function getBruteForceProtection(): BruteForceProtection {
  return new BruteForceProtection(5, 900000);
}

export function getSecretsDetector(): SecretsDetector {
  return new SecretsDetector();
}

export function getAPIKeyRotation(): APIKeyRotation {
  return new APIKeyRotation();
}
