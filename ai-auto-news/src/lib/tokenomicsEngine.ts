/**
 * @module tokenomicsEngine
 * @description Tokenomics engine for platform-native utility token management
 * implementing staking/unstaking with lock periods, inflation/deflation controls,
 * vesting schedules, governance voting weight, liquidity mining rewards, burn
 * mechanisms, token velocity metrics, whale concentration analysis, economic
 * health scoring, treasury management, and on-chain event simulation.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type TokenTransactionType = 'mint' | 'burn' | 'transfer' | 'stake' | 'unstake' | 'reward' | 'slash' | 'vest' | 'governance_lock' | 'fee';
export type VestingScheduleType = 'linear' | 'cliff' | 'graded' | 'exponential';
export type StakingTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type GovernanceProposalStatus = 'draft' | 'active' | 'passed' | 'rejected' | 'executed';

export interface TokenHolder {
  holderId: string;
  address: string;
  balance: number;
  stakedBalance: number;
  lockedBalance: number;
  vestingBalance: number;
  rewardsEarned: number;
  rewardsClaimed: number;
  stakingTier: StakingTier;
  governanceWeight: number;
  joinedAt: number;
  lastActivityAt: number;
  metadata: Record<string, unknown>;
}

export interface TokenTransaction {
  txId: string;
  type: TokenTransactionType;
  fromAddress?: string;
  toAddress?: string;
  amount: number;
  fee: number;
  blockHeight: number;
  timestamp: number;
  metadata: Record<string, unknown>;
  revertedAt?: number;
}

export interface StakingPosition {
  positionId: string;
  holderId: string;
  amount: number;
  stakedAt: number;
  unlockAt: number;   // lockPeriod + stakedAt
  lockPeriodMs: number;
  apy: number;        // annual percentage yield
  tier: StakingTier;
  accruedRewards: number;
  lastRewardAt: number;
  active: boolean;
}

export interface VestingSchedule {
  scheduleId: string;
  holderId: string;
  totalAmount: number;
  releasedAmount: number;
  scheduleType: VestingScheduleType;
  cliffMs: number;
  durationMs: number;
  startedAt: number;
  nextVestAt?: number;
  intervals: number;
  amountPerInterval: number;
}

export interface GovernanceProposal {
  proposalId: string;
  title: string;
  description: string;
  proposerId: string;
  status: GovernanceProposalStatus;
  votesFor: number;
  votesAgainst: number;
  totalVotingWeight: number;
  quorumRequired: number;
  passThreshold: number;   // % required to pass
  votes: Record<string, { weight: number; vote: 'for' | 'against' | 'abstain'; timestamp: number }>;
  createdAt: number;
  endsAt: number;
  executedAt?: number;
}

export interface TokenomicsConfig {
  name: string;
  symbol: string;
  totalSupply: number;
  maxSupply: number;
  decimals: number;
  inflationRate: number;      // annual %
  burnRate: number;           // % of fees burned
  stakingApy: Record<StakingTier, number>;
  stakingLockPeriods: Record<StakingTier, number>;  // ms
  stakingMinAmount: Record<StakingTier, number>;
  governanceQuorum: number;   // % of total supply
  transactionFeePercent: number;
}

export interface EconomicHealthMetrics {
  totalSupply: number;
  circulatingSupply: number;
  totalStaked: number;
  totalLocked: number;
  stakingRatio: number;   // staked / circulating
  velocityIndex: number;  // transactions / supply
  giniCoefficient: number;
  whaleConcentration: number;  // % held by top 10
  rewardEmissionRate: number;  // tokens emitted per day
  burnRate: number;
  healthScore: number;    // 0-100
}

export interface TreasuryState {
  treasuryBalance: number;
  operationalReserve: number;
  liquidityProvision: number;
  ecosystemFund: number;
  teamVesting: number;
  allocatedAt: number;
}

export interface TokenomicsEngineConfig {
  rewardAccrualIntervalMs?: number;
  vestingCheckIntervalMs?: number;
  maxHolders?: number;
  maxPositions?: number;
}

// ── Staking Tier Classification ────────────────────────────────────────────

function classifyStakingTier(stakedAmount: number, config: TokenomicsConfig): StakingTier {
  if (stakedAmount >= config.stakingMinAmount.diamond) return 'diamond';
  if (stakedAmount >= config.stakingMinAmount.platinum) return 'platinum';
  if (stakedAmount >= config.stakingMinAmount.gold) return 'gold';
  if (stakedAmount >= config.stakingMinAmount.silver) return 'silver';
  return 'bronze';
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class TokenomicsEngine {
  private holders = new Map<string, TokenHolder>();
  private transactions: TokenTransaction[] = [];
  private stakingPositions = new Map<string, StakingPosition>();
  private vestingSchedules = new Map<string, VestingSchedule>();
  private proposals = new Map<string, GovernanceProposal>();
  private tokenConfig: TokenomicsConfig;
  private engineConfig: Required<TokenomicsEngineConfig>;
  private blockHeight = 0;
  private treasury: TreasuryState;

  constructor(tokenConfig: TokenomicsConfig, engineConfig: TokenomicsEngineConfig = {}) {
    this.tokenConfig = tokenConfig;
    this.engineConfig = {
      rewardAccrualIntervalMs: engineConfig.rewardAccrualIntervalMs ?? 86_400_000,
      vestingCheckIntervalMs: engineConfig.vestingCheckIntervalMs ?? 3_600_000,
      maxHolders: engineConfig.maxHolders ?? 1_000_000,
      maxPositions: engineConfig.maxPositions ?? 5_000_000,
    };
    this.treasury = {
      treasuryBalance: tokenConfig.totalSupply * 0.2,
      operationalReserve: tokenConfig.totalSupply * 0.1,
      liquidityProvision: tokenConfig.totalSupply * 0.05,
      ecosystemFund: tokenConfig.totalSupply * 0.15,
      teamVesting: tokenConfig.totalSupply * 0.1,
      allocatedAt: Date.now(),
    };
  }

  // ── Holder Management ─────────────────────────────────────────────────────

  registerHolder(params: Omit<TokenHolder, 'holderId' | 'stakedBalance' | 'lockedBalance' | 'vestingBalance' | 'rewardsEarned' | 'rewardsClaimed' | 'stakingTier' | 'governanceWeight' | 'joinedAt' | 'lastActivityAt'>): TokenHolder {
    const holder: TokenHolder = {
      ...params,
      holderId: `holder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      stakedBalance: 0,
      lockedBalance: 0,
      vestingBalance: 0,
      rewardsEarned: 0,
      rewardsClaimed: 0,
      stakingTier: 'bronze',
      governanceWeight: 0,
      joinedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.holders.set(holder.holderId, holder);
    return holder;
  }

  getHolder(holderId: string): TokenHolder | undefined {
    return this.holders.get(holderId);
  }

  getHolderByAddress(address: string): TokenHolder | undefined {
    return Array.from(this.holders.values()).find(h => h.address === address);
  }

  // ── Token Transfers ───────────────────────────────────────────────────────

  transfer(fromHolderId: string, toHolderId: string, amount: number): TokenTransaction {
    const from = this.holders.get(fromHolderId);
    const to = this.holders.get(toHolderId);
    if (!from) throw new Error(`Sender ${fromHolderId} not found`);
    if (!to) throw new Error(`Recipient ${toHolderId} not found`);

    const available = from.balance - from.stakedBalance - from.lockedBalance;
    if (available < amount) throw new Error(`Insufficient balance: available ${available}, requested ${amount}`);

    const fee = amount * (this.tokenConfig.transactionFeePercent / 100);
    const netAmount = amount - fee;
    const burnAmount = fee * (this.tokenConfig.burnRate / 100);
    const protocolFee = fee - burnAmount;

    from.balance -= amount;
    to.balance += netAmount;
    this.tokenConfig.totalSupply -= burnAmount; // burn

    from.lastActivityAt = Date.now();
    to.lastActivityAt = Date.now();

    const tx: TokenTransaction = {
      txId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'transfer',
      fromAddress: from.address,
      toAddress: to.address,
      amount: netAmount,
      fee: protocolFee,
      blockHeight: ++this.blockHeight,
      timestamp: Date.now(),
      metadata: { burnAmount, grossAmount: amount },
    };

    this.transactions.push(tx);
    if (this.transactions.length > 100_000) this.transactions.shift();

    logger.info('Token transfer executed', { txId: tx.txId, amount: netAmount, fee: protocolFee });
    return tx;
  }

  mint(toHolderId: string, amount: number, reason = 'reward'): TokenTransaction {
    const to = this.holders.get(toHolderId);
    if (!to) throw new Error(`Holder ${toHolderId} not found`);
    if (this.tokenConfig.totalSupply + amount > this.tokenConfig.maxSupply) {
      throw new Error('Mint would exceed max supply');
    }

    to.balance += amount;
    this.tokenConfig.totalSupply += amount;

    const tx: TokenTransaction = {
      txId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'mint',
      toAddress: to.address,
      amount,
      fee: 0,
      blockHeight: ++this.blockHeight,
      timestamp: Date.now(),
      metadata: { reason },
    };

    this.transactions.push(tx);
    return tx;
  }

  burn(fromHolderId: string, amount: number): TokenTransaction {
    const from = this.holders.get(fromHolderId);
    if (!from) throw new Error(`Holder ${fromHolderId} not found`);

    const available = from.balance - from.stakedBalance - from.lockedBalance;
    if (available < amount) throw new Error('Insufficient balance for burn');

    from.balance -= amount;
    this.tokenConfig.totalSupply -= amount;

    const tx: TokenTransaction = {
      txId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'burn',
      fromAddress: from.address,
      amount,
      fee: 0,
      blockHeight: ++this.blockHeight,
      timestamp: Date.now(),
      metadata: {},
    };

    this.transactions.push(tx);
    logger.info('Tokens burned', { holderId: fromHolderId, amount });
    return tx;
  }

  // ── Staking ────────────────────────────────────────────────────────────────

  stake(holderId: string, amount: number, tier: StakingTier): StakingPosition {
    const holder = this.holders.get(holderId);
    if (!holder) throw new Error(`Holder ${holderId} not found`);

    const available = holder.balance - holder.stakedBalance - holder.lockedBalance;
    if (available < amount) throw new Error('Insufficient balance for staking');

    const minAmount = this.tokenConfig.stakingMinAmount[tier];
    if (amount < minAmount) throw new Error(`Minimum stake for ${tier}: ${minAmount}`);

    const lockPeriod = this.tokenConfig.stakingLockPeriods[tier];
    const apy = this.tokenConfig.stakingApy[tier];

    const position: StakingPosition = {
      positionId: `pos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      holderId,
      amount,
      stakedAt: Date.now(),
      unlockAt: Date.now() + lockPeriod,
      lockPeriodMs: lockPeriod,
      apy,
      tier,
      accruedRewards: 0,
      lastRewardAt: Date.now(),
      active: true,
    };

    holder.stakedBalance += amount;
    holder.stakingTier = classifyStakingTier(holder.stakedBalance, this.tokenConfig);
    holder.governanceWeight = Math.sqrt(holder.stakedBalance); // quadratic voting
    holder.lastActivityAt = Date.now();

    this.stakingPositions.set(position.positionId, position);
    this.recordTransaction(holderId, 'stake', amount);

    logger.info('Staking position created', { positionId: position.positionId, holderId, amount, tier, apy });
    return position;
  }

  unstake(positionId: string): { rewards: number; transaction: TokenTransaction } {
    const position = this.stakingPositions.get(positionId);
    if (!position) throw new Error(`Position ${positionId} not found`);
    if (!position.active) throw new Error('Position already closed');

    if (Date.now() < position.unlockAt) {
      const remaining = position.unlockAt - Date.now();
      throw new Error(`Position locked for another ${Math.ceil(remaining / 1000)}s`);
    }

    const holder = this.holders.get(position.holderId);
    if (!holder) throw new Error('Holder not found');

    // Final reward accrual
    this.accrueRewards(positionId);

    const rewards = position.accruedRewards;
    holder.stakedBalance -= position.amount;
    holder.rewardsEarned += rewards;
    holder.balance += position.amount + rewards;
    holder.stakingTier = classifyStakingTier(holder.stakedBalance, this.tokenConfig);
    holder.governanceWeight = Math.sqrt(Math.max(0, holder.stakedBalance));
    position.active = false;

    const tx = this.recordTransaction(position.holderId, 'unstake', position.amount + rewards);
    logger.info('Staking position closed', { positionId, rewards, holderId: position.holderId });
    return { rewards, transaction: tx };
  }

  accrueRewards(positionId: string): number {
    const position = this.stakingPositions.get(positionId);
    if (!position || !position.active) return 0;

    const elapsedMs = Date.now() - position.lastRewardAt;
    const annualMs = 365 * 24 * 3_600_000;
    const reward = position.amount * (position.apy / 100) * (elapsedMs / annualMs);

    position.accruedRewards += reward;
    position.lastRewardAt = Date.now();

    const holder = this.holders.get(position.holderId);
    if (holder) holder.rewardsEarned += reward;

    return reward;
  }

  // ── Vesting ────────────────────────────────────────────────────────────────

  createVestingSchedule(params: Omit<VestingSchedule, 'scheduleId' | 'releasedAmount' | 'startedAt' | 'nextVestAt' | 'amountPerInterval'>): VestingSchedule {
    const holder = this.holders.get(params.holderId);
    if (!holder) throw new Error(`Holder ${params.holderId} not found`);

    const schedule: VestingSchedule = {
      ...params,
      scheduleId: `vest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      releasedAmount: 0,
      startedAt: Date.now(),
      nextVestAt: Date.now() + params.cliffMs,
      amountPerInterval: params.totalAmount / params.intervals,
    };

    holder.vestingBalance += params.totalAmount;
    holder.lockedBalance += params.totalAmount;
    this.vestingSchedules.set(schedule.scheduleId, schedule);
    return schedule;
  }

  processVesting(scheduleId: string): number {
    const schedule = this.vestingSchedules.get(scheduleId);
    if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

    const remaining = schedule.totalAmount - schedule.releasedAmount;
    if (remaining <= 0) return 0;
    if (!schedule.nextVestAt || Date.now() < schedule.nextVestAt) return 0;

    const holder = this.holders.get(schedule.holderId);
    if (!holder) return 0;

    const releaseAmount = Math.min(schedule.amountPerInterval, remaining);
    schedule.releasedAmount += releaseAmount;
    holder.vestingBalance -= releaseAmount;
    holder.lockedBalance = Math.max(0, holder.lockedBalance - releaseAmount);
    holder.balance += releaseAmount;

    const intervalMs = (schedule.durationMs - schedule.cliffMs) / schedule.intervals;
    schedule.nextVestAt = (schedule.nextVestAt ?? Date.now()) + intervalMs;

    this.recordTransaction(schedule.holderId, 'vest', releaseAmount);
    return releaseAmount;
  }

  // ── Governance ─────────────────────────────────────────────────────────────

  createProposal(params: Omit<GovernanceProposal, 'proposalId' | 'status' | 'votesFor' | 'votesAgainst' | 'totalVotingWeight' | 'votes' | 'createdAt'>): GovernanceProposal {
    const proposal: GovernanceProposal = {
      ...params,
      proposalId: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'active',
      votesFor: 0,
      votesAgainst: 0,
      totalVotingWeight: 0,
      votes: {},
      createdAt: Date.now(),
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  castVote(proposalId: string, holderId: string, vote: 'for' | 'against' | 'abstain'): void {
    const proposal = this.proposals.get(proposalId);
    const holder = this.holders.get(holderId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (!holder) throw new Error(`Holder ${holderId} not found`);
    if (proposal.status !== 'active') throw new Error('Proposal is not active');
    if (Date.now() > proposal.endsAt) throw new Error('Voting period ended');

    if (proposal.votes[holderId]) throw new Error('Already voted');

    const weight = holder.governanceWeight;
    proposal.votes[holderId] = { weight, vote, timestamp: Date.now() };
    proposal.totalVotingWeight += weight;

    if (vote === 'for') proposal.votesFor += weight;
    else if (vote === 'against') proposal.votesAgainst += weight;
  }

  finalizeProposal(proposalId: string): GovernanceProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

    const totalSupply = this.tokenConfig.totalSupply;
    const quorumMet = (proposal.totalVotingWeight / totalSupply) * 100 >= this.tokenConfig.governanceQuorum;
    const passPercent = proposal.totalVotingWeight > 0
      ? (proposal.votesFor / proposal.totalVotingWeight) * 100
      : 0;

    if (!quorumMet) {
      proposal.status = 'rejected';
    } else if (passPercent >= proposal.passThreshold) {
      proposal.status = 'passed';
    } else {
      proposal.status = 'rejected';
    }

    return proposal;
  }

  // ── Economic Metrics ──────────────────────────────────────────────────────

  computeEconomicHealth(): EconomicHealthMetrics {
    const holders = Array.from(this.holders.values());
    const totalStaked = holders.reduce((s, h) => s + h.stakedBalance, 0);
    const totalLocked = holders.reduce((s, h) => s + h.lockedBalance, 0);
    const circulatingSupply = this.tokenConfig.totalSupply - totalStaked - totalLocked - this.treasury.treasuryBalance;

    const stakingRatio = circulatingSupply > 0 ? totalStaked / circulatingSupply : 0;

    // Velocity: transactions in last 24h / circulating supply
    const recentTxs = this.transactions.filter(t => Date.now() - t.timestamp < 86_400_000);
    const txVolume = recentTxs.reduce((s, t) => s + t.amount, 0);
    const velocityIndex = circulatingSupply > 0 ? txVolume / circulatingSupply : 0;

    // Gini coefficient
    const balances = holders.map(h => h.balance).sort((a, b) => a - b);
    const n = balances.length;
    const gini = n > 1
      ? (2 * balances.reduce((s, v, i) => s + (i + 1) * v, 0)) / (n * balances.reduce((s, v) => s + v, 0)) - (n + 1) / n
      : 0;

    // Whale concentration: top 10% by balance
    const whaleThreshold = Math.ceil(n * 0.1);
    const topBalances = [...balances].slice(-whaleThreshold);
    const whaleTotal = topBalances.reduce((s, v) => s + v, 0);
    const whaleConcentration = this.tokenConfig.totalSupply > 0 ? whaleTotal / this.tokenConfig.totalSupply : 0;

    const rewardEmissionRate = Array.from(this.stakingPositions.values())
      .filter(p => p.active)
      .reduce((s, p) => s + p.amount * (p.apy / 100) / 365, 0);

    // Health score (0-100)
    const healthScore = Math.max(0, Math.min(100,
      50
      + (stakingRatio > 0.3 ? 15 : stakingRatio * 50)  // staking participation
      - (gini > 0.6 ? 20 : gini * 10)                  // inequality penalty
      - (velocityIndex > 10 ? 10 : 0)                  // very high velocity penalty
      + (velocityIndex > 0.5 ? 10 : 0),                // healthy velocity bonus
    ));

    return {
      totalSupply: this.tokenConfig.totalSupply,
      circulatingSupply,
      totalStaked,
      totalLocked,
      stakingRatio,
      velocityIndex,
      giniCoefficient: Math.max(0, gini),
      whaleConcentration,
      rewardEmissionRate,
      burnRate: this.tokenConfig.burnRate,
      healthScore,
    };
  }

  getTreasury(): TreasuryState {
    return { ...this.treasury };
  }

  getTransactionHistory(holderId?: string, limit = 100): TokenTransaction[] {
    const all = this.transactions;
    if (holderId) {
      const holder = this.holders.get(holderId);
      if (!holder) return [];
      return all.filter(t => t.fromAddress === holder.address || t.toAddress === holder.address).slice(-limit);
    }
    return all.slice(-limit);
  }

  getDashboardSummary(): Record<string, unknown> {
    const health = this.computeEconomicHealth();
    const activeStakers = Array.from(this.stakingPositions.values()).filter(p => p.active).length;

    return {
      tokenName: this.tokenConfig.name,
      tokenSymbol: this.tokenConfig.symbol,
      totalSupply: this.tokenConfig.totalSupply,
      maxSupply: this.tokenConfig.maxSupply,
      circulatingSupply: health.circulatingSupply,
      totalHolders: this.holders.size,
      activeStakers,
      stakingRatio: health.stakingRatio,
      healthScore: health.healthScore,
      totalTransactions: this.transactions.length,
      activeProposals: Array.from(this.proposals.values()).filter(p => p.status === 'active').length,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private recordTransaction(holderId: string, type: TokenTransactionType, amount: number): TokenTransaction {
    const holder = this.holders.get(holderId);
    const tx: TokenTransaction = {
      txId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      fromAddress: type === 'stake' || type === 'burn' ? holder?.address : undefined,
      toAddress: type === 'unstake' || type === 'vest' || type === 'reward' ? holder?.address : undefined,
      amount,
      fee: 0,
      blockHeight: ++this.blockHeight,
      timestamp: Date.now(),
      metadata: {},
    };
    this.transactions.push(tx);
    if (this.transactions.length > 100_000) this.transactions.shift();
    return tx;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getTokenomicsEngine(): TokenomicsEngine {
  const key = '__tokenomicsEngine__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new TokenomicsEngine({
      name: 'Platform Token',
      symbol: 'PTK',
      totalSupply: 1_000_000_000,
      maxSupply: 2_000_000_000,
      decimals: 18,
      inflationRate: 5,
      burnRate: 50,
      stakingApy: { bronze: 5, silver: 8, gold: 12, platinum: 18, diamond: 25 },
      stakingLockPeriods: { bronze: 86_400_000, silver: 7 * 86_400_000, gold: 30 * 86_400_000, platinum: 90 * 86_400_000, diamond: 365 * 86_400_000 },
      stakingMinAmount: { bronze: 100, silver: 1_000, gold: 10_000, platinum: 100_000, diamond: 1_000_000 },
      governanceQuorum: 5,
      transactionFeePercent: 0.1,
    });
  }
  return (globalThis as Record<string, unknown>)[key] as TokenomicsEngine;
}
