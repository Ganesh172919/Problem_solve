#!/usr/bin/env node
/**
 * Dev-only helper: insert an API key into the local SQLite DB.
 *
 * This exists to bootstrap local testing of `/api/v1/*` endpoints. There is
 * currently no "first API key" creation flow via HTTP because creating keys
 * requires an existing key.
 *
 * Usage:
 *   node scripts/dev-mint-api-key.mjs --email dev@example.com --name "local-dev" --scopes read,generate
 *   node scripts/dev-mint-api-key.mjs --username dev --name "local-dev" --expiresAt 2030-01-01T00:00:00.000Z
 */

import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function usageAndExit(message, code = 1) {
  const msg = message ? `\nError: ${message}\n` : '';
  process.stderr.write(
    `${msg}
Usage:
  node scripts/dev-mint-api-key.mjs --email <email> --name <name> [--scopes read,generate] [--expiresAt <iso>]
  node scripts/dev-mint-api-key.mjs --username <username> --name <name> [--scopes read] [--expiresAt <iso>]

Notes:
  - This script modifies your local SQLite DB at ai-auto-news/data/blog.db.
  - Create a user first via POST /api/users while the server is running.
  - The generated raw key is printed once; store it securely.
`
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function parseScopes(value) {
  if (!value) return ['read'];
  const scopes = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : ['read'];
}

function generateRawKey() {
  // Matches src/db/apiKeys.ts expectations: "aian_" + 64 hex chars.
  return `aian_${crypto.randomBytes(32).toString('hex')}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureTablesExist(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','api_keys')")
    .all();
  const names = new Set(row.map((r) => r.name));
  if (!names.has('users') || !names.has('api_keys')) {
    usageAndExit(
      'Missing required tables (users/api_keys). Start the app once to initialize the database.',
      2,
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : null;
  const username = typeof args.username === 'string' ? args.username.trim() : null;
  const name = typeof args.name === 'string' ? args.name.trim() : null;
  const expiresAt = typeof args.expiresAt === 'string' ? args.expiresAt.trim() : null;

  if (!name) usageAndExit('Missing --name');
  if ((!email && !username) || (email && username)) {
    usageAndExit('Provide exactly one of --email or --username');
  }

  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) usageAndExit('--expiresAt must be a valid ISO timestamp');
  }

  const scopes = parseScopes(args.scopes);

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const dbPath = path.join(repoRoot, 'data', 'blog.db');

  const db = new Database(dbPath);
  ensureTablesExist(db);

  const user =
    email
      ? db.prepare('SELECT id, email, username, tier FROM users WHERE email = ?').get(email)
      : db.prepare('SELECT id, email, username, tier FROM users WHERE username = ?').get(username);

  if (!user) {
    usageAndExit(
      `User not found (${email ? `email=${email}` : `username=${username}`}). Create one via POST /api/users.`,
      3,
    );
  }

  const rawKey = generateRawKey();
  const keyHash = sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO api_keys (id, userId, name, keyHash, keyPrefix, scopes, callCount, lastUsedAt, expiresAt, isActive, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, 1, ?)
  `).run(
    id,
    user.id,
    name,
    keyHash,
    keyPrefix,
    JSON.stringify(scopes),
    expiresAt || null,
    now,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        rawKey,
        apiKey: {
          id,
          userId: user.id,
          name,
          keyPrefix,
          scopes,
          expiresAt: expiresAt || null,
          createdAt: now,
        },
        user: { id: user.id, email: user.email, username: user.username, tier: user.tier },
      },
      null,
      2,
    )}\n`,
  );
}

main();

