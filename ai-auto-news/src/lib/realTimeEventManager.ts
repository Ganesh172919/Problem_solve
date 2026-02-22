/**
 * Real-Time Event Stream & WebSocket Manager
 *
 * High-performance real-time communication system for:
 * - WebSocket connections
 * - Server-Sent Events (SSE)
 * - Pub/Sub messaging
 * - Event broadcasting
 * - Room/channel management
 * - Presence tracking
 * - Message persistence
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface Connection {
  id: string;
  userId?: string;
  sessionId: string;
  type: 'websocket' | 'sse';
  channels: Set<string>;
  metadata: Record<string, any>;
  connectedAt: Date;
  lastActivity: Date;
  messageCount: number;
}

export interface Channel {
  id: string;
  name: string;
  type: 'public' | 'private' | 'presence';
  connections: Set<string>;
  metadata: Record<string, any>;
  messageHistory: Message[];
  maxHistory: number;
  createdAt: Date;
}

export interface Message {
  id: string;
  channelId: string;
  senderId?: string;
  type: 'broadcast' | 'direct' | 'system';
  event: string;
  payload: any;
  timestamp: Date;
  persisted: boolean;
}

export interface PresenceInfo {
  userId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen: Date;
  metadata: Record<string, any>;
}

export interface BroadcastOptions {
  except?: string[]; // Connection IDs to exclude
  filter?: (conn: Connection) => boolean;
  compress?: boolean;
  persistent?: boolean;
}

class RealTimeEventManager {
  private connections: Map<string, Connection> = new Map();
  private channels: Map<string, Channel> = new Map();
  private presence: Map<string, PresenceInfo> = new Map();
  private messageQueue: Message[] = [];
  private readonly MAX_CONNECTIONS = 100000;
  private readonly MAX_MESSAGE_HISTORY = 100;

  constructor() {
    this.startHeartbeat();
    this.startMessageProcessor();
    this.startPresenceMonitor();
  }

  /**
   * Register new connection
   */
  registerConnection(
    connectionId: string,
    type: 'websocket' | 'sse',
    userId?: string
  ): Connection {
    if (this.connections.size >= this.MAX_CONNECTIONS) {
      throw new Error('Maximum connections reached');
    }

    const connection: Connection = {
      id: connectionId,
      userId,
      sessionId: this.generateSessionId(),
      type,
      channels: new Set(),
      metadata: {},
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
    };

    this.connections.set(connectionId, connection);

    // Update presence
    if (userId) {
      this.updatePresence(userId, 'online');
    }

    logger.info('Connection registered', {
      connectionId,
      type,
      userId,
      totalConnections: this.connections.size,
    });

    return connection;
  }

  /**
   * Unregister connection
   */
  unregisterConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      return;
    }

    // Leave all channels
    for (const channelId of connection.channels) {
      this.leaveChannel(connectionId, channelId);
    }

    this.connections.delete(connectionId);

    // Update presence
    if (connection.userId) {
      const userConnections = Array.from(this.connections.values()).filter(
        c => c.userId === connection.userId
      );

      if (userConnections.length === 0) {
        this.updatePresence(connection.userId, 'offline');
      }
    }

    logger.info('Connection unregistered', {
      connectionId,
      totalConnections: this.connections.size,
    });
  }

  /**
   * Create or get channel
   */
  getOrCreateChannel(
    channelId: string,
    name: string,
    type: 'public' | 'private' | 'presence' = 'public'
  ): Channel {
    if (this.channels.has(channelId)) {
      return this.channels.get(channelId)!;
    }

    const channel: Channel = {
      id: channelId,
      name,
      type,
      connections: new Set(),
      metadata: {},
      messageHistory: [],
      maxHistory: this.MAX_MESSAGE_HISTORY,
      createdAt: new Date(),
    };

    this.channels.set(channelId, channel);

    logger.info('Channel created', { channelId, name, type });

    return channel;
  }

  /**
   * Join channel
   */
  async joinChannel(connectionId: string, channelId: string): Promise<void> {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      throw new Error('Connection not found');
    }

    const channel = this.channels.get(channelId);

    if (!channel) {
      throw new Error('Channel not found');
    }

    // Check access for private channels
    if (channel.type === 'private') {
      const hasAccess = await this.checkChannelAccess(connection, channel);
      if (!hasAccess) {
        throw new Error('Access denied to private channel');
      }
    }

    connection.channels.add(channelId);
    channel.connections.add(connectionId);

    // Send message history
    if (channel.messageHistory.length > 0) {
      for (const message of channel.messageHistory) {
        await this.sendToConnection(connectionId, message);
      }
    }

    // Broadcast join event for presence channels
    if (channel.type === 'presence' && connection.userId) {
      await this.broadcastToChannel(channelId, {
        event: 'user.joined',
        payload: {
          userId: connection.userId,
          channelId,
        },
      }, { except: [connectionId] });
    }

    logger.info('Connection joined channel', {
      connectionId,
      channelId,
      channelConnections: channel.connections.size,
    });
  }

  /**
   * Leave channel
   */
  async leaveChannel(connectionId: string, channelId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    const channel = this.channels.get(channelId);

    if (!connection || !channel) {
      return;
    }

    connection.channels.delete(channelId);
    channel.connections.delete(connectionId);

    // Broadcast leave event for presence channels
    if (channel.type === 'presence' && connection.userId) {
      await this.broadcastToChannel(channelId, {
        event: 'user.left',
        payload: {
          userId: connection.userId,
          channelId,
        },
      });
    }

    // Clean up empty channels
    if (channel.connections.size === 0 && channel.type !== 'public') {
      this.channels.delete(channelId);
      logger.info('Empty channel removed', { channelId });
    }

    logger.info('Connection left channel', { connectionId, channelId });
  }

  /**
   * Broadcast message to channel
   */
  async broadcastToChannel(
    channelId: string,
    message: { event: string; payload: any },
    options: BroadcastOptions = {}
  ): Promise<void> {
    const channel = this.channels.get(channelId);

    if (!channel) {
      throw new Error('Channel not found');
    }

    const fullMessage: Message = {
      id: this.generateMessageId(),
      channelId,
      type: 'broadcast',
      event: message.event,
      payload: message.payload,
      timestamp: new Date(),
      persisted: options.persistent || false,
    };

    // Add to message history
    if (options.persistent) {
      channel.messageHistory.push(fullMessage);

      // Trim history
      if (channel.messageHistory.length > channel.maxHistory) {
        channel.messageHistory = channel.messageHistory.slice(-channel.maxHistory);
      }
    }

    // Send to all connections in channel
    const promises: Promise<void>[] = [];

    for (const connId of channel.connections) {
      // Skip excluded connections
      if (options.except && options.except.includes(connId)) {
        continue;
      }

      // Apply filter
      if (options.filter) {
        const conn = this.connections.get(connId);
        if (!conn || !options.filter(conn)) {
          continue;
        }
      }

      promises.push(this.sendToConnection(connId, fullMessage));
    }

    await Promise.all(promises);

    logger.debug('Message broadcasted', {
      channelId,
      event: message.event,
      connections: promises.length,
    });
  }

  /**
   * Send direct message to connection
   */
  async sendToConnection(connectionId: string, message: Message): Promise<void> {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      return;
    }

    // Queue message for delivery
    this.messageQueue.push(message);

    // Update connection activity
    connection.lastActivity = new Date();
    connection.messageCount++;

    // In production, would send via actual WebSocket/SSE
    // await websocket.send(JSON.stringify(message));
  }

  /**
   * Send direct message to user
   */
  async sendToUser(
    userId: string,
    message: { event: string; payload: any }
  ): Promise<void> {
    const userConnections = Array.from(this.connections.values()).filter(
      c => c.userId === userId
    );

    const fullMessage: Message = {
      id: this.generateMessageId(),
      channelId: 'direct',
      type: 'direct',
      event: message.event,
      payload: message.payload,
      timestamp: new Date(),
      persisted: false,
    };

    for (const connection of userConnections) {
      await this.sendToConnection(connection.id, fullMessage);
    }

    logger.debug('Direct message sent', {
      userId,
      connections: userConnections.length,
    });
  }

  /**
   * Get channel presence
   */
  getChannelPresence(channelId: string): PresenceInfo[] {
    const channel = this.channels.get(channelId);

    if (!channel) {
      return [];
    }

    const userIds = new Set<string>();
    const presenceList: PresenceInfo[] = [];

    // Collect unique user IDs from connections
    for (const connId of channel.connections) {
      const conn = this.connections.get(connId);
      if (conn?.userId) {
        userIds.add(conn.userId);
      }
    }

    // Get presence info for each user
    for (const userId of userIds) {
      const presence = this.presence.get(userId);
      if (presence) {
        presenceList.push(presence);
      }
    }

    return presenceList;
  }

  /**
   * Update user presence
   */
  updatePresence(
    userId: string,
    status: 'online' | 'away' | 'offline',
    metadata?: Record<string, any>
  ): void {
    const existing = this.presence.get(userId);

    this.presence.set(userId, {
      userId,
      status,
      lastSeen: new Date(),
      metadata: metadata || existing?.metadata || {},
    });

    // Broadcast presence update to all channels user is in
    const userConnections = Array.from(this.connections.values()).filter(
      c => c.userId === userId
    );

    const affectedChannels = new Set<string>();

    for (const conn of userConnections) {
      for (const channelId of conn.channels) {
        affectedChannels.add(channelId);
      }
    }

    for (const channelId of affectedChannels) {
      this.broadcastToChannel(channelId, {
        event: 'presence.update',
        payload: {
          userId,
          status,
          metadata,
        },
      });
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalConnections: number;
    totalChannels: number;
    messageQueueSize: number;
    connectionsByType: { websocket: number; sse: number };
    topChannels: Array<{ id: string; connections: number }>;
  } {
    const connectionsByType = {
      websocket: Array.from(this.connections.values()).filter(c => c.type === 'websocket')
        .length,
      sse: Array.from(this.connections.values()).filter(c => c.type === 'sse').length,
    };

    const channelStats = Array.from(this.channels.values())
      .map(ch => ({
        id: ch.id,
        connections: ch.connections.size,
      }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 10);

    return {
      totalConnections: this.connections.size,
      totalChannels: this.channels.size,
      messageQueueSize: this.messageQueue.length,
      connectionsByType,
      topChannels: channelStats,
    };
  }

  // Private methods

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private async checkChannelAccess(
    connection: Connection,
    channel: Channel
  ): Promise<boolean> {
    // Simplified access check
    return true;
  }

  private startHeartbeat(): void {
    setInterval(() => {
      const now = new Date();
      const timeout = 60000; // 1 minute

      // Find stale connections
      for (const [connId, conn] of this.connections.entries()) {
        if (now.getTime() - conn.lastActivity.getTime() > timeout) {
          logger.warn('Stale connection detected', { connectionId: connId });
          this.unregisterConnection(connId);
        }
      }
    }, 30000); // Every 30 seconds
  }

  private startMessageProcessor(): void {
    setInterval(() => {
      // Process message queue (in production would batch send)
      if (this.messageQueue.length > 0) {
        logger.debug('Processing message queue', { size: this.messageQueue.length });
        this.messageQueue = []; // Clear queue after processing
      }
    }, 100); // Every 100ms
  }

  private startPresenceMonitor(): void {
    setInterval(() => {
      const now = new Date();
      const awayThreshold = 300000; // 5 minutes

      // Mark users as away if inactive
      for (const [userId, presence] of this.presence.entries()) {
        if (
          presence.status === 'online' &&
          now.getTime() - presence.lastSeen.getTime() > awayThreshold
        ) {
          this.updatePresence(userId, 'away');
        }
      }
    }, 60000); // Every minute
  }
}

// Singleton
let eventManager: RealTimeEventManager;

export function getRealTimeEventManager(): RealTimeEventManager {
  if (!eventManager) {
    eventManager = new RealTimeEventManager();
  }
  return eventManager;
}
