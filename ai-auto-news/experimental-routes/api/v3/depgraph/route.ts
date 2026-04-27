import { NextRequest, NextResponse } from 'next/server';
import { getDependencyGraph } from '../../../../lib/intelligentDependencyGraph';
import type { ServiceNode, DependencyEdge } from '../../../../lib/intelligentDependencyGraph';

const graph = getDependencyGraph();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const nodeId = searchParams.get('nodeId') ?? undefined;
  const sourceId = searchParams.get('sourceId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(graph.getSummary());
    if (action === 'nodes') {
      const tier = searchParams.get('tier') as ServiceNode['tier'] | null;
      return NextResponse.json(graph.listNodes(tier ?? undefined));
    }
    if (action === 'node' && nodeId) {
      const n = graph.getNode(nodeId);
      if (!n) return NextResponse.json({ error: 'Node not found' }, { status: 404 });
      return NextResponse.json(n);
    }
    if (action === 'edges') {
      return NextResponse.json(graph.listEdges(sourceId));
    }
    if (action === 'impact' && nodeId) {
      return NextResponse.json(graph.analyzeImpact(nodeId));
    }
    if (action === 'critical_paths') {
      return NextResponse.json(graph.findCriticalPaths());
    }
    if (action === 'cycles') {
      return NextResponse.json(graph.detectCircularDependencies());
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'register_node') {
      graph.registerNode(body.node as ServiceNode);
      return NextResponse.json({ success: true });
    }
    if (action === 'update_health') {
      const ok = graph.updateNodeHealth(
        body.nodeId as string,
        body.healthState as ServiceNode['healthState'],
        body.healthScore as number,
        body.currentSlo as number
      );
      return NextResponse.json({ success: ok });
    }
    if (action === 'add_edge') {
      graph.addEdge(body.edge as DependencyEdge);
      return NextResponse.json({ success: true });
    }
    if (action === 'remove_edge') {
      const ok = graph.removeEdge(body.edgeId as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'deprecate_edge') {
      const ok = graph.deprecateEdge(body.edgeId as string, body.deprecationDate as number);
      return NextResponse.json({ success: ok });
    }
    if (action === 'analyze_impact') {
      const impact = graph.analyzeImpact(body.nodeId as string);
      return NextResponse.json({ impact });
    }
    if (action === 'find_critical_paths') {
      const paths = graph.findCriticalPaths();
      return NextResponse.json({ paths });
    }
    if (action === 'detect_cycles') {
      const cycles = graph.detectCircularDependencies();
      return NextResponse.json({ cycles, count: cycles.length });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
