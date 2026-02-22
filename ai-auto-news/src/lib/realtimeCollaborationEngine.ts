import { getLogger } from '@/lib/logger';
import { getCache } from '@/lib/cache';

const logger = getLogger();
const cache = getCache();

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type OperationType = 'insert' | 'delete' | 'retain';

export interface Operation {
  id: string;
  sessionId: string;
  userId: string;
  type: OperationType;
  position: number;
  content?: string;      // for insert
  length?: number;       // for delete / retain
  timestamp: Date;
  revision: number;      // document revision this op is based on
  applied: boolean;
}

export interface Transform {
  original: Operation;
  transformed: Operation;
  against: Operation;
}

export interface CursorPosition {
  userId: string;
  sessionId: string;
  position: number;
  selectionStart?: number;
  selectionEnd?: number;
  updatedAt: Date;
}

export interface CollabUser {
  id: string;
  name: string;
  color: string; // hex colour for cursor/highlight
  avatarUrl?: string;
  role: 'viewer' | 'editor' | 'owner';
  joinedAt: Date;
  lastActiveAt: Date;
  isOnline: boolean;
  cursor?: CursorPosition;
}

export interface CollabSession {
  id: string;
  documentId: string;
  title: string;
  createdBy: string;
  createdAt: Date;
  users: Map<string, CollabUser>;
  currentRevision: number;
  content: string;
  isLocked: boolean;
  lastActivityAt: Date;
}

export interface Comment {
  id: string;
  sessionId: string;
  documentId: string;
  userId: string;
  text: string;
  position: number;       // character offset
  length: number;         // highlighted span length
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  replies: CommentReply[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentReply {
  id: string;
  userId: string;
  text: string;
  createdAt: Date;
}

export interface Annotation {
  id: string;
  sessionId: string;
  documentId: string;
  userId: string;
  type: 'highlight' | 'underline' | 'strikethrough' | 'note';
  position: number;
  length: number;
  color?: string;
  note?: string;
  createdAt: Date;
}

export interface Revision {
  revision: number;
  documentId: string;
  sessionId: string;
  userId: string;
  operations: Operation[];
  contentSnapshot: string;  // full content after this revision
  description?: string;
  timestamp: Date;
}

// ─── Event emitter ────────────────────────────────────────────────────────────

type EventHandler = (...args: unknown[]) => void;

class EventEmitter {
  private listeners = new Map<string, EventHandler[]>();

  on(event: string, handler: EventHandler): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(event, list.filter(h => h !== handler));
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of (this.listeners.get(event) ?? [])) {
      try { handler(...args); } catch (e) { /* isolate listener errors */ }
    }
    // Also emit to wildcard listeners
    for (const handler of (this.listeners.get('*') ?? [])) {
      try { handler(event, ...args); } catch (e) { /* isolate */ }
    }
  }
}

// ─── Operational Transformation ──────────────────────────────────────────────

// Transform op A against op B (both based on same revision) such that
// applying A' after B produces the correct merged document.
function transformOperation(opA: Operation, opB: Operation): Operation {
  const a = { ...opA };

  if (opB.type === 'insert') {
    const insertLen = opB.content?.length ?? 0;
    if (opB.position <= a.position) {
      a.position += insertLen;
    } else if (opB.position < a.position + (a.length ?? a.content?.length ?? 0)) {
      // Insert in the middle of a delete span – extend delete
      if (a.type === 'delete') a.length = (a.length ?? 0) + insertLen;
    }
  } else if (opB.type === 'delete') {
    const delLen = opB.length ?? 0;
    if (opB.position + delLen <= a.position) {
      a.position -= delLen;
    } else if (opB.position < a.position && opB.position + delLen >= a.position) {
      // Our anchor was inside the deleted range – move to deletion start
      a.position = opB.position;
    } else if (opB.position >= a.position && opB.position < a.position + (a.length ?? 0)) {
      // Delete overlaps the tail of our delete span
      if (a.type === 'delete') {
        const overlap = Math.min(delLen, a.position + (a.length ?? 0) - opB.position);
        a.length = Math.max(0, (a.length ?? 0) - overlap);
      }
    }
  }

  return a;
}

// Apply an operation to a string and return the new string
function applyOp(content: string, op: Operation): string {
  const pos = Math.max(0, Math.min(op.position, content.length));
  if (op.type === 'insert' && op.content !== undefined) {
    return content.slice(0, pos) + op.content + content.slice(pos);
  }
  if (op.type === 'delete' && op.length !== undefined) {
    return content.slice(0, pos) + content.slice(pos + op.length);
  }
  return content; // retain
}

// ─── Engine ──────────────────────────────────────────────────────────────────

// User colour palette
const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#76D7C4',
];

class RealtimeCollaborationEngine extends EventEmitter {
  private sessions    = new Map<string, CollabSession>();
  private comments    = new Map<string, Comment>();    // commentId -> Comment
  private annotations = new Map<string, Annotation>(); // annotationId -> Annotation
  private revisions   = new Map<string, Revision[]>(); // documentId -> Revision[]
  private pendingOps  = new Map<string, Operation[]>(); // sessionId -> uncommitted ops
  private colorIndex  = 0;

  // ── Session management ─────────────────────────────────────────────────────

  createSession(documentId: string, title: string, createdBy: string, initialContent = ''): CollabSession {
    const session: CollabSession = {
      id:               `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      documentId,
      title,
      createdBy,
      createdAt:        new Date(),
      users:            new Map(),
      currentRevision:  0,
      content:          initialContent,
      isLocked:         false,
      lastActivityAt:   new Date(),
    };
    this.sessions.set(session.id, session);
    this.revisions.set(documentId, []);
    this.pendingOps.set(session.id, []);
    logger.info('Collaboration session created', { sessionId: session.id, documentId });
    this.emit('session:created', { session });
    return session;
  }

  joinSession(sessionId: string, user: Omit<CollabUser, 'color' | 'joinedAt' | 'lastActiveAt' | 'isOnline'>): CollabUser {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const existingUser = session.users.get(user.id);
    if (existingUser) {
      existingUser.isOnline      = true;
      existingUser.lastActiveAt  = new Date();
      this.emit('user:rejoined', { sessionId, user: existingUser });
      return existingUser;
    }

    const color = USER_COLORS[this.colorIndex++ % USER_COLORS.length];
    const collabUser: CollabUser = {
      ...user,
      color,
      joinedAt:      new Date(),
      lastActiveAt:  new Date(),
      isOnline:      true,
    };
    session.users.set(user.id, collabUser);
    session.lastActivityAt = new Date();

    logger.info('User joined session', { sessionId, userId: user.id, name: user.name });
    this.emit('user:joined', { sessionId, user: collabUser });
    this.broadcastChange(sessionId, 'user:joined', { user: collabUser });
    return collabUser;
  }

  leaveSession(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const user = session.users.get(userId);
    if (user) {
      user.isOnline     = false;
      user.lastActiveAt = new Date();
    }
    logger.info('User left session', { sessionId, userId });
    this.emit('user:left', { sessionId, userId });
    this.broadcastChange(sessionId, 'user:left', { userId });
  }

  getSession(sessionId: string): CollabSession | undefined {
    return this.sessions.get(sessionId);
  }

  lockSession(sessionId: string, lock: boolean): void {
    const session = this.sessions.get(sessionId);
    if (session) session.isLocked = lock;
  }

  // ── Operation application (OT) ────────────────────────────────────────────

  applyOperation(op: Omit<Operation, 'id' | 'applied'>): Operation {
    const session = this.sessions.get(op.sessionId);
    if (!session) throw new Error(`Session not found: ${op.sessionId}`);
    if (session.isLocked) throw new Error('Session is locked');

    const user = session.users.get(op.userId);
    if (!user) throw new Error(`User not in session: ${op.userId}`);
    if (user.role === 'viewer') throw new Error('Viewers cannot edit');

    // Retrieve ops applied since op.revision that need to be OT-transformed against
    const revList = this.revisions.get(session.documentId) ?? [];
    const concurrentOps: Operation[] = [];
    for (const rev of revList) {
      if (rev.revision > op.revision) {
        concurrentOps.push(...rev.operations);
      }
    }

    // Transform the incoming op against all concurrent ops
    let transformed: Operation = {
      ...op,
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      applied: false,
    };
    for (const concOp of concurrentOps) {
      transformed = transformOperation(transformed, concOp);
    }

    // Apply to document
    session.content        = applyOp(session.content, transformed);
    session.currentRevision++;
    transformed.revision   = session.currentRevision;
    transformed.applied    = true;
    session.lastActivityAt = new Date();

    // Append to revision history
    const revEntry: Revision = {
      revision:        session.currentRevision,
      documentId:      session.documentId,
      sessionId:       session.id,
      userId:          op.userId,
      operations:      [transformed],
      contentSnapshot: session.content,
      timestamp:       new Date(),
    };
    const revisions = this.revisions.get(session.documentId) ?? [];
    revisions.push(revEntry);
    this.revisions.set(session.documentId, revisions);

    // Update user activity
    user.lastActiveAt = new Date();

    // Adjust any cursors that are after the edit position
    this.adjustCursorsAfterOp(session, transformed);

    logger.info('Operation applied', {
      sessionId: session.id, userId: op.userId,
      type: transformed.type, revision: transformed.revision,
    });
    this.emit('operation:applied', { sessionId: session.id, operation: transformed });
    this.broadcastChange(session.id, 'operation:applied', { operation: transformed });
    return transformed;
  }

  transformOperation(opA: Operation, opB: Operation): Transform {
    const transformed = transformOperation(opA, opB);
    return { original: opA, transformed, against: opB };
  }

  private adjustCursorsAfterOp(session: CollabSession, op: Operation): void {
    for (const user of session.users.values()) {
      if (!user.cursor) continue;
      if (op.type === 'insert' && op.position <= user.cursor.position) {
        user.cursor.position += op.content?.length ?? 0;
      } else if (op.type === 'delete' && op.position < user.cursor.position) {
        const del = op.length ?? 0;
        user.cursor.position = Math.max(op.position, user.cursor.position - del);
      }
    }
  }

  // ── Cursor tracking ───────────────────────────────────────────────────────

  trackCursor(sessionId: string, userId: string, position: number, selectionStart?: number, selectionEnd?: number): CursorPosition {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const user = session.users.get(userId);
    if (!user) throw new Error(`User not in session: ${userId}`);

    const cursor: CursorPosition = {
      userId, sessionId, position, selectionStart, selectionEnd, updatedAt: new Date(),
    };
    user.cursor       = cursor;
    user.lastActiveAt = new Date();

    this.emit('cursor:moved', { sessionId, cursor });
    this.broadcastChange(sessionId, 'cursor:moved', { cursor });
    return cursor;
  }

  getCursors(sessionId: string): CursorPosition[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.users.values())
      .filter(u => u.isOnline && u.cursor)
      .map(u => u.cursor!);
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  addComment(
    sessionId: string,
    userId: string,
    text: string,
    position: number,
    length = 0,
  ): Comment {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const comment: Comment = {
      id:          `comment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId,
      documentId:  session.documentId,
      userId,
      text,
      position,
      length,
      resolved:    false,
      replies:     [],
      createdAt:   new Date(),
      updatedAt:   new Date(),
    };
    this.comments.set(comment.id, comment);
    session.lastActivityAt = new Date();

    logger.info('Comment added', { commentId: comment.id, sessionId, userId });
    this.emit('comment:added', { sessionId, comment });
    this.broadcastChange(sessionId, 'comment:added', { comment });
    return comment;
  }

  replyToComment(commentId: string, userId: string, text: string): CommentReply {
    const comment = this.comments.get(commentId);
    if (!comment) throw new Error(`Comment not found: ${commentId}`);
    const reply: CommentReply = {
      id:        `reply_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      text,
      createdAt: new Date(),
    };
    comment.replies.push(reply);
    comment.updatedAt = new Date();
    this.emit('comment:reply', { commentId, reply });
    this.broadcastChange(comment.sessionId, 'comment:reply', { commentId, reply });
    return reply;
  }

  resolveComment(commentId: string, resolvedBy: string): Comment {
    const comment = this.comments.get(commentId);
    if (!comment) throw new Error(`Comment not found: ${commentId}`);
    comment.resolved   = true;
    comment.resolvedBy = resolvedBy;
    comment.resolvedAt = new Date();
    comment.updatedAt  = new Date();
    this.emit('comment:resolved', { commentId, resolvedBy });
    this.broadcastChange(comment.sessionId, 'comment:resolved', { commentId });
    return comment;
  }

  getComments(sessionId: string, includeResolved = false): Comment[] {
    return Array.from(this.comments.values()).filter(
      c => c.sessionId === sessionId && (includeResolved || !c.resolved)
    );
  }

  // ── Annotations ───────────────────────────────────────────────────────────

  addAnnotation(
    sessionId: string,
    userId: string,
    type: Annotation['type'],
    position: number,
    length: number,
    options?: { color?: string; note?: string },
  ): Annotation {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const annotation: Annotation = {
      id:         `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId,
      documentId: session.documentId,
      userId,
      type,
      position,
      length,
      color:      options?.color,
      note:       options?.note,
      createdAt:  new Date(),
    };
    this.annotations.set(annotation.id, annotation);
    logger.info('Annotation added', { annotationId: annotation.id, sessionId, type });
    this.emit('annotation:added', { sessionId, annotation });
    this.broadcastChange(sessionId, 'annotation:added', { annotation });
    return annotation;
  }

  removeAnnotation(annotationId: string): boolean {
    const ann = this.annotations.get(annotationId);
    if (!ann) return false;
    this.annotations.delete(annotationId);
    this.emit('annotation:removed', { annotationId });
    this.broadcastChange(ann.sessionId, 'annotation:removed', { annotationId });
    return true;
  }

  getAnnotations(sessionId: string): Annotation[] {
    return Array.from(this.annotations.values()).filter(a => a.sessionId === sessionId);
  }

  // ── Revision history ──────────────────────────────────────────────────────

  getRevisionHistory(documentId: string, limit = 50): Revision[] {
    const cacheKey = `revisions_${documentId}_${limit}`;
    const cached = cache.get<Revision[]>(cacheKey);
    if (cached) return cached;

    const revisions = (this.revisions.get(documentId) ?? []).slice(-limit);
    cache.set(cacheKey, revisions, 30);
    return revisions;
  }

  getRevision(documentId: string, revisionNumber: number): Revision | undefined {
    return (this.revisions.get(documentId) ?? []).find(r => r.revision === revisionNumber);
  }

  revertToRevision(sessionId: string, revisionNumber: number, userId: string): CollabSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const rev = this.getRevision(session.documentId, revisionNumber);
    if (!rev) throw new Error(`Revision ${revisionNumber} not found`);

    const revertOp: Omit<Operation, 'id' | 'applied'> = {
      sessionId,
      userId,
      type: 'insert',
      position: 0,
      content: rev.contentSnapshot,
      revision: session.currentRevision,
      timestamp: new Date(),
    };

    // Replace content directly (soft revert: insert revert as new revision)
    const deleteOp: Omit<Operation, 'id' | 'applied'> = {
      sessionId, userId, type: 'delete',
      position: 0, length: session.content.length,
      revision: session.currentRevision, timestamp: new Date(),
    };
    this.applyOperation(deleteOp);
    if (rev.contentSnapshot.length > 0) this.applyOperation(revertOp);

    logger.info('Session reverted', { sessionId, revisionNumber, userId });
    return session;
  }

  // ── Broadcasting ──────────────────────────────────────────────────────────

  broadcastChange(sessionId: string, eventType: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const onlineUsers = Array.from(session.users.values()).filter(u => u.isOnline).map(u => u.id);
    this.emit('broadcast', { sessionId, eventType, data, recipients: onlineUsers });
    // In a real system this would push to WebSocket connections / SSE streams
  }

  // ── Presence ──────────────────────────────────────────────────────────────

  getPresence(sessionId: string): CollabUser[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.users.values()).filter(u => u.isOnline);
  }

  updatePresence(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    const user    = session?.users.get(userId);
    if (user) user.lastActiveAt = new Date();
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  listSessions(documentId?: string): CollabSession[] {
    const all = Array.from(this.sessions.values());
    return documentId ? all.filter(s => s.documentId === documentId) : all;
  }

  getSessionStats(sessionId: string): {
    userCount: number; onlineUsers: number; revisionCount: number; commentCount: number; annotationCount: number;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return {
      userCount:       session.users.size,
      onlineUsers:     Array.from(session.users.values()).filter(u => u.isOnline).length,
      revisionCount:   (this.revisions.get(session.documentId) ?? []).length,
      commentCount:    this.getComments(sessionId, true).length,
      annotationCount: this.getAnnotations(sessionId).length,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export default function getRealtimeCollaborationEngine(): RealtimeCollaborationEngine {
  if (!(globalThis as any).__realtimeCollaborationEngine__) {
    (globalThis as any).__realtimeCollaborationEngine__ = new RealtimeCollaborationEngine();
  }
  return (globalThis as any).__realtimeCollaborationEngine__;
}
