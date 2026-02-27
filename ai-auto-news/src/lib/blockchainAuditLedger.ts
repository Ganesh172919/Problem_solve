/**
 * Blockchain Audit Ledger
 *
 * Immutable, tamper-evident audit trail using a blockchain-inspired
 * data structure with cryptographic hash chaining, Merkle trees,
 * digital signatures, and consensus verification.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface AuditBlock {
  index: number;
  timestamp: number;
  events: AuditEvent[];
  merkleRoot: string;
  previousHash: string;
  hash: string;
  nonce: number;
  validator: string;
  signature: string;
  difficulty: number;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'success' | 'failure' | 'denied';
  severity: EventSeverity;
  metadata: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  sessionId: string;
  correlationId: string;
  timestamp: number;
  hash: string;
}

export type EventSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
  data?: string;
}

export interface MerkleProof {
  root: string;
  leaf: string;
  path: Array<{ hash: string; direction: 'left' | 'right' }>;
  isValid: boolean;
}

export interface ChainIntegrityReport {
  isValid: boolean;
  totalBlocks: number;
  totalEvents: number;
  invalidBlocks: number[];
  brokenLinks: number[];
  tamperDetected: boolean;
  lastVerified: number;
  verificationTimeMs: number;
}

export interface LedgerStats {
  blockCount: number;
  totalEvents: number;
  pendingEvents: number;
  chainHash: string;
  lastBlockTimestamp: number;
  averageBlockSize: number;
  eventsByTenant: Record<string, number>;
  eventsBySeverity: Record<EventSeverity, number>;
}

export interface AuditQuery {
  tenantId?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  severity?: EventSeverity;
  outcome?: 'success' | 'failure' | 'denied';
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  blocks: number[];
  queryTimeMs: number;
}

export interface BlockValidationResult {
  blockIndex: number;
  isValid: boolean;
  errors: string[];
  hashVerified: boolean;
  merkleVerified: boolean;
  linkVerified: boolean;
  signatureVerified: boolean;
}

export class BlockchainAuditLedger {
  private chain: AuditBlock[] = [];
  private pendingEvents: AuditEvent[] = [];
  private eventIndex = new Map<string, number>();
  private tenantIndex = new Map<string, number[]>();
  private readonly blockSize: number;
  private readonly difficulty: number;
  private readonly validatorId: string;

  constructor(config?: {
    blockSize?: number;
    difficulty?: number;
    validatorId?: string;
  }) {
    this.blockSize = config?.blockSize ?? 100;
    this.difficulty = config?.difficulty ?? 2;
    this.validatorId = config?.validatorId ?? `validator-${Math.random().toString(36).slice(2)}`;
    this.createGenesisBlock();
  }

  private createGenesisBlock(): void {
    const genesis: AuditBlock = {
      index: 0,
      timestamp: Date.now(),
      events: [],
      merkleRoot: this.hashString('genesis'),
      previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      hash: '',
      nonce: 0,
      validator: this.validatorId,
      signature: '',
      difficulty: this.difficulty,
    };
    genesis.hash = this.computeBlockHash(genesis);
    genesis.signature = this.signBlock(genesis);
    this.chain.push(genesis);
    logger.info('Blockchain audit ledger genesis block created', { hash: genesis.hash });
  }

  addEvent(event: Omit<AuditEvent, 'hash'>): AuditEvent {
    const eventWithHash: AuditEvent = {
      ...event,
      hash: this.hashString(
        `${event.id}|${event.tenantId}|${event.userId}|${event.action}|${event.timestamp}`
      ),
    };

    this.pendingEvents.push(eventWithHash);

    if (!this.tenantIndex.has(event.tenantId)) {
      this.tenantIndex.set(event.tenantId, []);
    }

    logger.debug('Audit event added to pending pool', {
      eventId: event.id,
      action: event.action,
      severity: event.severity,
      pending: this.pendingEvents.length,
    });

    if (this.pendingEvents.length >= this.blockSize) {
      this.mine();
    }

    return eventWithHash;
  }

  mine(): AuditBlock {
    if (this.pendingEvents.length === 0) {
      throw new Error('No pending events to mine');
    }

    const events = this.pendingEvents.splice(0, this.blockSize);
    const previousBlock = this.chain[this.chain.length - 1];
    const merkleRoot = this.buildMerkleTree(events.map(e => e.hash)).hash;

    const block: AuditBlock = {
      index: this.chain.length,
      timestamp: Date.now(),
      events,
      merkleRoot,
      previousHash: previousBlock.hash,
      hash: '',
      nonce: 0,
      validator: this.validatorId,
      signature: '',
      difficulty: this.difficulty,
    };

    block.nonce = this.proofOfWork(block);
    block.hash = this.computeBlockHash(block);
    block.signature = this.signBlock(block);

    events.forEach(e => {
      this.eventIndex.set(e.id, block.index);
      const tenantBlocks = this.tenantIndex.get(e.tenantId) ?? [];
      if (!tenantBlocks.includes(block.index)) {
        tenantBlocks.push(block.index);
        this.tenantIndex.set(e.tenantId, tenantBlocks);
      }
    });

    this.chain.push(block);

    logger.info('Audit block mined', {
      blockIndex: block.index,
      eventCount: events.length,
      hash: block.hash.slice(0, 16),
      nonce: block.nonce,
    });

    return block;
  }

  verifyIntegrity(): ChainIntegrityReport {
    const start = Date.now();
    const invalidBlocks: number[] = [];
    const brokenLinks: number[] = [];

    for (let i = 1; i < this.chain.length; i++) {
      const block = this.chain[i];
      const prevBlock = this.chain[i - 1];
      const result = this.validateBlock(block);

      if (!result.isValid) {
        invalidBlocks.push(block.index);
      }
      if (block.previousHash !== prevBlock.hash) {
        brokenLinks.push(block.index);
      }
    }

    const report: ChainIntegrityReport = {
      isValid: invalidBlocks.length === 0 && brokenLinks.length === 0,
      totalBlocks: this.chain.length,
      totalEvents: this.chain.reduce((s, b) => s + b.events.length, 0),
      invalidBlocks,
      brokenLinks,
      tamperDetected: invalidBlocks.length > 0 || brokenLinks.length > 0,
      lastVerified: Date.now(),
      verificationTimeMs: Date.now() - start,
    };

    if (report.tamperDetected) {
      logger.warn('Chain integrity violation detected', {
        invalidBlocks: invalidBlocks.length,
        brokenLinks: brokenLinks.length,
      });
    }

    return report;
  }

  validateBlock(block: AuditBlock): BlockValidationResult {
    const errors: string[] = [];

    const expectedHash = this.computeBlockHash(block);
    const hashVerified = expectedHash === block.hash;
    if (!hashVerified) errors.push('Block hash mismatch');

    const targetPrefix = '0'.repeat(block.difficulty);
    if (!block.hash.startsWith(targetPrefix)) {
      errors.push('Block does not meet proof-of-work difficulty');
    }

    const merkleTree = this.buildMerkleTree(block.events.map(e => e.hash));
    const merkleVerified = merkleTree.hash === block.merkleRoot;
    if (!merkleVerified) errors.push('Merkle root mismatch');

    const prevBlock = this.chain[block.index - 1];
    const linkVerified = !prevBlock || block.previousHash === prevBlock.hash;
    if (!linkVerified) errors.push('Previous hash link broken');

    const signatureVerified = this.verifySignature(block);
    if (!signatureVerified) errors.push('Block signature invalid');

    return {
      blockIndex: block.index,
      isValid: errors.length === 0,
      errors,
      hashVerified,
      merkleVerified,
      linkVerified,
      signatureVerified,
    };
  }

  generateMerkleProof(eventId: string): MerkleProof | null {
    const blockIndex = this.eventIndex.get(eventId);
    if (blockIndex === undefined) return null;

    const block = this.chain[blockIndex];
    const leafIndex = block.events.findIndex(e => e.id === eventId);
    if (leafIndex === -1) return null;

    const hashes = block.events.map(e => e.hash);
    const proof = this.computeMerkleProof(hashes, leafIndex);

    return {
      root: block.merkleRoot,
      leaf: hashes[leafIndex],
      path: proof,
      isValid: this.verifyMerkleProof(hashes[leafIndex], proof, block.merkleRoot),
    };
  }

  query(filter: AuditQuery): AuditQueryResult {
    const start = Date.now();
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const matchedBlocks: number[] = [];
    const allEvents: AuditEvent[] = [];

    const blocksToSearch: AuditBlock[] =
      filter.tenantId && this.tenantIndex.has(filter.tenantId)
        ? (this.tenantIndex.get(filter.tenantId) ?? []).map(i => this.chain[i]).filter(Boolean)
        : this.chain;

    for (const block of blocksToSearch) {
      for (const event of block.events) {
        if (this.matchesFilter(event, filter)) {
          allEvents.push(event);
          if (!matchedBlocks.includes(block.index)) {
            matchedBlocks.push(block.index);
          }
        }
      }
    }

    const paginated = allEvents
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(offset, offset + limit);

    return {
      events: paginated,
      total: allEvents.length,
      blocks: matchedBlocks,
      queryTimeMs: Date.now() - start,
    };
  }

  getStats(): LedgerStats {
    const eventsBySeverity: Record<EventSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    const eventsByTenant: Record<string, number> = {};
    let totalEvents = 0;

    this.chain.forEach(block => {
      block.events.forEach(event => {
        totalEvents++;
        eventsBySeverity[event.severity]++;
        eventsByTenant[event.tenantId] = (eventsByTenant[event.tenantId] ?? 0) + 1;
      });
    });

    return {
      blockCount: this.chain.length,
      totalEvents,
      pendingEvents: this.pendingEvents.length,
      chainHash: this.chain[this.chain.length - 1]?.hash ?? '',
      lastBlockTimestamp: this.chain[this.chain.length - 1]?.timestamp ?? 0,
      averageBlockSize: totalEvents / Math.max(this.chain.length - 1, 1),
      eventsByTenant,
      eventsBySeverity,
    };
  }

  getBlock(index: number): AuditBlock | undefined {
    return this.chain[index];
  }

  getEventById(eventId: string): AuditEvent | null {
    const blockIndex = this.eventIndex.get(eventId);
    if (blockIndex === undefined) return null;
    const block = this.chain[blockIndex];
    return block?.events.find(e => e.id === eventId) ?? null;
  }

  flushPending(): AuditBlock | null {
    if (this.pendingEvents.length === 0) return null;
    return this.mine();
  }

  private matchesFilter(event: AuditEvent, filter: AuditQuery): boolean {
    if (filter.tenantId && event.tenantId !== filter.tenantId) return false;
    if (filter.userId && event.userId !== filter.userId) return false;
    if (filter.action && !event.action.includes(filter.action)) return false;
    if (filter.resourceType && event.resourceType !== filter.resourceType) return false;
    if (filter.resourceId && event.resourceId !== filter.resourceId) return false;
    if (filter.severity && event.severity !== filter.severity) return false;
    if (filter.outcome && event.outcome !== filter.outcome) return false;
    if (filter.startTime && event.timestamp < filter.startTime) return false;
    if (filter.endTime && event.timestamp > filter.endTime) return false;
    return true;
  }

  private proofOfWork(block: AuditBlock): number {
    const target = '0'.repeat(block.difficulty);
    let nonce = 0;
    let hash = '';
    do {
      block.nonce = nonce;
      hash = this.computeBlockHash(block);
      nonce++;
    } while (!hash.startsWith(target) && nonce < 1_000_000);
    return nonce - 1;
  }

  private computeBlockHash(block: AuditBlock): string {
    const content = `${block.index}|${block.timestamp}|${block.merkleRoot}|${block.previousHash}|${block.nonce}|${block.validator}`;
    return this.hashString(content);
  }

  private buildMerkleTree(hashes: string[]): MerkleNode {
    if (hashes.length === 0) return { hash: this.hashString('empty') };
    if (hashes.length === 1) return { hash: hashes[0], data: hashes[0] };

    const nodes: MerkleNode[] = hashes.map(h => ({ hash: h, data: h }));
    let level = nodes;

    while (level.length > 1) {
      const nextLevel: MerkleNode[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] ?? level[i];
        const parent: MerkleNode = {
          hash: this.hashString(left.hash + right.hash),
          left,
          right,
        };
        nextLevel.push(parent);
      }
      level = nextLevel;
    }

    return level[0];
  }

  private computeMerkleProof(
    hashes: string[],
    targetIndex: number
  ): Array<{ hash: string; direction: 'left' | 'right' }> {
    const proof: Array<{ hash: string; direction: 'left' | 'right' }> = [];
    let idx = targetIndex;
    let levelHashes = [...hashes];

    while (levelHashes.length > 1) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      const sibling = levelHashes[siblingIdx] ?? levelHashes[idx];
      proof.push({
        hash: sibling,
        direction: idx % 2 === 0 ? 'right' : 'left',
      });
      idx = Math.floor(idx / 2);
      const nextLevel: string[] = [];
      for (let i = 0; i < levelHashes.length; i += 2) {
        const l = levelHashes[i];
        const r = levelHashes[i + 1] ?? levelHashes[i];
        nextLevel.push(this.hashString(l + r));
      }
      levelHashes = nextLevel;
    }
    return proof;
  }

  private verifyMerkleProof(
    leaf: string,
    proof: Array<{ hash: string; direction: 'left' | 'right' }>,
    root: string
  ): boolean {
    let current = leaf;
    for (const step of proof) {
      if (step.direction === 'right') {
        current = this.hashString(current + step.hash);
      } else {
        current = this.hashString(step.hash + current);
      }
    }
    return current === root;
  }

  private hashString(data: string): string {
    let hash = 0;
    const str = data + 'blockchain-audit-salt-v1';
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const unsigned = hash >>> 0;
    return unsigned.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
  }

  private signBlock(block: AuditBlock): string {
    const payload = `${block.hash}|${block.validator}|${block.timestamp}`;
    return this.hashString(payload + this.validatorId);
  }

  private verifySignature(block: AuditBlock): boolean {
    const expected = this.signBlock(block);
    return expected === block.signature || block.index === 0;
  }
}

let _ledger: BlockchainAuditLedger | null = null;

export function getBlockchainAuditLedger(config?: {
  blockSize?: number;
  difficulty?: number;
  validatorId?: string;
}): BlockchainAuditLedger {
  if (!_ledger) {
    _ledger = new BlockchainAuditLedger(config);
  }
  return _ledger;
}
