import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail, getUserByUsername, listUsers } from '@/db/users';
import { createSubscription } from '@/db/subscriptions';
import { verifyToken } from '@/lib/auth';
import { validateEmail, validateUsername, validatePassword, ValidationError } from '@/lib/validation';
import { trackAnalyticsEvent } from '@/db/analytics';

// POST /api/users — Register a new user
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    let email: string;
    let username: string;
    let password: string;

    try {
      email = validateEmail(body.email);
      username = validateUsername(body.username);
      password = validatePassword(body.password);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
      }
      throw e;
    }

    // Check for existing email or username
    if (getUserByEmail(email)) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    if (getUserByUsername(username)) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = createUser({ email, username, passwordHash, tier: 'free' });

    // Automatically create a free subscription
    createSubscription(user.id, 'free');

    trackAnalyticsEvent({
      userId: user.id,
      sessionId: null,
      eventName: 'user.registered',
      properties: { tier: 'free' },
      ipAddress: request.headers.get('x-forwarded-for') || null,
      userAgent: request.headers.get('user-agent') || null,
    });

    // Return user without passwordHash
    const { passwordHash: _ph, ...safeUser } = user;
    return NextResponse.json({ user: safeUser }, { status: 201 });
  } catch (error) {
    console.error('Error in users POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/users — List users (admin only)
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    const result = listUsers(page, limit);
    const safeUsers = result.users.map(({ passwordHash: _ph, ...u }) => u);

    return NextResponse.json({
      users: safeUsers,
      total: result.total,
      page,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (error) {
    console.error('Error in users GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
