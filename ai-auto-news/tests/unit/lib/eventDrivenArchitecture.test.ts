import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventDrivenArchitecture } from '@/lib/eventDrivenArchitecture';

describe('EventDrivenArchitecture', () => {
  let eda: EventDrivenArchitecture;

  beforeEach(() => {
    eda = new EventDrivenArchitecture();
  });

  describe('publish', () => {
    it('should publish an event', async () => {
      const event = await eda.publish({
        aggregateId: 'user-123',
        aggregateType: 'User',
        eventType: 'UserCreated',
        payload: { name: 'Alice', email: 'alice@test.com' },
      });

      expect(event.id).toContain('evt_');
      expect(event.aggregateId).toBe('user-123');
      expect(event.eventType).toBe('UserCreated');
      expect(event.version).toBe(1);
    });

    it('should increment version for same aggregate', async () => {
      await eda.publish({
        aggregateId: 'user-123',
        aggregateType: 'User',
        eventType: 'UserCreated',
        payload: { name: 'Alice' },
      });

      const event2 = await eda.publish({
        aggregateId: 'user-123',
        aggregateType: 'User',
        eventType: 'UserUpdated',
        payload: { name: 'Alice Updated' },
      });

      expect(event2.version).toBe(2);
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers of events', async () => {
      let receivedEvent: unknown = null;

      eda.subscribe({
        id: 'sub1',
        eventTypes: ['UserCreated'],
        handler: async (event) => {
          receivedEvent = event;
        },
        options: {
          startFrom: 'latest',
          maxRetries: 0,
          retryDelayMs: 100,
          batchSize: 1,
          concurrency: 1,
        },
      });

      await eda.publish({
        aggregateId: 'user-123',
        aggregateType: 'User',
        eventType: 'UserCreated',
        payload: { name: 'Alice' },
      });

      expect(receivedEvent).not.toBeNull();
    });

    it('should not notify for non-matching event types', async () => {
      let called = false;

      eda.subscribe({
        id: 'sub1',
        eventTypes: ['OrderCreated'],
        handler: async () => {
          called = true;
        },
        options: {
          startFrom: 'latest',
          maxRetries: 0,
          retryDelayMs: 100,
          batchSize: 1,
          concurrency: 1,
        },
      });

      await eda.publish({
        aggregateId: 'user-123',
        aggregateType: 'User',
        eventType: 'UserCreated',
        payload: {},
      });

      expect(called).toBe(false);
    });
  });

  describe('getEventsForAggregate', () => {
    it('should retrieve events for an aggregate', async () => {
      await eda.publish({
        aggregateId: 'order-1',
        aggregateType: 'Order',
        eventType: 'OrderCreated',
        payload: {},
      });
      await eda.publish({
        aggregateId: 'order-1',
        aggregateType: 'Order',
        eventType: 'OrderPaid',
        payload: {},
      });
      await eda.publish({
        aggregateId: 'order-2',
        aggregateType: 'Order',
        eventType: 'OrderCreated',
        payload: {},
      });

      const events = eda.getEventsForAggregate('order-1');
      expect(events).toHaveLength(2);
      expect(events[0].version).toBe(1);
      expect(events[1].version).toBe(2);
    });

    it('should filter by version', async () => {
      await eda.publish({ aggregateId: 'a1', aggregateType: 'A', eventType: 'E1', payload: {} });
      await eda.publish({ aggregateId: 'a1', aggregateType: 'A', eventType: 'E2', payload: {} });
      await eda.publish({ aggregateId: 'a1', aggregateType: 'A', eventType: 'E3', payload: {} });

      const events = eda.getEventsForAggregate('a1', 1);
      expect(events).toHaveLength(2);
    });
  });

  describe('projections', () => {
    it('should update projection state on events', async () => {
      eda.registerProjection({
        id: 'user_count',
        name: 'User Count',
        eventTypes: ['UserCreated'],
        state: { count: 0 },
        version: 0,
        lastProcessedEventId: null,
        status: 'active',
        handler: (state, event) => ({
          count: ((state.count as number) || 0) + 1,
        }),
      });

      await eda.publish({ aggregateId: 'u1', aggregateType: 'User', eventType: 'UserCreated', payload: {} });
      await eda.publish({ aggregateId: 'u2', aggregateType: 'User', eventType: 'UserCreated', payload: {} });

      const state = eda.getProjectionState('user_count');
      expect(state).toEqual({ count: 2 });
    });

    it('should rebuild projection from event store', async () => {
      await eda.publish({ aggregateId: 'u1', aggregateType: 'User', eventType: 'UserCreated', payload: {} });
      await eda.publish({ aggregateId: 'u2', aggregateType: 'User', eventType: 'UserCreated', payload: {} });

      eda.registerProjection({
        id: 'user_count',
        name: 'User Count',
        eventTypes: ['UserCreated'],
        state: {},
        version: 0,
        lastProcessedEventId: null,
        status: 'active',
        handler: (state, event) => ({
          count: ((state.count as number) || 0) + 1,
        }),
      });

      const success = await eda.rebuildProjection('user_count');
      expect(success).toBe(true);

      const state = eda.getProjectionState('user_count');
      expect(state).toEqual({ count: 2 });
    });
  });

  describe('snapshots', () => {
    it('should create and retrieve snapshots', async () => {
      await eda.publish({ aggregateId: 'u1', aggregateType: 'User', eventType: 'UserCreated', payload: {} });

      const snapshot = eda.createSnapshot('u1', { name: 'Alice', email: 'alice@test.com' });
      expect(snapshot.aggregateId).toBe('u1');
      expect(snapshot.version).toBe(1);

      const retrieved = eda.getSnapshot('u1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.state.name).toBe('Alice');
    });
  });

  describe('replayEvents', () => {
    it('should replay events through a handler', async () => {
      await eda.publish({ aggregateId: 'a1', aggregateType: 'A', eventType: 'E1', payload: { v: 1 } });
      await eda.publish({ aggregateId: 'a2', aggregateType: 'A', eventType: 'E2', payload: { v: 2 } });

      const replayed: string[] = [];
      const count = await eda.replayEvents({
        handler: async (event) => {
          replayed.push(event.eventType);
        },
      });

      expect(count).toBe(2);
      expect(replayed).toEqual(['E1', 'E2']);
    });

    it('should filter by event type', async () => {
      await eda.publish({ aggregateId: 'a1', aggregateType: 'A', eventType: 'E1', payload: {} });
      await eda.publish({ aggregateId: 'a2', aggregateType: 'A', eventType: 'E2', payload: {} });

      const count = await eda.replayEvents({
        eventTypes: ['E1'],
        handler: async () => {},
      });

      expect(count).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return event store statistics', async () => {
      await eda.publish({ aggregateId: 'a1', aggregateType: 'User', eventType: 'UserCreated', payload: {} });
      await eda.publish({ aggregateId: 'a2', aggregateType: 'Order', eventType: 'OrderCreated', payload: {} });

      const stats = eda.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.eventsByType.UserCreated).toBe(1);
      expect(stats.eventsByType.OrderCreated).toBe(1);
      expect(stats.eventsByAggregate.User).toBe(1);
      expect(stats.eventsByAggregate.Order).toBe(1);
    });
  });
});
