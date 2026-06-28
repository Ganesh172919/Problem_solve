import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { autonomousPublisher } from '@/agents/autonomousPublisher';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await autonomousPublisher();
    return NextResponse.json(result);
  } catch (error) {
    logger.error('Error generating content', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Failed to generate content' }, { status: 500 });
  }
}
