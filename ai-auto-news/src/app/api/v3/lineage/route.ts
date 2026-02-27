import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getDataLineageTracker } from '@/lib/dataLineageTracker';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const assetId = searchParams.get('assetId');
  const direction = (searchParams.get('direction') ?? 'downstream') as 'upstream' | 'downstream' | 'both';
  const depth = Math.min(parseInt(searchParams.get('depth') ?? '3', 10), 10);
  const action = searchParams.get('action') ?? 'query';

  if (!assetId && action !== 'stats') {
    return NextResponse.json({ error: 'assetId is required' }, { status: 400 });
  }

  try {
    const tracker = getDataLineageTracker();

    switch (action) {
      case 'query': {
        const nodes = tracker.queryLineage(assetId!, direction, depth);
        logger.info('Lineage queried', { assetId, direction, depth, nodes: nodes.length });
        return NextResponse.json({ success: true, data: { assetId, direction, depth, nodes } });
      }
      case 'impact': {
        const impact = tracker.computeImpact(assetId!);
        return NextResponse.json({ success: true, data: impact });
      }
      case 'graph': {
        const graph = tracker.generateLineageGraph(assetId!);
        return NextResponse.json({ success: true, data: graph });
      }
      case 'provenance': {
        const provenance = tracker.validateProvenance(assetId!);
        return NextResponse.json({ success: true, data: provenance });
      }
      case 'stats': {
        const stats = tracker.getLineageStats();
        return NextResponse.json({ success: true, data: stats });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Lineage query failed', { assetId, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    action?: string;
    source?: string | string[];
    target?: string | string[];
    transformation?: import('@/lib/dataLineageTracker').TransformationRecord;
    asset?: import('@/lib/dataLineageTracker').DataAsset;
    tenantId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const tracker = getDataLineageTracker();
    const action = body.action ?? 'record_transformation';

    switch (action) {
      case 'record_transformation': {
        const { source, target, transformation } = body;
        if (!source || !target || !transformation) {
          return NextResponse.json(
            { error: 'source, target, and transformation are required' },
            { status: 400 }
          );
        }
        const edges = tracker.recordTransformation(source, target, transformation);
        logger.info('Lineage transformation recorded', {
          source,
          target,
          transformationId: transformation.id,
          edges: edges.length,
        });
        return NextResponse.json({ success: true, data: { edges } });
      }
      case 'register_asset': {
        const { asset } = body;
        if (!asset) {
          return NextResponse.json({ error: 'asset is required' }, { status: 400 });
        }
        tracker.registerAsset(asset);
        logger.info('Data asset registered', { assetId: asset.id, name: asset.name });
        return NextResponse.json({ success: true, data: { assetId: asset.id } });
      }
      case 'export': {
        const format = (body as { format?: 'json' | 'dot' | 'mermaid' }).format ?? 'json';
        const exported = tracker.exportLineage(format);
        return NextResponse.json({ success: true, data: { format, content: exported } });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    logger.error('Lineage POST failed', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
