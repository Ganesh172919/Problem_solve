import { getLogger } from '../lib/logger';

const logger = getLogger();

// ─── Types ────────────────────────────────────────────────────────────────────

export enum NodeRole { Follower = 'follower', Candidate = 'candidate', Leader = 'leader' }

export interface LogEntry {
  term: number;
  index: number;
  command: string;
  data: unknown;
  timestamp: number;
}

export interface Snapshot {
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  state: Record<string, unknown>;
  createdAt: number;
}

export interface NodeInfo {
  id: string;
  address: string;
  isVoter: boolean;
  lastHeartbeat: number;
}

export interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
  matchIndex: number;
  nodeId: string;
}

export interface RequestVoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResponse {
  term: number;
  voteGranted: boolean;
  nodeId: string;
}

export interface ClientRequest {
  id: string;
  command: string;
  data: unknown;
  timestamp: number;
}

export interface ClientResponse {
  success: boolean;
  leaderId: string | null;
  result?: unknown;
  error?: string;
}

export interface ConsensusConfig {
  nodeId: string;
  electionTimeoutMin: number;
  electionTimeoutMax: number;
  heartbeatInterval: number;
  maxLogEntries: number;
  snapshotThreshold: number;
}

export interface ClusterState {
  currentTerm: number;
  role: NodeRole;
  leaderId: string | null;
  votedFor: string | null;
  commitIndex: number;
  lastApplied: number;
  log: LogEntry[];
  nodes: Map<string, NodeInfo>;
}

// ─── Consensus Manager ───────────────────────────────────────────────────────

const DEFAULTS: Omit<ConsensusConfig, 'nodeId'> = {
  electionTimeoutMin: 150,
  electionTimeoutMax: 300,
  heartbeatInterval: 50,
  maxLogEntries: 10000,
  snapshotThreshold: 1000,
};

export class DistributedConsensusManager {
  private nodeId: string;
  private currentTerm = 0;
  private role: NodeRole = NodeRole.Follower;
  private votedFor: string | null = null;
  private leaderId: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = -1;
  private lastApplied = -1;
  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();
  private nodes: Map<string, NodeInfo> = new Map();
  private votesReceived: Set<string> = new Set();
  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: ConsensusConfig;
  private stateMachine: Map<string, unknown> = new Map();
  private snapshot: Snapshot | null = null;
  private pendingRequests: Map<string, { resolve: (r: ClientResponse) => void; index: number }> = new Map();
  private running = false;
  private jointConfig: { oldNodes: Set<string>; newNodes: Set<string> } | null = null;
  private messageHandler: ((target: string, type: string, payload: unknown) => Promise<unknown>) | null = null;

  constructor(config: Partial<ConsensusConfig> & { nodeId: string }) {
    this.config = { ...DEFAULTS, ...config };
    this.nodeId = this.config.nodeId;
    this.nodes.set(this.nodeId, { id: this.nodeId, address: `node://${this.nodeId}`, isVoter: true, lastHeartbeat: Date.now() });
    logger.info('Consensus node initialized', { nodeId: this.nodeId });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.role = NodeRole.Follower;
    this.resetElectionTimer();
    logger.info('Consensus node started', { nodeId: this.nodeId });
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.rejectPendingRequests('Node shutting down');
    logger.info('Consensus node stopped', { nodeId: this.nodeId });
  }

  setMessageHandler(handler: (target: string, type: string, payload: unknown) => Promise<unknown>): void {
    this.messageHandler = handler;
  }

  // ─── Election Timer ───────────────────────────────────────────────────

  private resetElectionTimer(): void {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (!this.running) return;
    const timeout = this.config.electionTimeoutMin +
      Math.floor(Math.random() * (this.config.electionTimeoutMax - this.config.electionTimeoutMin));
    this.electionTimer = setTimeout(() => this.onElectionTimeout(), timeout);
  }

  private clearTimers(): void {
    if (this.electionTimer) { clearTimeout(this.electionTimer); this.electionTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  // ─── Election Logic ───────────────────────────────────────────────────

  private onElectionTimeout(): void {
    if (!this.running || this.role === NodeRole.Leader) return;
    logger.info('Election timeout, starting election', { nodeId: this.nodeId, term: this.currentTerm + 1 });
    this.startElection();
  }

  private startElection(): void {
    this.currentTerm++;
    this.role = NodeRole.Candidate;
    this.votedFor = this.nodeId;
    this.leaderId = null;
    this.votesReceived.clear();
    this.votesReceived.add(this.nodeId);

    if (this.getVoterCount() === 1) { this.becomeLeader(); return; }

    this.resetElectionTimer();
    const req: RequestVoteRequest = {
      term: this.currentTerm, candidateId: this.nodeId,
      lastLogIndex: this.getLastLogIndex(), lastLogTerm: this.getLastLogTerm(),
    };
    for (const [peerId, node] of this.nodes) {
      if (peerId !== this.nodeId && node.isVoter) this.sendRequestVote(peerId, req);
    }
  }

  private async sendRequestVote(peerId: string, req: RequestVoteRequest): Promise<void> {
    try {
      const res = await this.sendMessage(peerId, 'requestVote', req) as RequestVoteResponse | null;
      if (res && this.running) this.handleVoteResponse(res);
    } catch { logger.warn('Failed to send RequestVote', { nodeId: this.nodeId, target: peerId }); }
  }

  handleRequestVote(req: RequestVoteRequest): RequestVoteResponse {
    const res: RequestVoteResponse = { term: this.currentTerm, voteGranted: false, nodeId: this.nodeId };
    if (req.term < this.currentTerm) return res;
    if (req.term > this.currentTerm) this.stepDown(req.term);

    const canVote = this.votedFor === null || this.votedFor === req.candidateId;
    const myLastTerm = this.getLastLogTerm();
    const logOk = req.lastLogTerm > myLastTerm ||
      (req.lastLogTerm === myLastTerm && req.lastLogIndex >= this.getLastLogIndex());

    if (canVote && logOk) {
      this.votedFor = req.candidateId;
      res.voteGranted = true;
      this.resetElectionTimer();
      logger.info('Vote granted', { nodeId: this.nodeId, candidate: req.candidateId, term: req.term });
    }
    res.term = this.currentTerm;
    return res;
  }

  private handleVoteResponse(res: RequestVoteResponse): void {
    if (this.role !== NodeRole.Candidate) return;
    if (res.term > this.currentTerm) { this.stepDown(res.term); return; }
    if (res.term !== this.currentTerm) return;
    if (res.voteGranted) {
      this.votesReceived.add(res.nodeId);
      logger.info('Vote received', { nodeId: this.nodeId, from: res.nodeId, votes: this.votesReceived.size, needed: this.quorumSize() });
      if (this.votesReceived.size >= this.quorumSize()) this.becomeLeader();
    }
  }

  // ─── Leader Transition ────────────────────────────────────────────────

  private becomeLeader(): void {
    this.role = NodeRole.Leader;
    this.leaderId = this.nodeId;
    if (this.electionTimer) { clearTimeout(this.electionTimer); this.electionTimer = null; }
    const lastIdx = this.getLastLogIndex();
    for (const [pid] of this.nodes) {
      if (pid !== this.nodeId) { this.nextIndex.set(pid, lastIdx + 1); this.matchIndex.set(pid, -1); }
    }
    logger.info('Became leader', { nodeId: this.nodeId, term: this.currentTerm });
    this.appendToLog('__noop__', null); // Commit index advancement
    this.startHeartbeat();
  }

  private stepDown(newTerm: number): void {
    const wasLeader = this.role === NodeRole.Leader;
    this.currentTerm = newTerm;
    this.role = NodeRole.Follower;
    this.votedFor = null;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.resetElectionTimer();
    if (wasLeader) { this.rejectPendingRequests('Leadership lost'); logger.warn('Stepped down from leader', { nodeId: this.nodeId, newTerm }); }
  }

  // ─── Heartbeat / AppendEntries ────────────────────────────────────────

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.role === NodeRole.Leader && this.running) this.sendHeartbeats();
    }, this.config.heartbeatInterval);
    this.sendHeartbeats();
  }

  private sendHeartbeats(): void {
    for (const [pid, node] of this.nodes) {
      if (pid !== this.nodeId) { this.sendAppendEntries(pid); node.lastHeartbeat = Date.now(); }
    }
  }

  private async sendAppendEntries(peerId: string): Promise<void> {
    if (this.role !== NodeRole.Leader) return;
    const nextIdx = this.nextIndex.get(peerId) ?? 0;
    const prevLogIndex = nextIdx - 1;
    const req: AppendEntriesRequest = {
      term: this.currentTerm, leaderId: this.nodeId, prevLogIndex,
      prevLogTerm: this.termAt(prevLogIndex),
      entries: this.log.slice(Math.max(0, nextIdx - this.logOffset())),
      leaderCommit: this.commitIndex,
    };
    try {
      const res = await this.sendMessage(peerId, 'appendEntries', req) as AppendEntriesResponse | null;
      if (res && this.running) this.handleAppendResponse(peerId, res);
    } catch { logger.warn('Failed to send AppendEntries', { nodeId: this.nodeId, target: peerId }); }
  }

  handleAppendEntries(req: AppendEntriesRequest): AppendEntriesResponse {
    const res: AppendEntriesResponse = { term: this.currentTerm, success: false, matchIndex: -1, nodeId: this.nodeId };
    if (req.term < this.currentTerm) return res;
    if (req.term > this.currentTerm || this.role === NodeRole.Candidate) this.stepDown(req.term);
    this.leaderId = req.leaderId;
    this.resetElectionTimer();

    // Log consistency check
    if (req.prevLogIndex >= 0) {
      const localTerm = this.termAt(req.prevLogIndex);
      if (localTerm === -1 || localTerm !== req.prevLogTerm) return res;
    }

    // Append entries with term-based conflict resolution
    for (const entry of req.entries) {
      const li = entry.index - this.logOffset();
      if (li >= 0 && li < this.log.length) {
        if (this.log[li].term !== entry.term) {
          this.log.splice(li); // Truncate conflicting suffix
          this.log.push(entry);
        }
      } else {
        this.log.push(entry);
      }
    }

    if (req.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(req.leaderCommit, this.getLastLogIndex());
      this.applyCommitted();
    }
    res.success = true;
    res.term = this.currentTerm;
    res.matchIndex = this.getLastLogIndex();
    return res;
  }

  private handleAppendResponse(peerId: string, res: AppendEntriesResponse): void {
    if (this.role !== NodeRole.Leader) return;
    if (res.term > this.currentTerm) { this.stepDown(res.term); return; }
    if (res.success) {
      this.matchIndex.set(peerId, res.matchIndex);
      this.nextIndex.set(peerId, res.matchIndex + 1);
      this.advanceCommitIndex();
    } else {
      const cur = this.nextIndex.get(peerId) ?? 1;
      this.nextIndex.set(peerId, Math.max(0, cur - 1));
    }
  }

  // ─── Commit Index ─────────────────────────────────────────────────────

  private advanceCommitIndex(): void {
    const voters = this.getVoterIds();
    for (let n = this.getLastLogIndex(); n > this.commitIndex; n--) {
      if (this.termAt(n) !== this.currentTerm) continue;
      let count = 1;
      for (const pid of voters) {
        if (pid !== this.nodeId && (this.matchIndex.get(pid) ?? -1) >= n) count++;
      }
      if (count >= this.quorumSize()) {
        this.commitIndex = n;
        this.applyCommitted();
        this.resolvePendingRequests();
        logger.debug('Commit index advanced', { nodeId: this.nodeId, commitIndex: n });
        break;
      }
    }
  }

  private applyCommitted(): void {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const li = this.lastApplied - this.logOffset();
      if (li < 0 || li >= this.log.length) continue;
      const entry = this.log[li];
      if (entry.command !== '__noop__' && entry.command !== '__joint_config__' && entry.command !== '__new_config__') {
        this.stateMachine.set(`${entry.command}:${entry.index}`, entry.data);
      }
    }
  }

  // ─── Client Requests ──────────────────────────────────────────────────

  async submitRequest(req: ClientRequest): Promise<ClientResponse> {
    if (!this.running) return { success: false, leaderId: this.leaderId, error: 'Node not running' };
    if (this.role !== NodeRole.Leader) {
      if (!this.leaderId) return { success: false, leaderId: null, error: 'No known leader' };
      try {
        return await this.sendMessage(this.leaderId, 'clientRequest', req) as ClientResponse;
      } catch { return { success: false, leaderId: this.leaderId, error: 'Failed to forward to leader' }; }
    }
    return new Promise<ClientResponse>((resolve) => {
      const index = this.appendToLog(req.command, req.data);
      this.pendingRequests.set(req.id, { resolve, index });
      this.sendHeartbeats();
      setTimeout(() => {
        if (this.pendingRequests.has(req.id)) {
          this.pendingRequests.delete(req.id);
          resolve({ success: false, leaderId: this.leaderId, error: 'Request timed out' });
        }
      }, this.config.electionTimeoutMax * 2);
    });
  }

  private resolvePendingRequests(): void {
    for (const [id, { resolve, index }] of this.pendingRequests) {
      if (index <= this.commitIndex) { resolve({ success: true, leaderId: this.nodeId }); this.pendingRequests.delete(id); }
    }
  }

  private rejectPendingRequests(reason: string): void {
    for (const [, { resolve }] of this.pendingRequests) resolve({ success: false, leaderId: null, error: reason });
    this.pendingRequests.clear();
  }

  // ─── Linearizable Reads ───────────────────────────────────────────────

  async linearizableRead(key: string): Promise<unknown | null> {
    if (this.role !== NodeRole.Leader) throw new Error('Linearizable reads require the leader');
    const voters = this.getVoterIds().filter((id) => id !== this.nodeId);
    if (voters.length === 0) return this.stateMachine.get(key) ?? null;

    let acks = 1;
    const heartbeat: AppendEntriesRequest = {
      term: this.currentTerm, leaderId: this.nodeId,
      prevLogIndex: this.getLastLogIndex(), prevLogTerm: this.getLastLogTerm(),
      entries: [], leaderCommit: this.commitIndex,
    };
    await Promise.allSettled(voters.map(async (pid) => {
      try {
        const r = await this.sendMessage(pid, 'appendEntries', heartbeat) as AppendEntriesResponse | null;
        if (r?.success && r.term === this.currentTerm) acks++;
      } catch { /* unreachable */ }
    }));

    if (acks < this.quorumSize()) throw new Error('Failed to confirm leadership for read');
    return this.stateMachine.get(key) ?? null;
  }

  // ─── Log Helpers ──────────────────────────────────────────────────────

  private appendToLog(command: string, data: unknown): number {
    const index = this.getLastLogIndex() + 1;
    this.log.push({ term: this.currentTerm, index, command, data, timestamp: Date.now() });
    if (this.log.length > this.config.maxLogEntries) this.compactLog();
    return index;
  }

  private getLastLogIndex(): number {
    return this.log.length > 0 ? this.log[this.log.length - 1].index : (this.snapshot?.lastIncludedIndex ?? -1);
  }

  private getLastLogTerm(): number {
    return this.log.length > 0 ? this.log[this.log.length - 1].term : (this.snapshot?.lastIncludedTerm ?? 0);
  }

  private termAt(index: number): number {
    if (index < 0) return 0;
    if (this.snapshot && index === this.snapshot.lastIncludedIndex) return this.snapshot.lastIncludedTerm;
    const li = index - this.logOffset();
    return (li >= 0 && li < this.log.length) ? this.log[li].term : -1;
  }

  private logOffset(): number {
    return this.log.length > 0 ? this.log[0].index : 0;
  }

  // ─── Snapshot / Log Compaction ────────────────────────────────────────

  private compactLog(): void {
    const compactUpTo = Math.min(this.lastApplied, this.commitIndex);
    const idx = compactUpTo - this.logOffset();
    if (idx <= 0 || !this.log[idx]) return;
    const entry = this.log[idx];
    this.snapshot = {
      lastIncludedIndex: entry.index, lastIncludedTerm: entry.term,
      state: Object.fromEntries(this.stateMachine), createdAt: Date.now(),
    };
    this.log = this.log.slice(idx + 1);
    logger.info('Log compacted', { nodeId: this.nodeId, snapshotIndex: entry.index, remaining: this.log.length });
  }

  createSnapshot(): Snapshot | null { this.compactLog(); return this.snapshot; }

  installSnapshot(snap: Snapshot): boolean {
    if (snap.lastIncludedIndex <= (this.snapshot?.lastIncludedIndex ?? -1)) return false;
    const overlap = this.log.findIndex((e) => e.index > snap.lastIncludedIndex);
    this.log = overlap > 0 ? this.log.slice(overlap) : (overlap === -1 ? [] : this.log);
    this.snapshot = snap;
    this.stateMachine = new Map(Object.entries(snap.state));
    this.lastApplied = snap.lastIncludedIndex;
    if (this.commitIndex < snap.lastIncludedIndex) this.commitIndex = snap.lastIncludedIndex;
    logger.info('Snapshot installed', { nodeId: this.nodeId, snapshotIndex: snap.lastIncludedIndex });
    return true;
  }

  // ─── Cluster Membership ───────────────────────────────────────────────

  addNode(nodeId: string, address: string, isVoter = true): void {
    if (this.nodes.has(nodeId)) return;
    this.nodes.set(nodeId, { id: nodeId, address, isVoter, lastHeartbeat: Date.now() });
    if (this.role === NodeRole.Leader) { this.nextIndex.set(nodeId, this.getLastLogIndex() + 1); this.matchIndex.set(nodeId, -1); }
    logger.info('Node added', { nodeId: this.nodeId, added: nodeId, isVoter });
  }

  removeNode(nodeId: string): void {
    if (nodeId === this.nodeId) return;
    this.nodes.delete(nodeId);
    this.nextIndex.delete(nodeId);
    this.matchIndex.delete(nodeId);
    logger.info('Node removed', { nodeId: this.nodeId, removed: nodeId });
  }

  // ─── Joint Consensus ─────────────────────────────────────────────────

  async beginMembershipChange(newVoterIds: string[]): Promise<boolean> {
    if (this.role !== NodeRole.Leader || this.jointConfig !== null) return false;
    const oldVoters = new Set(this.getVoterIds());
    const newVoters = new Set(newVoterIds);
    this.jointConfig = { oldNodes: oldVoters, newNodes: newVoters };

    const jointIdx = this.appendToLog('__joint_config__', { oldVoters: [...oldVoters], newVoters: newVoterIds });
    logger.info('Joint consensus initiated', { nodeId: this.nodeId, jointIdx, oldSize: oldVoters.size, newSize: newVoters.size });
    this.sendHeartbeats();

    return new Promise<boolean>((resolve) => {
      const check = setInterval(() => {
        if (this.commitIndex >= jointIdx) {
          clearInterval(check);
          this.finalizeMembership(newVoterIds);
          resolve(true);
        }
        if (!this.running || this.role !== NodeRole.Leader) { clearInterval(check); this.jointConfig = null; resolve(false); }
      }, this.config.heartbeatInterval);
    });
  }

  private finalizeMembership(newVoterIds: string[]): void {
    for (const [id, node] of this.nodes) node.isVoter = newVoterIds.includes(id);
    this.appendToLog('__new_config__', { voters: newVoterIds });
    this.jointConfig = null;
    logger.info('Membership change finalized', { nodeId: this.nodeId, voters: newVoterIds });
    if (!newVoterIds.includes(this.nodeId)) this.stepDown(this.currentTerm);
    this.sendHeartbeats();
  }

  // ─── Split-Brain Protection ───────────────────────────────────────────

  detectSplitBrain(): boolean {
    if (this.role !== NodeRole.Leader) return false;
    const now = Date.now();
    const threshold = this.config.electionTimeoutMax * 2;
    let reachable = 1;
    for (const [pid, node] of this.nodes) {
      if (pid !== this.nodeId && node.isVoter && now - node.lastHeartbeat < threshold) reachable++;
    }
    if (reachable < this.quorumSize()) {
      logger.warn('Split-brain detected: lost quorum', { nodeId: this.nodeId, reachable, needed: this.quorumSize() });
      this.stepDown(this.currentTerm);
      return true;
    }
    return false;
  }

  // ─── Quorum ───────────────────────────────────────────────────────────

  private quorumSize(): number {
    if (this.jointConfig) {
      return Math.max(
        Math.floor(this.jointConfig.oldNodes.size / 2) + 1,
        Math.floor(this.jointConfig.newNodes.size / 2) + 1,
      );
    }
    return Math.floor(this.getVoterCount() / 2) + 1;
  }

  private getVoterCount(): number {
    let c = 0;
    for (const n of this.nodes.values()) if (n.isVoter) c++;
    return c;
  }

  private getVoterIds(): string[] {
    const ids: string[] = [];
    for (const [id, n] of this.nodes) if (n.isVoter) ids.push(id);
    return ids;
  }

  private async sendMessage(target: string, type: string, payload: unknown): Promise<unknown> {
    if (!this.messageHandler) return null;
    return this.messageHandler(target, type, payload);
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  getState(): ClusterState {
    return {
      currentTerm: this.currentTerm, role: this.role, leaderId: this.leaderId,
      votedFor: this.votedFor, commitIndex: this.commitIndex, lastApplied: this.lastApplied,
      log: [...this.log], nodes: new Map(this.nodes),
    };
  }

  getRole(): NodeRole { return this.role; }
  getCurrentTerm(): number { return this.currentTerm; }
  getLeaderId(): string | null { return this.leaderId; }
  getNodeId(): string { return this.nodeId; }
  getCommitIndex(): number { return this.commitIndex; }
  getLogLength(): number { return this.log.length; }
  getStateMachineSnapshot(): Record<string, unknown> { return Object.fromEntries(this.stateMachine); }
  isRunning(): boolean { return this.running; }
  getSnapshot(): Snapshot | null { return this.snapshot; }
  getClusterSize(): number { return this.nodes.size; }
  getVoterNodeIds(): string[] { return this.getVoterIds(); }
}

// ─── In-Memory Cluster Simulation ───────────────────────────────────────────

export class ConsensusCluster {
  private nodes: Map<string, DistributedConsensusManager> = new Map();
  private partitions: Set<string> = new Set();

  createNode(nodeId: string, config?: Partial<ConsensusConfig>): DistributedConsensusManager {
    const mgr = new DistributedConsensusManager({ nodeId, ...config });
    mgr.setMessageHandler(async (target, type, payload) => this.route(nodeId, target, type, payload));
    for (const [eid, en] of this.nodes) {
      en.addNode(nodeId, `node://${nodeId}`);
      mgr.addNode(eid, `node://${eid}`);
    }
    this.nodes.set(nodeId, mgr);
    logger.info('Cluster node created', { nodeId, clusterSize: this.nodes.size });
    return mgr;
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.stop();
    this.nodes.delete(nodeId);
    for (const [, n] of this.nodes) n.removeNode(nodeId);
  }

  private async route(from: string, to: string, type: string, payload: unknown): Promise<unknown> {
    const key = [from, to].sort().join(':');
    if (this.partitions.has(key)) throw new Error(`Network partition between ${from} and ${to}`);
    const target = this.nodes.get(to);
    if (!target) throw new Error(`Node ${to} not found`);
    switch (type) {
      case 'requestVote': return target.handleRequestVote(payload as RequestVoteRequest);
      case 'appendEntries': return target.handleAppendEntries(payload as AppendEntriesRequest);
      case 'clientRequest': return target.submitRequest(payload as ClientRequest);
      default: throw new Error(`Unknown message type: ${type}`);
    }
  }

  simulatePartition(a: string, b: string): void {
    this.partitions.add([a, b].sort().join(':'));
    logger.warn('Network partition simulated', { nodeA: a, nodeB: b });
  }

  healPartition(a: string, b: string): void {
    this.partitions.delete([a, b].sort().join(':'));
    logger.info('Network partition healed', { nodeA: a, nodeB: b });
  }

  startAll(): void { for (const [, n] of this.nodes) n.start(); }
  stopAll(): void { for (const [, n] of this.nodes) n.stop(); }
  getNode(id: string): DistributedConsensusManager | undefined { return this.nodes.get(id); }
  getLeader(): DistributedConsensusManager | undefined {
    for (const [, n] of this.nodes) if (n.getRole() === NodeRole.Leader) return n;
    return undefined;
  }
  getAllNodeIds(): string[] { return [...this.nodes.keys()]; }
  getClusterSize(): number { return this.nodes.size; }
}
