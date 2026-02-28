import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getCache } from '@/lib/cache';

describe('Cache Module', () => {
  let cache: ReturnType<typeof getCache>;

  beforeEach(() => {
    cache = getCache();
    cache.clear();
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1', 60);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should handle different data types', () => {
      cache.set('string', 'test', 60);
      cache.set('number', 42, 60);
      cache.set('object', { foo: 'bar' }, 60);
      cache.set('array', [1, 2, 3], 60);

      expect(cache.get('string')).toBe('test');
      expect(cache.get('number')).toBe(42);
      expect(cache.get('object')).toEqual({ foo: 'bar' });
      expect(cache.get('array')).toEqual([1, 2, 3]);
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 1);
      expect(cache.get('key1')).toBe('value1');

      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(cache.get('key1')).toBeNull();
    });

    it('should not expire entries before TTL', async () => {
      cache.set('key1', 'value1', 5);
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('delete', () => {
    it('should delete specific keys', () => {
      cache.set('key1', 'value1', 60);
      cache.set('key2', 'value2', 60);

      cache.delete('key1');
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });
  });

  describe('deleteByPrefix', () => {
    it('should delete all keys with given prefix', () => {
      cache.set('posts:1', 'post1', 60);
      cache.set('posts:2', 'post2', 60);
      cache.set('users:1', 'user1', 60);

      cache.deleteByPrefix('posts:');
      expect(cache.get('posts:1')).toBeNull();
      expect(cache.get('posts:2')).toBeNull();
      expect(cache.get('users:1')).toBe('user1');
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      cache.set('key1', 'cached', 60);

      const factory = jest.fn<() => Promise<string>>().mockResolvedValue('fresh');
      const value = await cache.getOrSet<string>('key1', factory, 60);

      expect(value).toBe('cached');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory if value not cached', async () => {
      const factory = jest.fn<() => Promise<string>>().mockResolvedValue('fresh');
      const value = await cache.getOrSet<string>('key1', factory, 60);

      expect(value).toBe('fresh');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(cache.get('key1')).toBe('fresh');
    });
  });

  describe('size', () => {
    it('should return correct cache size', () => {
      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1', 60);
      expect(cache.size()).toBe(1);

      cache.set('key2', 'value2', 60);
      expect(cache.size()).toBe(2);

      cache.delete('key1');
      expect(cache.size()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      cache.set('key1', 'value1', 60);
      cache.set('key2', 'value2', 60);
      cache.set('key3', 'value3', 60);

      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('key1')).toBeNull();
    });
  });
});
