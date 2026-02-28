import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  AutonomousMarketMaker,
  getMarketMaker,
  LiquidityPool,
} from '../../../src/lib/autonomousMarketMaker';

function makePool(overrides: Partial<Omit<LiquidityPool, 'id' | 'totalLpTokens' | 'createdAt'>> = {}): Omit<LiquidityPool, 'id' | 'totalLpTokens' | 'createdAt'> {
  return {
    tokenA: 'USDC',
    tokenB: 'ETH',
    reserveA: 100_000,
    reserveB: 50,
    feeModel: 'flat',
    baseFeePercent: 0.3,
    status: 'active',
    metadata: {},
    ...overrides,
  };
}

describe('AutonomousMarketMaker', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__autonomousMarketMaker__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getMarketMaker();
    const b = getMarketMaker();
    expect(a).toBe(b);
  });

  it('creates a pool and retrieves it', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool());
    expect(pool.id).toBeTruthy();
    expect(amm.getPool(pool.id)).toBe(pool);
  });

  it('computes initial LP tokens as sqrt(reserveA * reserveB)', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool({ reserveA: 100, reserveB: 100 }));
    expect(pool.totalLpTokens).toBeCloseTo(100, 2);
  });

  it('addLiquidity increases reserves and returns position', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool());
    const prevReserveA = pool.reserveA;
    const position = amm.addLiquidity(pool.id, 'provider1', 1000, 0.5);
    expect(pool.reserveA).toBeGreaterThan(prevReserveA);
    expect(position.providerId).toBe('provider1');
    expect(position.lpTokens).toBeGreaterThan(0);
  });

  it('executeSwap returns correct output and updates reserves', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool());
    const prevReserveA = pool.reserveA;
    const result = amm.executeSwap(pool.id, 'USDC', 1000);
    expect(result.outputAmount).toBeGreaterThan(0);
    expect(result.feeAmount).toBeGreaterThan(0);
    expect(pool.reserveA).toBeGreaterThan(prevReserveA);
    expect(pool.reserveB).toBeLessThan(50);
  });

  it('getQuote respects max price impact config', () => {
    const amm = new AutonomousMarketMaker({ maxPriceImpactPercent: 1 });
    const pool = amm.createPool(makePool({ reserveA: 1_000, reserveB: 500 }));
    // Large swap relative to reserves will cause high price impact warning
    const quote = amm.getQuote(pool.id, 'USDC', 900);
    expect(quote.priceImpactPercent).toBeGreaterThan(1);
    expect(quote.outputAmount).toBeGreaterThan(0);
  });

  it('calculateImpermanentLoss returns report with valid fields', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool({ reserveA: 1000, reserveB: 500 }));
    const position = amm.addLiquidity(pool.id, 'p1', 100, 50);
    const report = amm.calculateImpermanentLoss(position.positionId, 2.2);
    expect(typeof report.ilPercent).toBe('number');
    expect(typeof report.netPnlUSD).toBe('number');
    expect(report.positionId).toBe(position.positionId);
  });

  it('getMarketDepth returns bids and asks', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool());
    const depth = amm.getMarketDepth(pool.id, 5);
    expect(depth.bids).toHaveLength(5);
    expect(depth.asks).toHaveLength(5);
    expect(depth.midPrice).toBeGreaterThan(0);
  });

  it('paused pool rejects swaps', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool());
    amm.pausePool(pool.id);
    expect(() => amm.executeSwap(pool.id, 'USDC', 100)).toThrow();
  });

  it('removeLiquidity releases funds back', () => {
    const amm = new AutonomousMarketMaker();
    const pool = amm.createPool(makePool({ reserveA: 10_000, reserveB: 5_000 }));
    const position = amm.addLiquidity(pool.id, 'provider2', 1000, 500);
    const amounts = amm.removeLiquidity(position.positionId);
    expect(amounts.amountA).toBeGreaterThan(0);
    expect(amounts.amountB).toBeGreaterThan(0);
  });
});
