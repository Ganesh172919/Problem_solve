import { NextRequest, NextResponse } from 'next/server';
import { getIntelligentContentSynthesizer } from '../../../../lib/intelligentContentSynthesizer';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') ?? 'summary';
    const engine = getIntelligentContentSynthesizer();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: engine.getSummary() });
    }
    if (action === 'cluster_topics') {
      const topicsParam = searchParams.get('topics');
      if (!topicsParam) return NextResponse.json({ error: 'topics (JSON array) is required' }, { status: 400 });
      const topics = JSON.parse(topicsParam) as Array<{ label: string; keywords: string[] }>;
      return NextResponse.json({ success: true, data: engine.clusterTopics(topics) });
    }
    if (action === 'quality') {
      const contentParam = searchParams.get('content');
      if (!contentParam) return NextResponse.json({ error: 'content (JSON) is required' }, { status: 400 });
      const content = JSON.parse(contentParam);
      return NextResponse.json({ success: true, data: engine.scoreQuality(content) });
    }
    if (action === 'seo') {
      const title = searchParams.get('title') ?? '';
      const bodyText = searchParams.get('body') ?? '';
      const keywords = searchParams.get('keywords')?.split(',') ?? [];
      return NextResponse.json({ success: true, data: engine.optimizeSEO(title, bodyText, keywords) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const engine = getIntelligentContentSynthesizer();

    if (action === 'create_template') {
      if (!body.template) return NextResponse.json({ error: 'template is required' }, { status: 400 });
      engine.createTemplate(body.template);
      return NextResponse.json({ success: true });
    }
    if (action === 'synthesize') {
      const { templateId, clusterId, variables, personalizationContext } = body.request ?? body;
      if (!templateId || !clusterId || !variables) {
        return NextResponse.json({ error: 'templateId, clusterId, and variables are required' }, { status: 400 });
      }
      return NextResponse.json({ success: true, data: engine.synthesizeContent(templateId, clusterId, variables, personalizationContext) });
    }
    if (action === 'detect_duplicate') {
      const hash = body.similarityHash ?? body.contentId;
      if (!hash) return NextResponse.json({ error: 'similarityHash is required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.detectDuplicate(hash) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
