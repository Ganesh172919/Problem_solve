/**
 * @module autonomousMarketMaker
 * @description Autonomous market-making engine implementing constant-product AMM,
 * dynamic fee curves, liquidity provision tracking, impermanent-loss calculation,
 * slippage estimation, order-book depth analysis, and yield optimization for
 * platform token economy and internal credit marketplace.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderSide = 'buy' | 'sell';
export type PoolStatus = 'active' | 'paused' | 'deprecated';
export type FeeModel = 'flat' | 'dynamic' | 'tiered' | 'zero';

export interface LiquidityPool {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  totalLpTokens: number;
  feeModel: FeeModel;
  baseFeePercent: number;   // e.g. 0.3
  status: PoolStatus;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface LiquidityPosition {
  positionId: string;
  poolId: string;
  providerId: string;
  lpTokens: number;
  entryReserveA: number;
  entryReserveB: number;
  entryPriceAInB: number;
  addedAt: number;
  feesEarnedA: number;
  feesEarnedB: number;
}

export interface SwapQuote {
  poolId: string;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  effectivePrice: number;
  priceImpactPercent: number;
  feeAmount: number;
  slippageTolerance: number;
  executionPath: string[];
  validUntil: number;
}

export interface SwapResult {
  quoteId: string;
  poolId: string;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  feeAmount: number;
  newReserveA: number;
  newReserveB: number;
  priceImpactPercent: number;
  executedAt: number;
  txId: string;
}

export interface ImpermanentLossReport {
  positionId: string;
  currentValueUSD: number;
  hodlValueUSD: number;
  ilPercent: number;
  feesEarnedUSD: number;
  netPnlUSD: number;
  breakEvenDays: number;
}

export interface MarketDepth {
  poolId: string;
  bids: Array<{ price: number; size: number; cumulative: number }>;
  asks: Array<{ price: number; size: number; cumulative: number }>;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  computedAt: number;
}

export interface AMMConfig {
  defaultSlippageTolerance?: number;
  maxPriceImpactPercent?: number;
  dynamicFeeMultiplierCap?: number;
  quoteValidityMs?: number;
  yieldReinvestThreshold?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function constantProductOut(reserveIn: number, reserveOut: number, amountIn: number, feePercent: number): number {
  const amountInWithFee = amountIn * (1 - feePercent / 100);
  return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
}

function computePriceImpact(reserveIn: number, amountIn: number): number {
  return (amountIn / (reserveIn + amountIn)) * 100;
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class AutonomousMarketMaker {
  private pools = new Map<string, LiquidityPool>();
  private positions = new Map<string, LiquidityPosition>();
  private swapHistory: SwapResult[] = [];
  private quotes = new Map<string, SwapQuote>();
  private config: Required<AMMConfig>;

  constructor(config: AMMConfig = {}) {
    this.config = {
      defaultSlippageTolerance: config.defaultSlippageTolerance ?? 0.5,
      maxPriceImpactPercent: config.maxPriceImpactPercent ?? 5,
      dynamicFeeMultiplierCap: config.dynamicFeeMultiplierCap ?? 3,
      quoteValidityMs: config.quoteValidityMs ?? 30_000,
      yieldReinvestThreshold: config.yieldReinvestThreshold ?? 10,
    };
  }

  // ── Pool Management ────────────────────────────────────────────────────────

  createPool(params: Omit<LiquidityPool, 'id' | 'totalLpTokens' | 'createdAt'>): LiquidityPool {
    const pool: LiquidityPool = {
      ...params,
      id: generateId('pool'),
      totalLpTokens: Math.sqrt(params.reserveA * params.reserveB),
      createdAt: Date.now(),
    };
    this.pools.set(pool.id, pool);
    logger.info('AMM pool created', { poolId: pool.id, tokenA: pool.tokenA, tokenB: pool.tokenB });
    return pool;
  }

  getPool(poolId: string): LiquidityPool | undefined {
    return this.pools.get(poolId);
  }

  listPools(statusFilter?: PoolStatus): LiquidityPool[] {
    const all = Array.from(this.pools.values());
    return statusFilter ? all.filter(p => p.status === statusFilter) : all;
  }

  pausePool(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (pool) { pool.status = 'paused'; }
  }

  activatePool(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (pool) { pool.status = 'active'; }
  }

  // ── Liquidity Operations ───────────────────────────────────────────────────

  addLiquidity(
    poolId: string,
    providerId: string,
    amountA: number,
    amountB: number,
  ): LiquidityPosition {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);
    if (pool.status !== 'active') throw new Error(`Pool ${poolId} is not active`);

    // Calculate LP tokens to mint (proportional to share of pool)
    const lpTokensToMint = Math.min(
      (amountA / pool.reserveA) * pool.totalLpTokens,
      (amountB / pool.reserveB) * pool.totalLpTokens,
    );

    pool.reserveA += amountA;
    pool.reserveB += amountB;
    pool.totalLpTokens += lpTokensToMint;

    const position: LiquidityPosition = {
      positionId: generateId('pos'),
      poolId,
      providerId,
      lpTokens: lpTokensToMint,
      entryReserveA: amountA,
      entryReserveB: amountB,
      entryPriceAInB: amountB / amountA,
      addedAt: Date.now(),
      feesEarnedA: 0,
      feesEarnedB: 0,
    };

    this.positions.set(position.positionId, position);
    logger.info('Liquidity added', { positionId: position.positionId, poolId, lpTokensMinted: lpTokensToMint });
    return position;
  }

  removeLiquidity(positionId: string): { amountA: number; amountB: number } {
    const position = this.positions.get(positionId);
    if (!position) throw new Error(`Position ${positionId} not found`);

    const pool = this.pools.get(position.poolId);
    if (!pool) throw new Error(`Pool ${position.poolId} not found`);

    const share = position.lpTokens / pool.totalLpTokens;
    const amountA = pool.reserveA * share + position.feesEarnedA;
    const amountB = pool.reserveB * share + position.feesEarnedB;

    pool.reserveA -= pool.reserveA * share;
    pool.reserveB -= pool.reserveB * share;
    pool.totalLpTokens -= position.lpTokens;

    this.positions.delete(positionId);
    logger.info('Liquidity removed', { positionId, amountA, amountB });
    return { amountA, amountB };
  }

  // ── Swap Operations ────────────────────────────────────────────────────────

  getQuote(
    poolId: string,
    inputToken: string,
    inputAmount: number,
    slippageTolerance?: number,
  ): SwapQuote {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);
    if (pool.status !== 'active') throw new Error(`Pool ${poolId} is not active`);

    const isAtoB = pool.tokenA === inputToken;
    if (!isAtoB && pool.tokenB !== inputToken) throw new Error(`Token ${inputToken} not in pool`);

    const reserveIn = isAtoB ? pool.reserveA : pool.reserveB;
    const reserveOut = isAtoB ? pool.reserveB : pool.reserveA;
    const outputToken = isAtoB ? pool.tokenB : pool.tokenA;

    const dynamicFee = this.computeDynamicFee(pool, reserveIn, inputAmount);
    const outputAmount = constantProductOut(reserveIn, reserveOut, inputAmount, dynamicFee);
    const feeAmount = inputAmount * (dynamicFee / 100);
    const priceImpact = computePriceImpact(reserveIn, inputAmount);
    const effectivePrice = outputAmount / inputAmount;

    const quote: SwapQuote = {
      poolId,
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      effectivePrice,
      priceImpactPercent: priceImpact,
      feeAmount,
      slippageTolerance: slippageTolerance ?? this.config.defaultSlippageTolerance,
      executionPath: [inputToken, outputToken],
      validUntil: Date.now() + this.config.quoteValidityMs,
    };

    const quoteId = generateId('quote');
    this.quotes.set(quoteId, quote);

    if (priceImpact > this.config.maxPriceImpactPercent) {
      logger.warn('High price impact on quote', { quoteId, priceImpact, maxAllowed: this.config.maxPriceImpactPercent });
    }

    return quote;
  }

  executeSwap(poolId: string, inputToken: string, inputAmount: number): SwapResult {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);
    if (pool.status !== 'active') throw new Error(`Pool ${poolId} is not active`);

    const isAtoB = pool.tokenA === inputToken;
    const reserveIn = isAtoB ? pool.reserveA : pool.reserveB;
    const reserveOut = isAtoB ? pool.reserveB : pool.reserveA;

    const dynamicFee = this.computeDynamicFee(pool, reserveIn, inputAmount);
    const outputAmount = constantProductOut(reserveIn, reserveOut, inputAmount, dynamicFee);
    const feeAmount = inputAmount * (dynamicFee / 100);
    const priceImpact = computePriceImpact(reserveIn, inputAmount);

    // Update reserves
    if (isAtoB) {
      pool.reserveA += inputAmount;
      pool.reserveB -= outputAmount;
    } else {
      pool.reserveB += inputAmount;
      pool.reserveA -= outputAmount;
    }

    // Distribute fees to LP positions proportionally
    this.distributeFeesToPositions(pool.id, isAtoB ? feeAmount : 0, isAtoB ? 0 : feeAmount);

    const result: SwapResult = {
      quoteId: generateId('qex'),
      poolId,
      inputToken,
      outputToken: isAtoB ? pool.tokenB : pool.tokenA,
      inputAmount,
      outputAmount,
      feeAmount,
      newReserveA: pool.reserveA,
      newReserveB: pool.reserveB,
      priceImpactPercent: priceImpact,
      executedAt: Date.now(),
      txId: generateId('tx'),
    };

    this.swapHistory.push(result);
    if (this.swapHistory.length > 10_000) this.swapHistory.shift();

    logger.info('Swap executed', { txId: result.txId, poolId, inputAmount, outputAmount, feeAmount });
    return result;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  calculateImpermanentLoss(positionId: string, currentPriceAInB: number): ImpermanentLossReport {
    const position = this.positions.get(positionId);
    if (!position) throw new Error(`Position ${positionId} not found`);

    const pool = this.pools.get(position.poolId);
    if (!pool) throw new Error(`Pool ${position.poolId} not found`);

    const initialPrice = position.entryPriceAInB;
    const priceRatio = currentPriceAInB / initialPrice;

    // IL formula: IL = 2*sqrt(r)/(1+r) - 1  where r = price ratio
    const sqrtRatio = Math.sqrt(priceRatio);
    const ilMultiplier = (2 * sqrtRatio) / (1 + priceRatio);
    const ilPercent = (1 - ilMultiplier) * 100;

    const share = position.lpTokens / pool.totalLpTokens;
    const currentValueA = pool.reserveA * share;
    const currentValueB = pool.reserveB * share;
    const currentValueUSD = currentValueA * currentPriceAInB + currentValueB;
    const hodlValueUSD = position.entryReserveA * currentPriceAInB + position.entryReserveB;

    const feesEarnedUSD = position.feesEarnedA * currentPriceAInB + position.feesEarnedB;
    const netPnlUSD = currentValueUSD + feesEarnedUSD - hodlValueUSD;

    const dailyFeeRate = feesEarnedUSD / Math.max(1, (Date.now() - position.addedAt) / 86_400_000);
    const breakEvenDays = dailyFeeRate > 0 ? (hodlValueUSD - currentValueUSD) / dailyFeeRate : Infinity;

    return {
      positionId,
      currentValueUSD,
      hodlValueUSD,
      ilPercent,
      feesEarnedUSD,
      netPnlUSD,
      breakEvenDays,
    };
  }

  getMarketDepth(poolId: string, levels = 10): MarketDepth {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);

    const midPrice = pool.reserveB / pool.reserveA;
    const bids: Array<{ price: number; size: number; cumulative: number }> = [];
    const asks: Array<{ price: number; size: number; cumulative: number }> = [];

    let cumBid = 0;
    let cumAsk = 0;

    for (let i = 1; i <= levels; i++) {
      const sizeFraction = 0.01 * i;
      const bidSize = pool.reserveA * sizeFraction;
      const askSize = pool.reserveB * sizeFraction;
      const bidOutput = constantProductOut(pool.reserveA, pool.reserveB, bidSize, pool.baseFeePercent);
      const bidPrice = bidOutput / bidSize;
      const askOutput = constantProductOut(pool.reserveB, pool.reserveA, askSize, pool.baseFeePercent);
      const askPrice = askSize / askOutput;

      cumBid += bidSize;
      cumAsk += askOutput;

      bids.push({ price: bidPrice, size: bidSize, cumulative: cumBid });
      asks.push({ price: askPrice, size: askOutput, cumulative: cumAsk });
    }

    const spread = asks[0].price - bids[0].price;
    const spreadPercent = (spread / midPrice) * 100;

    return { poolId, bids, asks, midPrice, spread, spreadPercent, computedAt: Date.now() };
  }

  getSwapHistory(poolId?: string, limit = 100): SwapResult[] {
    const filtered = poolId ? this.swapHistory.filter(s => s.poolId === poolId) : this.swapHistory;
    return filtered.slice(-limit);
  }

  getPoolStats(poolId: string): Record<string, unknown> {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);

    const history = this.swapHistory.filter(s => s.poolId === poolId);
    const totalVolume = history.reduce((s, r) => s + r.inputAmount, 0);
    const totalFees = history.reduce((s, r) => s + r.feeAmount, 0);
    const tvlA = pool.reserveA;
    const tvlB = pool.reserveB;
    const price = pool.reserveB / pool.reserveA;
    const positions = Array.from(this.positions.values()).filter(p => p.poolId === poolId);

    return {
      poolId,
      price,
      tvlA,
      tvlB,
      totalLpTokens: pool.totalLpTokens,
      totalVolume,
      totalFees,
      swapCount: history.length,
      liquidityProviders: positions.length,
      feeApr: tvlA > 0 ? (totalFees / tvlA) * 365 * 100 : 0,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private computeDynamicFee(pool: LiquidityPool, reserveIn: number, amountIn: number): number {
    if (pool.feeModel === 'flat' || pool.feeModel === 'zero') return pool.baseFeePercent;
    if (pool.feeModel === 'dynamic') {
      const utilizationRatio = amountIn / reserveIn;
      const multiplier = Math.min(1 + utilizationRatio * 10, this.config.dynamicFeeMultiplierCap);
      return pool.baseFeePercent * multiplier;
    }
    // tiered
    const utilization = amountIn / reserveIn;
    if (utilization < 0.01) return pool.baseFeePercent * 0.5;
    if (utilization < 0.05) return pool.baseFeePercent;
    return pool.baseFeePercent * 2;
  }

  private distributeFeesToPositions(poolId: string, feeA: number, feeB: number): void {
    const poolPositions = Array.from(this.positions.values()).filter(p => p.poolId === poolId);
    const pool = this.pools.get(poolId);
    if (!pool || poolPositions.length === 0) return;

    for (const pos of poolPositions) {
      const share = pos.lpTokens / pool.totalLpTokens;
      pos.feesEarnedA += feeA * share;
      pos.feesEarnedB += feeB * share;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getMarketMaker(): AutonomousMarketMaker {
  const key = '__autonomousMarketMaker__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new AutonomousMarketMaker();
  }
  return (globalThis as Record<string, unknown>)[key] as AutonomousMarketMaker;
}
