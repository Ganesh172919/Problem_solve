import { NextRequest, NextResponse } from 'next/server';
import { getSearchEngine } from '../../../../lib/multiModalSearchEngine';

const engine = getSearchEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const indexId = searchParams.get('indexId') ?? undefined;
  const documentId = searchParams.get('documentId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(engine.getSummary());
    if (action === 'indexes') return NextResponse.json(engine.listIndexes(tenantId));
    if (action === 'index' && indexId) {
      const i = engine.getIndex(indexId);
      if (!i) return NextResponse.json({ error: 'Index not found' }, { status: 404 });
      return NextResponse.json(i);
    }
    if (action === 'document' && indexId && documentId) {
      const d = engine.getDocument(indexId, documentId);
      if (!d) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      return NextResponse.json(d);
    }
    if (action === 'analytics' && indexId) {
      return NextResponse.json(engine.getAnalytics(indexId));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'create_index') {
      return NextResponse.json(engine.createIndex(body as Parameters<typeof engine.createIndex>[0]), { status: 201 });
    }
    if (action === 'delete_index') {
      const { indexId } = body as { indexId: string };
      engine.deleteIndex(indexId);
      return NextResponse.json({ deleted: true });
    }
    if (action === 'index_document') {
      return NextResponse.json(engine.indexDocument(body as Parameters<typeof engine.indexDocument>[0]), { status: 201 });
    }
    if (action === 'bulk_index') {
      const { indexId, docs } = body as { indexId: string; docs: Parameters<typeof engine.indexDocument>[0][] };
      const count = engine.bulkIndex(indexId, docs);
      return NextResponse.json({ indexed: count });
    }
    if (action === 'delete_document') {
      const { indexId, documentId } = body as { indexId: string; documentId: string };
      engine.deleteDocument(indexId, documentId);
      return NextResponse.json({ deleted: true });
    }
    if (action === 'search') {
      const result = engine.search(body as Parameters<typeof engine.search>[0]);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
