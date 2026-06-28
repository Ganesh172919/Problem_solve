// ─────────────────────────────────────────────────────────────────────────────
// /api/preferences — GET/POST user preferences for the onboarding quiz.
// Preferences are stored per session cookie (30-day expiry).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import getDb from '@/db/index';

const COOKIE_NAME = 'tp_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * GET /api/preferences — returns current user preferences from session cookie.
 */
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json({ onboarding_done: 0 });
  }

  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT topics, tone, frequency, onboarding_done FROM user_preferences WHERE session_token = ?`
    ).get(sessionToken) as Record<string, unknown> | undefined;

    if (!row) {
      return NextResponse.json({ onboarding_done: 0 });
    }

    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ onboarding_done: 0 });
  }
}

/**
 * POST /api/preferences — saves user preferences and sets session cookie.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const topics = String(body.topics || '[]');
  const tone = String(body.tone || 'balanced');
  const frequency = String(body.frequency || 'daily');
  const skipped = body.skipped === true;

  // Get or create session token
  let sessionToken = request.cookies.get(COOKIE_NAME)?.value;
  if (!sessionToken) {
    sessionToken = uuidv4();
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO user_preferences (id, session_token, topics, tone, frequency, onboarding_done, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_token) DO UPDATE SET
        topics = excluded.topics,
        tone = excluded.tone,
        frequency = excluded.frequency,
        onboarding_done = excluded.onboarding_done,
        updated_at = excluded.updated_at
    `).run(
      id,
      sessionToken,
      topics,
      tone,
      frequency,
      skipped ? 2 : 1,
      now,
      now,
    );
  } catch (err) {
    console.error('[API/preferences] DB error:', err);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, sessionToken, {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  return response;
}
