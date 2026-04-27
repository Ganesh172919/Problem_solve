import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getMarketMaker } from '@/lib/autonomousMarketMaker';
import { getMarketMakerAgent } from '@/agents/marketMakerAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const poolId = searchParams.get('poolId');
  const action = searchParams.get('action');

  try {
    const amm = getMarketMaker();
    const agent = getMarketMakerAgent();

    if (poolId && action === 'stats') {
      const stats = amm.getPoolStats(poolId);
      const health = agent.getHealthReport(poolId);
      return NextResponse.json({ success: true, data: { stats, health } });
    }

    if (poolId && action === 'depth') {
      const depth = amm.getMarketDepth(poolId);
      return NextResponse.json({ success: true, data: { depth } });
    }

    if (poolId && action === 'history') {
      const limit = parseInt(searchParams.get('limit') ?? '50', 10);
      const history = amm.getSwapHistory(poolId, limit);
      return NextResponse.json({ success: true, data: { history } });
    }

    const pools = amm.listPools();
    const agentStats = agent.getStats();
    const healthReports = agent.getHealthReports();

    return NextResponse.json({ success: true, data: { pools, agentStats, healthReports } });
  } catch (err) {
    logger.error('Market GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const amm = getMarketMaker();

    if (action === 'create_pool') {
      const pool = amm.createPool(body.pool as Parameters<typeof amm.createPool>[0]);
      return NextResponse.json({ success: true, data: { pool } });
    }

    if (action === 'add_liquidity') {
      const { poolId, providerId, amountA, amountB } = body as { poolId: string; providerId: string; amountA: number; amountB: number };
      const position = amm.addLiquidity(poolId, providerId, amountA, amountB);
      return NextResponse.json({ success: true, data: { position } });
    }

    if (action === 'remove_liquidity') {
      const { positionId } = body as { positionId: string };
      const amounts = amm.removeLiquidity(positionId);
      return NextResponse.json({ success: true, data: { amounts } });
    }

    if (action === 'get_quote') {
      const { poolId, inputToken, inputAmount, slippageTolerance } = body as { poolId: string; inputToken: string; inputAmount: number; slippageTolerance?: number };
      const quote = amm.getQuote(poolId, inputToken, inputAmount, slippageTolerance);
      return NextResponse.json({ success: true, data: { quote } });
    }

    if (action === 'execute_swap') {
      const { poolId, inputToken, inputAmount } = body as { poolId: string; inputToken: string; inputAmount: number };
      const result = amm.executeSwap(poolId, inputToken, inputAmount);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'impermanent_loss') {
      const { positionId, currentPriceAInB } = body as { positionId: string; currentPriceAInB: number };
      const report = amm.calculateImpermanentLoss(positionId, currentPriceAInB);
      return NextResponse.json({ success: true, data: { report } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Market POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
