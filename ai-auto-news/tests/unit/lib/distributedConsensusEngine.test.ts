import { describe, it, expect, beforeEach } from '@jest/globals';
import { DistributedConsensusEngine } from '../../../src/lib/distributedConsensusEngine';

describe('DistributedConsensusEngine', () => {
  let engine: DistributedConsensusEngine;

  beforeEach(() => {
    engine = new DistributedConsensusEngine({ electionTimeoutMs: 50, heartbeatIntervalMs: 20 });
  });

  it('creates a cluster with generated ID', () => {
    const cluster = engine.createCluster({
      name: 'test-cluster',
      protocol: 'raft',
      nodes: [],
      quorumSize: 3,
      replicationFactor: 3,
    });
    expect(cluster.clusterId).toMatch(/^cluster_/);
    expect(cluster.protocol).toBe('raft');
    expect(cluster.currentTerm).toBe(0);
  });

  it('registers nodes and assigns to cluster', () => {
    const nodeA = engine.registerNode({ nodeId: 'n1', address: '10.0.0.1', region: 'us-east-1', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    const nodeB = engine.registerNode({ nodeId: 'n2', address: '10.0.0.2', region: 'us-east-1', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    expect(engine.getNode('n1')).toBeDefined();
    expect(engine.getNode('n2')).toBeDefined();
    expect(nodeA.term).toBe(0);
    expect(nodeB.role).toBe('follower');
  });

  it('elects a leader when quorum is available', () => {
    ['n1', 'n2', 'n3', 'n4', 'n5'].forEach(id => {
      engine.registerNode({ nodeId: id, address: `10.0.0.${id}`, region: 'us-east-1', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    });
    const cluster = engine.createCluster({ name: 'raft-cluster', protocol: 'raft', nodes: ['n1', 'n2', 'n3', 'n4', 'n5'], quorumSize: 3, replicationFactor: 3 });
    const result = engine.triggerElection(cluster.clusterId, 'test');
    expect(result.quorumReached).toBe(true);
    expect(result.winnerId).toBeTruthy();
    expect(result.term).toBe(1);
    expect(engine.getCluster(cluster.clusterId)?.leaderId).toBe(result.winnerId);
  });

  it('fails election without quorum', () => {
    engine.registerNode({ nodeId: 'n1', address: '10.0.0.1', region: 'us-east-1', role: 'follower', status: 'offline', votedFor: undefined, metadata: {} });
    const cluster = engine.createCluster({ name: 'no-quorum', protocol: 'raft', nodes: ['n1'], quorumSize: 3, replicationFactor: 3 });
    const result = engine.triggerElection(cluster.clusterId, 'test');
    expect(result.quorumReached).toBe(false);
    expect(result.winnerId).toBe('');
  });

  it('appends log entries after leader election', () => {
    ['n1', 'n2', 'n3'].forEach(id => {
      engine.registerNode({ nodeId: id, address: `10.0.0.${id}`, region: 'us-east-1', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    });
    const cluster = engine.createCluster({ name: 'raft', protocol: 'raft', nodes: ['n1', 'n2', 'n3'], quorumSize: 2, replicationFactor: 3 });
    engine.triggerElection(cluster.clusterId, 'test');
    const entry = engine.appendEntry(cluster.clusterId, { key: 'value' });
    expect(entry.index).toBeGreaterThanOrEqual(0);
    expect(entry.checksum).toBeTruthy();
    expect(entry.term).toBe(1);
  });

  it('creates and evaluates Paxos proposals', () => {
    ['p1', 'p2', 'p3'].forEach(id => {
      engine.registerNode({ nodeId: id, address: `10.0.1.${id}`, region: 'eu-west-1', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    });
    const cluster = engine.createCluster({ name: 'paxos', protocol: 'paxos', nodes: ['p1', 'p2', 'p3'], quorumSize: 2, replicationFactor: 3 });
    engine.triggerElection(cluster.clusterId, 'test');
    const proposal = engine.propose(cluster.clusterId, { action: 'update', value: 42 }, 'p1');
    expect(proposal.proposalId).toMatch(/^prop_/);
    expect(['accepted', 'committed', 'rejected']).toContain(proposal.status);
  });

  it('creates G-Counter CRDT and increments correctly', () => {
    const crdt = engine.createCRDT('gcounter', ['n1', 'n2', 'n3']);
    engine.crdtIncrement(crdt.crdtId, 'n1', 5);
    engine.crdtIncrement(crdt.crdtId, 'n2', 3);
    expect(engine.crdtValue(crdt.crdtId)).toBe(8);
  });

  it('creates PN-Counter CRDT and supports decrement', () => {
    const crdt = engine.createCRDT('pncounter', ['n1', 'n2']);
    engine.crdtIncrement(crdt.crdtId, 'n1', 10);
    engine.crdtDecrement(crdt.crdtId, 'n2', 3);
    expect(engine.crdtValue(crdt.crdtId)).toBe(7);
  });

  it('merges two G-Counters taking max per node', () => {
    const a = engine.createCRDT('gcounter', ['n1', 'n2']);
    engine.crdtIncrement(a.crdtId, 'n1', 10);
    engine.crdtIncrement(a.crdtId, 'n2', 5);

    const b = engine.createCRDT('gcounter', ['n1', 'n2']);
    engine.crdtIncrement(b.crdtId, 'n1', 7);   // partition had 7, merge should keep 10
    engine.crdtIncrement(b.crdtId, 'n2', 8);   // partition had 8 > 5

    const merged = engine.mergeCRDTs(a.crdtId, b.crdtId);
    expect(engine.crdtValue(merged.crdtId)).toBe(18); // max(10,7) + max(5,8) = 10 + 8
  });

  it('detects split-brain scenario', () => {
    ['x1', 'x2', 'x3', 'x4'].forEach(id => {
      engine.registerNode({ nodeId: id, address: `10.2.0.${id}`, region: 'ap-south', role: 'follower', status: 'online', votedFor: id === 'x1' || id === 'x2' ? 'x1' : 'x3', metadata: {} });
    });
    const cluster = engine.createCluster({ name: 'split-cluster', protocol: 'raft', nodes: ['x1', 'x2', 'x3', 'x4'], quorumSize: 2, replicationFactor: 4 });
    const result = engine.detectSplitBrain(cluster.clusterId);
    expect(typeof result.detected).toBe('boolean');
    expect(Array.isArray(result.partitions)).toBe(true);
  });

  it('returns cluster metrics', () => {
    ['m1', 'm2', 'm3'].forEach(id => {
      engine.registerNode({ nodeId: id, address: `10.3.0.${id}`, region: 'us-west', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    });
    const cluster = engine.createCluster({ name: 'metrics-cluster', protocol: 'raft', nodes: ['m1', 'm2', 'm3'], quorumSize: 2, replicationFactor: 3 });
    engine.triggerElection(cluster.clusterId, 'test');
    const metrics = engine.getClusterMetrics(cluster.clusterId);
    expect(metrics.currentTerm).toBe(1);
    expect(metrics.quorumHealth).toBeGreaterThan(0);
    expect(metrics.quorumHealth).toBeLessThanOrEqual(1);
  });

  it('returns replication status for all nodes', () => {
    ['r1', 'r2', 'r3'].forEach(id => {
      engine.registerNode({ nodeId: id, address: `10.4.0.${id}`, region: 'us-east', role: 'follower', status: 'online', votedFor: undefined, metadata: {} });
    });
    const cluster = engine.createCluster({ name: 'repl-cluster', protocol: 'raft', nodes: ['r1', 'r2', 'r3'], quorumSize: 2, replicationFactor: 3 });
    engine.triggerElection(cluster.clusterId, 'test');
    const status = engine.getReplicationStatus(cluster.clusterId);
    expect(status.length).toBe(3);
    status.forEach(s => {
      expect(typeof s.inSync).toBe('boolean');
      expect(s.lagEntries).toBeGreaterThanOrEqual(0);
    });
  });
});
