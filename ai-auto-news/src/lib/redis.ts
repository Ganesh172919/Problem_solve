import Redis from 'ioredis';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  retryStrategy?: (times: number) => number | null;
}

class RedisClient {
  private client: Redis;
  private pubClient: Redis;
  private subClient: Redis;

  constructor(config: RedisConfig) {
    const defaultConfig = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      ...config,
    };

    this.client = new Redis(defaultConfig);
    this.pubClient = new Redis(defaultConfig);
    this.subClient = new Redis(defaultConfig);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis connected');
    });

    this.client.on('ready', () => {
      console.log('Redis ready');
    });
  }

  // Key-Value Operations
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async del(key: string): Promise<number> {
    return await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }

  // Pattern Operations
  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const keys = await this.keys(pattern);
    if (keys.length === 0) return 0;
    return await this.client.del(...keys);
  }

  // Hash Operations
  async hget(key: string, field: string): Promise<string | null> {
    return await this.client.hget(key, field);
  }

  async hset(key: string, field: string, value: any): Promise<number> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return await this.client.hset(key, field, serialized);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return await this.client.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.client.hdel(key, ...fields);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return await this.client.hincrby(key, field, increment);
  }

  // List Operations
  async lpush(key: string, ...values: any[]): Promise<number> {
    const serialized = values.map(v => typeof v === 'string' ? v : JSON.stringify(v));
    return await this.client.lpush(key, ...serialized);
  }

  async rpush(key: string, ...values: any[]): Promise<number> {
    const serialized = values.map(v => typeof v === 'string' ? v : JSON.stringify(v));
    return await this.client.rpush(key, ...serialized);
  }

  async lpop<T>(key: string): Promise<T | null> {
    const value = await this.client.lpop(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async rpop<T>(key: string): Promise<T | null> {
    const value = await this.client.rpop(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const values = await this.client.lrange(key, start, stop);
    return values.map(v => {
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as T;
      }
    });
  }

  async llen(key: string): Promise<number> {
    return await this.client.llen(key);
  }

  // Set Operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    return await this.client.sadd(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return await this.client.srem(key, ...members);
  }

  // Sorted Set Operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    return await this.client.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.zrange(key, start, stop);
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    return await this.client.zrangebyscore(key, min, max);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return await this.client.zrem(key, ...members);
  }

  async zcard(key: string): Promise<number> {
    return await this.client.zcard(key);
  }

  // Increment/Decrement
  async incr(key: string): Promise<number> {
    return await this.client.incr(key);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return await this.client.incrby(key, increment);
  }

  async decr(key: string): Promise<number> {
    return await this.client.decr(key);
  }

  async decrby(key: string, decrement: number): Promise<number> {
    return await this.client.decrby(key, decrement);
  }

  // Pub/Sub
  async publish(channel: string, message: any): Promise<number> {
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);
    return await this.pubClient.publish(channel, serialized);
  }

  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    await this.subClient.subscribe(channel);
    this.subClient.on('message', (ch, msg) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(msg));
        } catch {
          handler(msg);
        }
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subClient.unsubscribe(channel);
  }

  // Transactions
  multi() {
    return this.client.multi();
  }

  // Lua Scripts
  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    return await this.client.eval(script, numKeys, ...args);
  }

  // Connection Management
  async ping(): Promise<string> {
    return await this.client.ping();
  }

  async flushdb(): Promise<string> {
    return await this.client.flushdb();
  }

  async quit(): Promise<string> {
    await this.pubClient.quit();
    await this.subClient.quit();
    return await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }
}

// Singleton instance
let redisInstance: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!redisInstance) {
    const config: RedisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'ai-news:',
    };
    redisInstance = new RedisClient(config);
  }
  return redisInstance;
}

export { RedisClient };
