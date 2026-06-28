import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const isProduction = process.env.NODE_ENV === 'production';

// In production, require all credentials to be explicitly set
if (isProduction) {
  if (!process.env.JWT_SECRET) {
    throw new Error('[Auth] FATAL: JWT_SECRET must be set in production. Refusing to start with default secret.');
  }
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new Error('[Auth] FATAL: ADMIN_USERNAME and ADMIN_PASSWORD must be set in production.');
  }
} else {
  if (!process.env.JWT_SECRET) {
    console.warn('[Auth] WARNING: JWT_SECRET not set. Using default secret — not safe for production.');
  }
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.warn('[Auth] WARNING: Admin credentials not set. Using defaults — change in .env.local for production.');
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

let hashedPassword: string | null = null;

function getHashedPassword(): string {
  if (!hashedPassword) {
    hashedPassword = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  }
  return hashedPassword;
}

export function verifyCredentials(username: string, password: string): boolean {
  if (username !== ADMIN_USERNAME) return false;
  return bcrypt.compareSync(password, getHashedPassword());
}

export function generateToken(): string {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
