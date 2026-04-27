import { NextRequest, NextResponse } from 'next/server';
import { getTokenomicsEngine } from '../../../../lib/tokenomicsEngine';

const engine = getTokenomicsEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const holderId = searchParams.get('holderId');

  try {
    if (action === 'summary') return NextResponse.json(engine.getDashboardSummary());
    if (action === 'health') return NextResponse.json(engine.computeEconomicHealth());
    if (action === 'treasury') return NextResponse.json(engine.getTreasury());
    if (action === 'transactions') return NextResponse.json(engine.getTransactionHistory(holderId ?? undefined));
    if (action === 'holder' && holderId) {
      const holder = engine.getHolder(holderId);
      if (!holder) return NextResponse.json({ error: 'Holder not found' }, { status: 404 });
      return NextResponse.json(holder);
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

    if (action === 'register') {
      const holder = engine.registerHolder(body as Parameters<typeof engine.registerHolder>[0]);
      return NextResponse.json(holder, { status: 201 });
    }
    if (action === 'transfer') {
      const { fromHolderId, toHolderId, amount } = body as { fromHolderId: string; toHolderId: string; amount: number };
      const tx = engine.transfer(fromHolderId, toHolderId, amount);
      return NextResponse.json(tx);
    }
    if (action === 'mint') {
      const { toHolderId, amount, reason } = body as { toHolderId: string; amount: number; reason?: string };
      const tx = engine.mint(toHolderId, amount, reason);
      return NextResponse.json(tx);
    }
    if (action === 'burn') {
      const { fromHolderId, amount } = body as { fromHolderId: string; amount: number };
      const tx = engine.burn(fromHolderId, amount);
      return NextResponse.json(tx);
    }
    if (action === 'stake') {
      const { holderId, amount, tier } = body as { holderId: string; amount: number; tier: Parameters<typeof engine.stake>[2] };
      const position = engine.stake(holderId, amount, tier);
      return NextResponse.json(position, { status: 201 });
    }
    if (action === 'unstake') {
      const { positionId } = body as { positionId: string };
      const result = engine.unstake(positionId);
      return NextResponse.json(result);
    }
    if (action === 'vote') {
      const { proposalId, holderId, vote } = body as { proposalId: string; holderId: string; vote: 'for' | 'against' | 'abstain' };
      engine.castVote(proposalId, holderId, vote);
      return NextResponse.json({ ok: true });
    }
    if (action === 'create_proposal') {
      const proposal = engine.createProposal(body as Parameters<typeof engine.createProposal>[0]);
      return NextResponse.json(proposal, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
