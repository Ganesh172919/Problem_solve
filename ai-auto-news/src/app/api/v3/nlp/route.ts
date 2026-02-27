import { NextRequest, NextResponse } from 'next/server';
import { getNLPPipelineEngine } from '@/lib/nlpPipelineEngine';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const nlp = getNLPPipelineEngine();

  const { action } = body;

  try {
    switch (action) {
      case 'process': {
        if (!body.id || !body.content) {
          return NextResponse.json({ error: 'id and content are required' }, { status: 400 });
        }
        const doc = nlp.process(body.id, body.content, body.metadata ?? {});
        return NextResponse.json({ success: true, data: doc });
      }
      case 'batch': {
        if (!Array.isArray(body.documents)) {
          return NextResponse.json({ error: 'documents array is required' }, { status: 400 });
        }
        const result = nlp.processBatch(body.documents);
        return NextResponse.json({ success: true, data: result });
      }
      case 'similarity': {
        const result = nlp.computeSimilarity(body.idA, body.idB);
        return NextResponse.json({ success: true, data: result });
      }
      case 'metrics': {
        const metrics = nlp.computeTextMetrics(body.id);
        return NextResponse.json({ success: true, data: metrics });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const action = searchParams.get('action') ?? 'get';

  const nlp = getNLPPipelineEngine();

  try {
    switch (action) {
      case 'get': {
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const doc = nlp.getDocument(id);
        if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        return NextResponse.json({ success: true, data: doc });
      }
      case 'search_sentiment': {
        const label = searchParams.get('label') as 'positive' | 'negative' | 'neutral' | 'mixed';
        const minConf = parseFloat(searchParams.get('min_confidence') ?? '0.5');
        const docs = nlp.searchBySentiment(label, minConf);
        return NextResponse.json({ success: true, data: docs });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
