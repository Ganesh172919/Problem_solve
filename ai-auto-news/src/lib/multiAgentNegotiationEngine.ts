/**
 * @module multiAgentNegotiationEngine
 * @description Multi-agent negotiation engine implementing auction mechanisms
 * (sealed-bid, Vickrey, English, Dutch), bilateral contract negotiation protocols,
 * Nash equilibrium computation, coalition formation (Shapley values), preference
 * elicitation, mechanism design for incentive compatibility, and autonomous
 * multi-party deal execution for resource allocation and service pricing.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type NegotiationProtocol = 'sealed_bid' | 'vickrey' | 'english' | 'dutch' | 'bilateral' | 'multi_issue';
export type BidStatus = 'active' | 'won' | 'lost' | 'withdrawn' | 'cancelled';
export type AgentStrategy = 'greedy' | 'conceder' | 'tit_for_tat' | 'nash_bargaining' | 'cooperative' | 'competitive';
export type NegotiationStatus = 'open' | 'in_progress' | 'completed' | 'failed' | 'expired';
export type AuctionType = 'forward' | 'reverse' | 'double';

export interface NegotiatingAgent {
  agentId: string;
  name: string;
  type: 'buyer' | 'seller' | 'mediator';
  strategy: AgentStrategy;
  reservationValue: number;     // minimum acceptable value
  aspirationValue: number;      // ideal value
  budget: number;
  utilityWeights: Record<string, number>;   // issue -> weight
  preferences: Record<string, number[]>;   // issue -> ordered preferences
  activeNegotiations: string[];
  reputation: number;           // 0-1
  metadata: Record<string, unknown>;
}

export interface Bid {
  bidId: string;
  auctionId: string;
  bidderId: string;
  amount: number;
  timestamp: number;
  status: BidStatus;
  metadata: Record<string, unknown>;
}

export interface Auction {
  auctionId: string;
  type: AuctionType;
  protocol: NegotiationProtocol;
  item: string;
  description: string;
  startingPrice: number;
  reservePrice: number;
  currentPrice: number;
  minimumIncrement: number;
  sellerId: string;
  bids: Bid[];
  winnerId?: string;
  winningBid?: number;
  status: NegotiationStatus;
  startedAt: number;
  endsAt: number;
  completedAt?: number;
}

export interface NegotiationIssue {
  issueId: string;
  name: string;
  valueRange: { min: number; max: number };
  weight: number;
  resolution: number;   // granularity of negotiation steps
}

export interface NegotiationOffer {
  offerId: string;
  negotiationId: string;
  fromAgentId: string;
  toAgentId: string;
  issueValues: Record<string, number>;    // issue -> proposed value
  utilityScore: number;                   // estimated utility for offering agent
  round: number;
  timestamp: number;
  accepted?: boolean;
  counterOfferId?: string;
}

export interface BilateralNegotiation {
  negotiationId: string;
  issues: NegotiationIssue[];
  buyerAgentId: string;
  sellerAgentId: string;
  protocol: NegotiationProtocol;
  maxRounds: number;
  currentRound: number;
  offers: NegotiationOffer[];
  agreement?: Record<string, number>;    // agreed issue values
  status: NegotiationStatus;
  startedAt: number;
  completedAt?: number;
  deadline: number;
}

export interface CoalitionGame {
  gameId: string;
  agents: string[];
  characteristicFunction: Record<string, number>;  // coalition set key -> value
  shapleyValues?: Record<string, number>;
  coreAllocations?: Array<Record<string, number>>;
  dominantCoalition?: string[];
  computedAt?: number;
}

export interface NashEquilibrium {
  gameId: string;
  strategies: Record<string, string>;    // agentId -> strategy
  payoffs: Record<string, number>;       // agentId -> payoff
  isPureStrategy: boolean;
  isParetOptimal: boolean;
  computedAt: number;
}

export interface NegotiationConfig {
  defaultMaxRounds?: number;
  defaultDeadlineMs?: number;
  utilityDecayRate?: number;     // impatience factor
  reputationThreshold?: number;
  concessionStep?: number;
}

// ── Utility Functions ─────────────────────────────────────────────────────────

function linearUtility(value: number, min: number, max: number, direction: 'max' | 'min' = 'max'): number {
  if (max === min) return 0.5;
  const normalized = (value - min) / (max - min);
  return direction === 'max' ? normalized : 1 - normalized;
}

function powerSet<T>(arr: T[]): T[][] {
  return arr.reduce<T[][]>((subsets, val) => subsets.concat(subsets.map(set => [...set, val])), [[]]);
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class MultiAgentNegotiationEngine {
  private agents = new Map<string, NegotiatingAgent>();
  private auctions = new Map<string, Auction>();
  private negotiations = new Map<string, BilateralNegotiation>();
  private coalitionGames = new Map<string, CoalitionGame>();
  private nashEquilibria = new Map<string, NashEquilibrium>();
  private config: Required<NegotiationConfig>;

  constructor(config: NegotiationConfig = {}) {
    this.config = {
      defaultMaxRounds: config.defaultMaxRounds ?? 20,
      defaultDeadlineMs: config.defaultDeadlineMs ?? 5 * 60_000,
      utilityDecayRate: config.utilityDecayRate ?? 0.02,
      reputationThreshold: config.reputationThreshold ?? 0.3,
      concessionStep: config.concessionStep ?? 0.05,
    };
  }

  // ── Agent Management ──────────────────────────────────────────────────────

  registerAgent(params: Omit<NegotiatingAgent, 'agentId' | 'activeNegotiations' | 'reputation'>): NegotiatingAgent {
    const agent: NegotiatingAgent = {
      ...params,
      agentId: `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      activeNegotiations: [],
      reputation: 0.8,
    };
    this.agents.set(agent.agentId, agent);
    logger.info('Negotiating agent registered', { agentId: agent.agentId, type: agent.type, strategy: agent.strategy });
    return agent;
  }

  getAgent(agentId: string): NegotiatingAgent | undefined {
    return this.agents.get(agentId);
  }

  listAgents(type?: NegotiatingAgent['type']): NegotiatingAgent[] {
    const all = Array.from(this.agents.values());
    return type ? all.filter(a => a.type === type) : all;
  }

  // ── Auction Operations ────────────────────────────────────────────────────

  createAuction(params: Omit<Auction, 'auctionId' | 'bids' | 'currentPrice' | 'status' | 'startedAt'>): Auction {
    const auction: Auction = {
      ...params,
      auctionId: `auc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      bids: [],
      currentPrice: params.startingPrice,
      status: 'open',
      startedAt: Date.now(),
    };
    this.auctions.set(auction.auctionId, auction);
    logger.info('Auction created', { auctionId: auction.auctionId, protocol: auction.protocol, item: auction.item });
    return auction;
  }

  submitBid(auctionId: string, bidderId: string, amount: number, metadata: Record<string, unknown> = {}): Bid {
    const auction = this.auctions.get(auctionId);
    if (!auction) throw new Error(`Auction ${auctionId} not found`);
    if (auction.status !== 'open' && auction.status !== 'in_progress') throw new Error('Auction is not accepting bids');
    if (Date.now() > auction.endsAt) throw new Error('Auction has ended');

    const agent = this.agents.get(bidderId);
    if (agent && agent.reputation < this.config.reputationThreshold) {
      throw new Error('Agent reputation too low to participate');
    }

    // Protocol-specific bid validation
    if (auction.protocol === 'english' && amount <= auction.currentPrice) {
      throw new Error(`Bid must exceed current price ${auction.currentPrice}`);
    }
    if (auction.protocol === 'dutch' && amount < auction.currentPrice) {
      throw new Error(`Dutch auction: current price is ${auction.currentPrice}`);
    }

    const bid: Bid = {
      bidId: `bid_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      auctionId,
      bidderId,
      amount,
      timestamp: Date.now(),
      status: 'active',
      metadata,
    };

    auction.bids.push(bid);
    auction.status = 'in_progress';

    if (auction.protocol === 'english') {
      auction.currentPrice = amount;
    }

    // Dutch auction: first bid wins
    if (auction.protocol === 'dutch' && amount >= auction.currentPrice) {
      this.closeAuction(auctionId);
    }

    return bid;
  }

  closeAuction(auctionId: string): Auction {
    const auction = this.auctions.get(auctionId);
    if (!auction) throw new Error(`Auction ${auctionId} not found`);

    auction.status = 'completed';
    auction.completedAt = Date.now();

    const validBids = auction.bids.filter(b => b.status === 'active');

    if (validBids.length === 0) {
      logger.info('Auction closed with no bids', { auctionId });
      return auction;
    }

    let winner: Bid | undefined;

    if (auction.protocol === 'sealed_bid' || auction.protocol === 'english') {
      // Highest bid wins
      winner = validBids.reduce((best, b) => b.amount > best.amount ? b : best);
      auction.winningBid = winner.amount;
    } else if (auction.protocol === 'vickrey') {
      // Second-price auction: highest bidder wins at second highest price
      const sorted = [...validBids].sort((a, b) => b.amount - a.amount);
      winner = sorted[0];
      auction.winningBid = sorted[1]?.amount ?? auction.reservePrice;
    } else if (auction.protocol === 'dutch') {
      // First bidder at current price wins
      winner = validBids[validBids.length - 1];
      auction.winningBid = winner?.amount;
    }

    if (winner && (auction.winningBid ?? 0) >= auction.reservePrice) {
      winner.status = 'won';
      auction.winnerId = winner.bidderId;
      validBids.filter(b => b.bidId !== winner!.bidId).forEach(b => { b.status = 'lost'; });

      // Update winner's reputation
      const winnerAgent = this.agents.get(winner.bidderId);
      if (winnerAgent) winnerAgent.reputation = Math.min(1, winnerAgent.reputation + 0.02);
    } else {
      validBids.forEach(b => { b.status = 'lost'; });
    }

    logger.info('Auction closed', { auctionId, winnerId: auction.winnerId, winningBid: auction.winningBid });
    return auction;
  }

  // ── Bilateral Negotiation ─────────────────────────────────────────────────

  startNegotiation(params: Omit<BilateralNegotiation, 'negotiationId' | 'currentRound' | 'offers' | 'status' | 'startedAt'>): BilateralNegotiation {
    const neg: BilateralNegotiation = {
      ...params,
      negotiationId: `neg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      currentRound: 0,
      offers: [],
      status: 'open',
      startedAt: Date.now(),
    };
    this.negotiations.set(neg.negotiationId, neg);

    // Register with agents
    [neg.buyerAgentId, neg.sellerAgentId].forEach(id => {
      const agent = this.agents.get(id);
      if (agent) agent.activeNegotiations.push(neg.negotiationId);
    });

    return neg;
  }

  makeOffer(negotiationId: string, fromAgentId: string, issueValues: Record<string, number>): NegotiationOffer {
    const neg = this.negotiations.get(negotiationId);
    if (!neg) throw new Error(`Negotiation ${negotiationId} not found`);
    if (neg.status !== 'open' && neg.status !== 'in_progress') throw new Error('Negotiation not active');
    if (Date.now() > neg.deadline) {
      neg.status = 'expired';
      throw new Error('Negotiation deadline passed');
    }

    const fromAgent = this.agents.get(fromAgentId);
    const utilityScore = fromAgent
      ? this.computeUtility(fromAgent, issueValues, neg.issues)
      : 0.5;

    const offer: NegotiationOffer = {
      offerId: `offer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      negotiationId,
      fromAgentId,
      toAgentId: fromAgentId === neg.buyerAgentId ? neg.sellerAgentId : neg.buyerAgentId,
      issueValues,
      utilityScore,
      round: neg.currentRound,
      timestamp: Date.now(),
    };

    neg.offers.push(offer);
    neg.currentRound += 1;
    neg.status = 'in_progress';

    return offer;
  }

  respondToOffer(offerId: string, negotiationId: string, accept: boolean, counterValues?: Record<string, number>): NegotiationOffer | null {
    const neg = this.negotiations.get(negotiationId);
    if (!neg) throw new Error(`Negotiation ${negotiationId} not found`);

    const offer = neg.offers.find(o => o.offerId === offerId);
    if (!offer) throw new Error(`Offer ${offerId} not found`);

    offer.accepted = accept;

    if (accept) {
      neg.agreement = offer.issueValues;
      neg.status = 'completed';
      neg.completedAt = Date.now();

      // Update reputations
      [neg.buyerAgentId, neg.sellerAgentId].forEach(id => {
        const agent = this.agents.get(id);
        if (agent) {
          agent.reputation = Math.min(1, agent.reputation + 0.01);
          agent.activeNegotiations = agent.activeNegotiations.filter(n => n !== negotiationId);
        }
      });

      logger.info('Negotiation completed with agreement', { negotiationId, agreement: neg.agreement });
      return null;
    }

    if (counterValues && neg.currentRound < neg.maxRounds) {
      return this.makeOffer(negotiationId, offer.toAgentId, counterValues);
    }

    if (neg.currentRound >= neg.maxRounds) {
      neg.status = 'failed';
      logger.info('Negotiation failed: max rounds reached', { negotiationId });
    }

    return null;
  }

  // ── Auto-negotiate ────────────────────────────────────────────────────────

  autoNegotiate(negotiationId: string): BilateralNegotiation {
    const neg = this.negotiations.get(negotiationId);
    if (!neg) throw new Error(`Negotiation ${negotiationId} not found`);

    const buyer = this.agents.get(neg.buyerAgentId);
    const seller = this.agents.get(neg.sellerAgentId);
    if (!buyer || !seller) throw new Error('Negotiating agents not found');

    let round = 0;
    while (round < neg.maxRounds && neg.status !== 'completed' && neg.status !== 'failed') {
      // Buyer makes offer with concession
      const concessionFactor = 1 - (round / neg.maxRounds) * this.config.concessionStep * 10;
      const buyerOffer: Record<string, number> = {};

      for (const issue of neg.issues) {
        const idealBuyer = issue.valueRange.min;
        const idealSeller = issue.valueRange.max;
        const conceded = idealBuyer + (idealSeller - idealBuyer) * (1 - concessionFactor);
        buyerOffer[issue.issueId] = Math.max(issue.valueRange.min, Math.min(issue.valueRange.max, conceded));
      }

      const offer = this.makeOffer(negotiationId, buyer.agentId, buyerOffer);

      // Seller evaluates
      const sellerUtility = this.computeUtility(seller, buyerOffer, neg.issues);

      if (sellerUtility >= seller.reservationValue / seller.aspirationValue) {
        this.respondToOffer(offer.offerId, negotiationId, true);
        break;
      }

      // Seller counter-offers
      const sellerOffer: Record<string, number> = {};
      const sellerConcession = 1 - ((round + 1) / neg.maxRounds) * this.config.concessionStep * 10;
      for (const issue of neg.issues) {
        const idealBuyer = issue.valueRange.min;
        const idealSeller = issue.valueRange.max;
        const conceded = idealSeller - (idealSeller - idealBuyer) * (1 - sellerConcession);
        sellerOffer[issue.issueId] = Math.max(issue.valueRange.min, Math.min(issue.valueRange.max, conceded));
      }

      const counterOffer = this.makeOffer(negotiationId, seller.agentId, sellerOffer);

      const buyerUtility = this.computeUtility(buyer, sellerOffer, neg.issues);
      if (buyerUtility >= buyer.reservationValue / buyer.aspirationValue) {
        this.respondToOffer(counterOffer.offerId, negotiationId, true);
        break;
      }

      round++;
    }

    if (neg.status === 'in_progress') {
      neg.status = 'failed';
    }

    return neg;
  }

  // ── Coalition Formation ───────────────────────────────────────────────────

  createCoalitionGame(agents: string[], characteristicFunction: Record<string, number>): CoalitionGame {
    const game: CoalitionGame = {
      gameId: `game_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      agents,
      characteristicFunction,
    };
    this.coalitionGames.set(game.gameId, game);
    return game;
  }

  computeShapleyValues(gameId: string): Record<string, number> {
    const game = this.coalitionGames.get(gameId);
    if (!game) throw new Error(`Game ${gameId} not found`);

    const n = game.agents.length;
    const shapley: Record<string, number> = {};

    for (const agent of game.agents) {
      let value = 0;
      const otherAgents = game.agents.filter(a => a !== agent);
      const subsets = powerSet(otherAgents);

      for (const subset of subsets) {
        const sSize = subset.length;
        const coalitionKey = [...subset, agent].sort().join(',');
        const subsetKey = subset.sort().join(',');

        const withAgent = game.characteristicFunction[coalitionKey] ?? 0;
        const withoutAgent = game.characteristicFunction[subsetKey] ?? 0;
        const marginalContribution = withAgent - withoutAgent;

        const factorial = (k: number): number => k <= 1 ? 1 : k * factorial(k - 1);
        const weight = (factorial(sSize) * factorial(n - sSize - 1)) / factorial(n);
        value += weight * marginalContribution;
      }

      shapley[agent] = value;
    }

    game.shapleyValues = shapley;
    game.computedAt = Date.now();
    return shapley;
  }

  // ── Nash Equilibrium ──────────────────────────────────────────────────────

  computeNashEquilibrium(gameId: string, payoffMatrix: Record<string, Record<string, number>>): NashEquilibrium {
    // Simplified Nash: each agent independently maximizes payoff
    const strategies: Record<string, string> = {};
    const payoffs: Record<string, number> = {};

    for (const [agentId, stratPayoffs] of Object.entries(payoffMatrix)) {
      let bestStrategy = '';
      let bestPayoff = -Infinity;
      for (const [strategy, payoff] of Object.entries(stratPayoffs)) {
        if (payoff > bestPayoff) {
          bestPayoff = payoff;
          bestStrategy = strategy;
        }
      }
      strategies[agentId] = bestStrategy;
      payoffs[agentId] = bestPayoff;
    }

    // Check Pareto optimality (simplified: total payoff comparison)
    const totalPayoff = Object.values(payoffs).reduce((s, v) => s + v, 0);
    const maxPossible = Object.values(payoffMatrix).reduce((s, m) => s + Math.max(...Object.values(m)), 0);
    const isParetoOptimal = totalPayoff >= maxPossible * 0.9;

    const equilibrium: NashEquilibrium = {
      gameId,
      strategies,
      payoffs,
      isPureStrategy: true,
      isParetOptimal: isParetoOptimal,
      computedAt: Date.now(),
    };

    this.nashEquilibria.set(gameId, equilibrium);
    return equilibrium;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getDashboardSummary(): Record<string, unknown> {
    const activeAuctions = Array.from(this.auctions.values()).filter(a => a.status === 'open' || a.status === 'in_progress');
    const activeNegotiations = Array.from(this.negotiations.values()).filter(n => n.status === 'in_progress' || n.status === 'open');
    const completedNeg = Array.from(this.negotiations.values()).filter(n => n.status === 'completed');
    const successRate = this.negotiations.size > 0 ? completedNeg.length / this.negotiations.size : 0;

    return {
      totalAgents: this.agents.size,
      activeAuctions: activeAuctions.length,
      totalAuctions: this.auctions.size,
      activeNegotiations: activeNegotiations.length,
      completedNegotiations: completedNeg.length,
      negotiationSuccessRate: successRate,
      coalitionGames: this.coalitionGames.size,
      nashEquilibria: this.nashEquilibria.size,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private computeUtility(agent: NegotiatingAgent, issueValues: Record<string, number>, issues: NegotiationIssue[]): number {
    let utility = 0;
    let totalWeight = 0;

    for (const issue of issues) {
      const value = issueValues[issue.issueId] ?? 0;
      const weight = agent.utilityWeights[issue.issueId] ?? issue.weight;
      const issuePref = agent.type === 'buyer' ? 'min' : 'max';
      utility += weight * linearUtility(value, issue.valueRange.min, issue.valueRange.max, issuePref);
      totalWeight += weight;
    }

    return totalWeight > 0 ? utility / totalWeight : 0;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getNegotiationEngine(): MultiAgentNegotiationEngine {
  const key = '__multiAgentNegotiationEngine__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new MultiAgentNegotiationEngine();
  }
  return (globalThis as Record<string, unknown>)[key] as MultiAgentNegotiationEngine;
}
