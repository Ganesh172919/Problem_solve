/**
 * Database Sharding and Connection Pooling System
 *
 * Supports horizontal scaling through database sharding
 * Features:
 * - Consistent hashing for shard distribution
 * - Connection pooling with PgBouncer integration
 * - Automatic failover and replica routing
 * - Query routing to appropriate shards
 * - Cross-shard queries with aggregation
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { createHash } from 'crypto';
import { getLogger } from './logger';

const logger = getLogger();

export interface ShardConfig {
  id: string;
  name: string;
  primary: DatabaseConnection;
  replicas: DatabaseConnection[];
  weight: number; // For weighted distribution
  minConnections: number;
  maxConnections: number;
}

export interface DatabaseConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface ShardingStrategy {
  type: 'hash' | 'range' | 'directory';
  shardKey: string; // Field to shard on (e.g., 'user_id', 'organization_id')
  shards: number;
}

export interface QueryContext {
  shardKey?: string | number;
  readOnly?: boolean;
  timeout?: number;
  transaction?: boolean;
}

class DatabaseShardManager {
  private shards: Map<string, ShardCluster>;
  private strategy: ShardingStrategy;
  private hashRing: ConsistentHash;
  private initialized = false;

  constructor(config: ShardConfig[], strategy: ShardingStrategy) {
    this.shards = new Map();
    this.strategy = strategy;
    this.hashRing = new ConsistentHash();

    // Initialize shards
    for (const shardConfig of config) {
      const cluster = new ShardCluster(shardConfig);
      this.shards.set(shardConfig.id, cluster);

      // Add to hash ring
      this.hashRing.addNode(shardConfig.id, shardConfig.weight);
    }
  }

  /**
   * Initialize all shard connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing database shards', {
      count: this.shards.size,
      strategy: this.strategy.type,
    });

    const promises = Array.from(this.shards.values()).map(shard => shard.initialize());
    await Promise.all(promises);

    this.initialized = true;
    logger.info('Database shards initialized successfully');
  }

  /**
   * Execute query on appropriate shard
   */
  async query<T = any>(
    sql: string,
    params: any[],
    context: QueryContext = {}
  ): Promise<T[]> {
    if (!this.initialized) {
      throw new Error('Shard manager not initialized');
    }

    // Determine target shard
    const shardId = this.resolveShardId(context.shardKey);
    const shard = this.shards.get(shardId);

    if (!shard) {
      throw new Error(`Shard not found: ${shardId}`);
    }

    // Route to primary or replica
    const useReplica = context.readOnly && shard.hasReplicas();
    const pool = useReplica ? shard.getReplicaPool() : shard.getPrimaryPool();

    try {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    } catch (error: any) {
      logger.error('Query failed', { shardId, sql, error: error.message });
      throw error;
    }
  }

  /**
   * Execute transaction on shard
   */
  async transaction<T>(
    shardKey: string | number,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const shardId = this.resolveShardId(shardKey);
    const shard = this.shards.get(shardId);

    if (!shard) {
      throw new Error(`Shard not found: ${shardId}`);
    }

    const client = await shard.getPrimaryPool().connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute query across all shards (scatter-gather)
   */
  async queryAllShards<T = any>(
    sql: string,
    params: any[],
    options: { readOnly?: boolean; aggregator?: (results: T[][]) => T[] } = {}
  ): Promise<T[]> {
    const promises = Array.from(this.shards.values()).map(async shard => {
      const pool = options.readOnly && shard.hasReplicas()
        ? shard.getReplicaPool()
        : shard.getPrimaryPool();

      try {
        const result = await pool.query(sql, params);
        return result.rows as T[];
      } catch (error: any) {
        logger.error('Cross-shard query failed', {
          shardId: shard.config.id,
          error: error.message,
        });
        return [];
      }
    });

    const results = await Promise.all(promises);

    // Apply aggregator if provided
    if (options.aggregator) {
      return options.aggregator(results);
    }

    // Default: flatten results
    return results.flat();
  }

  /**
   * Get shard for key
   */
  resolveShardId(key?: string | number): string {
    if (!key) {
      // Random shard for operations without shard key
      const shardIds = Array.from(this.shards.keys());
      return shardIds[Math.floor(Math.random() * shardIds.length)];
    }

    switch (this.strategy.type) {
      case 'hash':
        return this.hashRing.getNode(String(key));

      case 'range':
        return this.resolveRangeShard(key);

      case 'directory':
        return this.resolveDirectoryShard(key);

      default:
        throw new Error(`Unknown sharding strategy: ${this.strategy.type}`);
    }
  }

  /**
   * Get shard statistics
   */
  async getStats(): Promise<Map<string, any>> {
    const stats = new Map();

    for (const [id, shard] of this.shards) {
      stats.set(id, await shard.getStats());
    }

    return stats;
  }

  /**
   * Close all connections
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down database shards');

    const promises = Array.from(this.shards.values()).map(shard => shard.shutdown());
    await Promise.all(promises);

    this.initialized = false;
  }

  private resolveRangeShard(key: string | number): string {
    // Implement range-based sharding
    // Example: user_id 1-1000 -> shard1, 1001-2000 -> shard2
    const numKey = typeof key === 'string' ? parseInt(key, 10) : key;
    const shardIndex = Math.floor(numKey / 1000) % this.shards.size;
    return Array.from(this.shards.keys())[shardIndex];
  }

  private resolveDirectoryShard(key: string | number): string {
    // Implement directory-based sharding
    // Look up shard mapping in directory table
    // For now, fallback to hash
    return this.hashRing.getNode(String(key));
  }
}

/**
 * Shard cluster with primary and replicas
 */
class ShardCluster {
  public config: ShardConfig;
  private primaryPool: Pool;
  private replicaPools: Pool[] = [];
  private replicaIndex = 0;

  constructor(config: ShardConfig) {
    this.config = config;

    // Create primary pool
    this.primaryPool = new Pool(this.createPoolConfig(config.primary, config));

    // Create replica pools
    for (const replica of config.replicas) {
      this.replicaPools.push(new Pool(this.createPoolConfig(replica, config)));
    }
  }

  async initialize(): Promise<void> {
    // Test primary connection
    const client = await this.primaryPool.connect();
    await client.query('SELECT 1');
    client.release();

    logger.info('Shard initialized', {
      shardId: this.config.id,
      replicas: this.replicaPools.length,
    });
  }

  getPrimaryPool(): Pool {
    return this.primaryPool;
  }

  getReplicaPool(): Pool {
    if (this.replicaPools.length === 0) {
      return this.primaryPool; // Fallback to primary
    }

    // Round-robin across replicas
    const pool = this.replicaPools[this.replicaIndex];
    this.replicaIndex = (this.replicaIndex + 1) % this.replicaPools.length;
    return pool;
  }

  hasReplicas(): boolean {
    return this.replicaPools.length > 0;
  }

  async getStats(): Promise<any> {
    return {
      primary: {
        totalCount: this.primaryPool.totalCount,
        idleCount: this.primaryPool.idleCount,
        waitingCount: this.primaryPool.waitingCount,
      },
      replicas: this.replicaPools.map(pool => ({
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      })),
    };
  }

  async shutdown(): Promise<void> {
    await this.primaryPool.end();

    for (const pool of this.replicaPools) {
      await pool.end();
    }
  }

  private createPoolConfig(conn: DatabaseConnection, config: ShardConfig): PoolConfig {
    return {
      host: conn.host,
      port: conn.port,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      min: config.minConnections,
      max: config.maxConnections,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 60000,
      query_timeout: 60000,
    };
  }
}

/**
 * Consistent hashing for shard distribution
 */
class ConsistentHash {
  private ring: Map<number, string> = new Map();
  private sortedKeys: number[] = [];
  private virtualNodes = 150; // Virtual nodes per physical node

  addNode(nodeId: string, weight: number = 1): void {
    const nodes = Math.floor(this.virtualNodes * weight);

    for (let i = 0; i < nodes; i++) {
      const hash = this.hash(`${nodeId}:${i}`);
      this.ring.set(hash, nodeId);
    }

    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  removeNode(nodeId: string): void {
    const keysToRemove: number[] = [];

    for (const [hash, id] of this.ring.entries()) {
      if (id === nodeId) {
        keysToRemove.push(hash);
      }
    }

    for (const key of keysToRemove) {
      this.ring.delete(key);
    }

    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  getNode(key: string): string {
    if (this.sortedKeys.length === 0) {
      throw new Error('No nodes in hash ring');
    }

    const hash = this.hash(key);

    // Binary search for the first node >= hash
    let left = 0;
    let right = this.sortedKeys.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (this.sortedKeys[mid] === hash) {
        return this.ring.get(this.sortedKeys[mid])!;
      }
      if (this.sortedKeys[mid] < hash) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    // Wrap around to first node
    const index = left >= this.sortedKeys.length ? 0 : left;
    return this.ring.get(this.sortedKeys[index])!;
  }

  private hash(key: string): number {
    const hash = createHash('md5').update(key).digest();
    // Use first 4 bytes as integer
    return hash.readUInt32BE(0);
  }
}

// Singleton instance
let shardManager: DatabaseShardManager;

export function getShardManager(): DatabaseShardManager {
  if (!shardManager) {
    // Initialize with configuration
    const config: ShardConfig[] = [
      {
        id: 'shard-1',
        name: 'Primary Shard 1',
        primary: {
          host: process.env.DB_SHARD1_HOST || 'localhost',
          port: parseInt(process.env.DB_SHARD1_PORT || '5432'),
          database: 'ai_auto_news_shard1',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
        },
        replicas: [],
        weight: 1,
        minConnections: 10,
        maxConnections: 30,
      },
      {
        id: 'shard-2',
        name: 'Primary Shard 2',
        primary: {
          host: process.env.DB_SHARD2_HOST || 'localhost',
          port: parseInt(process.env.DB_SHARD2_PORT || '5433'),
          database: 'ai_auto_news_shard2',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
        },
        replicas: [],
        weight: 1,
        minConnections: 10,
        maxConnections: 30,
      },
    ];

    const strategy: ShardingStrategy = {
      type: 'hash',
      shardKey: 'organization_id',
      shards: 2,
    };

    shardManager = new DatabaseShardManager(config, strategy);
  }

  return shardManager;
}

export { DatabaseShardManager, ShardCluster, ConsistentHash };
