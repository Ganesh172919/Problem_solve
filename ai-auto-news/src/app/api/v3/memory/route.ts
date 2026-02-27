import { NextRequest, NextResponse } from 'next/server';
import { getMemoryGraph } from '../../../../lib/contextualMemoryGraph';

const memoryGraph = getMemoryGraph();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const agentId = searchParams.get('agentId');

  try {
    if (action === 'summary') return NextResponse.json(memoryGraph.getDashboardSummary());
    if (action === 'agent_stats' && agentId) {
      return NextResponse.json(memoryGraph.getAgentMemoryStats(agentId));
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

    if (action === 'store') {
      const node = memoryGraph.store(body as Parameters<typeof memoryGraph.store>[0]);
      return NextResponse.json(node, { status: 201 });
    }
    if (action === 'recall') {
      const { agentId, query, strategy, limit } = body as { agentId: string; query: string; strategy?: Parameters<typeof memoryGraph.recall>[2]; limit?: number };
      const result = memoryGraph.recall(agentId, query, strategy, limit);
      return NextResponse.json(result);
    }
    if (action === 'consolidate') {
      const { agentId, trigger } = body as { agentId: string; trigger: Parameters<typeof memoryGraph.consolidate>[1] };
      const result = memoryGraph.consolidate(agentId, trigger);
      return NextResponse.json(result);
    }
    if (action === 'create_context') {
      const { agentId, sessionId } = body as { agentId: string; sessionId: string };
      const ctx = memoryGraph.createContext(agentId, sessionId);
      return NextResponse.json(ctx, { status: 201 });
    }
    if (action === 'add_message') {
      const { contextId, message } = body as { contextId: string; message: Parameters<typeof memoryGraph.addMessage>[1] };
      const msg = memoryGraph.addMessage(contextId, message);
      return NextResponse.json(msg);
    }
    if (action === 'create_palace') {
      const { agentId, name, rooms } = body as { agentId: string; name: string; rooms: string[] };
      const palace = memoryGraph.createMemoryPalace(agentId, name, rooms);
      return NextResponse.json(palace, { status: 201 });
    }
    if (action === 'recall_palace') {
      const { palaceId } = body as { palaceId: string };
      const memories = memoryGraph.recallFromPalace(palaceId);
      return NextResponse.json(memories);
    }
    if (action === 'resolve_contradiction') {
      const { contradictionId, resolution, keepNodeId } = body as { contradictionId: string; resolution: string; keepNodeId: string };
      memoryGraph.resolveContradiction(contradictionId, resolution, keepNodeId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
