import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (!process.env.JWT_SECRET) {
  console.warn('[Auth] WARNING: JWT_SECRET not set. Using default secret — not safe for production.');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.warn('[Auth] WARNING: Admin credentials not set. Using defaults — change in .env for production.');
}

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
