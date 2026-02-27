import { describe, it, expect, beforeEach } from '@jest/globals';
import { MultiAgentNegotiationEngine } from '../../../src/lib/multiAgentNegotiationEngine';

describe('MultiAgentNegotiationEngine', () => {
  let engine: MultiAgentNegotiationEngine;

  beforeEach(() => {
    engine = new MultiAgentNegotiationEngine({ defaultMaxRounds: 5, concessionStep: 0.1 });
  });

  function makeAgent(type: 'buyer' | 'seller') {
    return engine.registerAgent({
      name: `${type}-agent`,
      type,
      strategy: 'conceder',
      reservationValue: type === 'buyer' ? 0.4 : 0.5,
      aspirationValue: type === 'buyer' ? 0.9 : 1.0,
      budget: 10_000,
      utilityWeights: { price: 1 },
      preferences: {},
      metadata: {},
    });
  }

  it('registers agents with generated IDs', () => {
    const buyer = makeAgent('buyer');
    const seller = makeAgent('seller');
    expect(buyer.agentId).toMatch(/^agent_/);
    expect(seller.type).toBe('seller');
    expect(engine.getAgent(buyer.agentId)).toBeDefined();
  });

  it('creates a sealed-bid auction', () => {
    const seller = makeAgent('seller');
    const auction = engine.createAuction({
      type: 'forward',
      protocol: 'sealed_bid',
      item: 'API credits bundle',
      description: '1M API credits',
      startingPrice: 100,
      reservePrice: 80,
      minimumIncrement: 5,
      sellerId: seller.agentId,
      endsAt: Date.now() + 3_600_000,
    });
    expect(auction.auctionId).toMatch(/^auc_/);
    expect(auction.status).toBe('open');
  });

  it('accepts bids and closes sealed-bid auction with winner', () => {
    const seller = makeAgent('seller');
    const buyerA = makeAgent('buyer');
    const buyerB = makeAgent('buyer');

    const auction = engine.createAuction({
      type: 'forward',
      protocol: 'sealed_bid',
      item: 'compute credits',
      description: 'Test',
      startingPrice: 50,
      reservePrice: 40,
      minimumIncrement: 1,
      sellerId: seller.agentId,
      endsAt: Date.now() + 3_600_000,
    });

    engine.submitBid(auction.auctionId, buyerA.agentId, 100);
    engine.submitBid(auction.auctionId, buyerB.agentId, 150);

    const closed = engine.closeAuction(auction.auctionId);
    expect(closed.status).toBe('completed');
    expect(closed.winnerId).toBe(buyerB.agentId);
    expect(closed.winningBid).toBe(150);
  });

  it('Vickrey auction: winner pays second-highest price', () => {
    const seller = makeAgent('seller');
    const buyerA = makeAgent('buyer');
    const buyerB = makeAgent('buyer');

    const auction = engine.createAuction({
      type: 'forward',
      protocol: 'vickrey',
      item: 'vickrey-item',
      description: 'Test',
      startingPrice: 10,
      reservePrice: 5,
      minimumIncrement: 1,
      sellerId: seller.agentId,
      endsAt: Date.now() + 3_600_000,
    });

    engine.submitBid(auction.auctionId, buyerA.agentId, 200);
    engine.submitBid(auction.auctionId, buyerB.agentId, 300);

    const closed = engine.closeAuction(auction.auctionId);
    expect(closed.winnerId).toBe(buyerB.agentId);
    expect(closed.winningBid).toBe(200);  // second price
  });

  it('starts a bilateral negotiation and makes an offer', () => {
    const buyer = makeAgent('buyer');
    const seller = makeAgent('seller');

    const neg = engine.startNegotiation({
      issues: [{ issueId: 'price', name: 'Price', valueRange: { min: 50, max: 200 }, weight: 1, resolution: 1 }],
      buyerAgentId: buyer.agentId,
      sellerAgentId: seller.agentId,
      protocol: 'bilateral',
      maxRounds: 10,
      deadline: Date.now() + 600_000,
    });

    expect(neg.negotiationId).toMatch(/^neg_/);
    expect(neg.status).toBe('open');

    const offer = engine.makeOffer(neg.negotiationId, buyer.agentId, { price: 80 });
    expect(offer.offerId).toMatch(/^offer_/);
    expect(offer.fromAgentId).toBe(buyer.agentId);
    expect(neg.currentRound).toBe(1);
  });

  it('accepts an offer and completes negotiation', () => {
    const buyer = makeAgent('buyer');
    const seller = makeAgent('seller');

    const neg = engine.startNegotiation({
      issues: [{ issueId: 'price', name: 'Price', valueRange: { min: 50, max: 200 }, weight: 1, resolution: 1 }],
      buyerAgentId: buyer.agentId,
      sellerAgentId: seller.agentId,
      protocol: 'bilateral',
      maxRounds: 10,
      deadline: Date.now() + 600_000,
    });

    const offer = engine.makeOffer(neg.negotiationId, buyer.agentId, { price: 150 });
    engine.respondToOffer(offer.offerId, neg.negotiationId, true);

    expect(neg.status).toBe('completed');
    expect(neg.agreement).toEqual({ price: 150 });
  });

  it('auto-negotiates a bilateral deal', () => {
    const buyer = makeAgent('buyer');
    const seller = makeAgent('seller');

    const neg = engine.startNegotiation({
      issues: [{ issueId: 'price', name: 'Price', valueRange: { min: 100, max: 500 }, weight: 1, resolution: 10 }],
      buyerAgentId: buyer.agentId,
      sellerAgentId: seller.agentId,
      protocol: 'multi_issue',
      maxRounds: 5,
      deadline: Date.now() + 600_000,
    });

    const result = engine.autoNegotiate(neg.negotiationId);
    expect(['completed', 'failed']).toContain(result.status);
  });

  it('creates coalition game and computes Shapley values', () => {
    const agents = ['a1', 'a2', 'a3'];
    const game = engine.createCoalitionGame(agents, {
      '': 0,
      'a1': 10,
      'a2': 20,
      'a3': 30,
      'a1,a2': 40,
      'a1,a3': 50,
      'a2,a3': 60,
      'a1,a2,a3': 80,
    });

    const shapley = engine.computeShapleyValues(game.gameId);
    expect(shapley['a1']).toBeDefined();
    expect(shapley['a2']).toBeDefined();
    expect(shapley['a3']).toBeDefined();

    const total = Object.values(shapley).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(80, 0);
  });

  it('computes Nash equilibrium from payoff matrix', () => {
    const payoff = {
      playerA: { cooperate: 3, defect: 5 },
      playerB: { cooperate: 3, defect: 1 },
    };
    const eq = engine.computeNashEquilibrium('game1', payoff);
    expect(eq.strategies['playerA']).toBe('defect');
    expect(eq.strategies['playerB']).toBe('cooperate');
    expect(typeof eq.isParetOptimal).toBe('boolean');
  });

  it('returns dashboard summary', () => {
    makeAgent('buyer');
    const summary = engine.getDashboardSummary();
    expect(summary.totalAgents).toBeGreaterThanOrEqual(1);
    expect(typeof summary.negotiationSuccessRate).toBe('number');
  });
});
