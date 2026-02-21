import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { autonomousPublisher } from '@/agents/autonomousPublisher';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('admin_token')?.value;
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await autonomousPublisher();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error generating content:', error);
    return NextResponse.json({ error: 'Failed to generate content' }, { status: 500 });
  }
}
