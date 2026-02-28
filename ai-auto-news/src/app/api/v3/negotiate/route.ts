import { NextRequest, NextResponse } from 'next/server';
import { getNegotiationEngine } from '../../../../lib/multiAgentNegotiationEngine';

const engine = getNegotiationEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const agentId = searchParams.get('agentId');

  try {
    if (action === 'summary') return NextResponse.json(engine.getDashboardSummary());
    if (action === 'agents') return NextResponse.json(engine.listAgents(agentId as Parameters<typeof engine.listAgents>[0] ?? undefined));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'register_agent') {
      const agent = engine.registerAgent(body as Parameters<typeof engine.registerAgent>[0]);
      return NextResponse.json(agent, { status: 201 });
    }
    if (action === 'create_auction') {
      const auction = engine.createAuction(body as Parameters<typeof engine.createAuction>[0]);
      return NextResponse.json(auction, { status: 201 });
    }
    if (action === 'bid') {
      const { auctionId, bidderId, amount, metadata } = body as { auctionId: string; bidderId: string; amount: number; metadata?: Record<string, unknown> };
      const bid = engine.submitBid(auctionId, bidderId, amount, metadata);
      return NextResponse.json(bid);
    }
    if (action === 'close_auction') {
      const { auctionId } = body as { auctionId: string };
      const auction = engine.closeAuction(auctionId);
      return NextResponse.json(auction);
    }
    if (action === 'start_negotiation') {
      const neg = engine.startNegotiation(body as Parameters<typeof engine.startNegotiation>[0]);
      return NextResponse.json(neg, { status: 201 });
    }
    if (action === 'auto_negotiate') {
      const { negotiationId } = body as { negotiationId: string };
      const result = engine.autoNegotiate(negotiationId);
      return NextResponse.json(result);
    }
    if (action === 'shapley') {
      const { gameId } = body as { gameId: string };
      const shapley = engine.computeShapleyValues(gameId);
      return NextResponse.json(shapley);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
