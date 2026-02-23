import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeType = 'organization' | 'team' | 'member';
type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
type MemberStatus = 'invited' | 'active' | 'suspended' | 'removed';
type CollaborationPolicy = 'open' | 'request' | 'restricted';

interface OrgNode {
  id: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  description: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface MemberRecord {
  id: string;
  userId: string;
  nodeId: string;
  role: MemberRole;
  status: MemberStatus;
  permissions: string[];
  invitedBy: string | null;
  joinedAt: Date | null;
  updatedAt: Date;
}

interface InheritedPermission {
  permission: string;
  source: string;
  sourceType: NodeType;
  role: MemberRole;
  inherited: boolean;
}

interface CrossTeamPolicy {
  id: string;
  sourceTeamId: string;
  targetTeamId: string;
  policy: CollaborationPolicy;
  allowedPermissions: string[];
  createdAt: Date;
}

interface HierarchyReport {
  nodeId: string;
  name: string;
  type: NodeType;
  depth: number;
  directMembers: number;
  totalMembers: number;
  children: HierarchyReport[];
}

interface MemberLifecycleEvent {
  memberId: string;
  userId: string;
  action: 'invited' | 'joined' | 'left' | 'transferred' | 'role_changed' | 'suspended' | 'removed';
  fromNodeId?: string;
  toNodeId?: string;
  fromRole?: MemberRole;
  toRole?: MemberRole;
  performedBy: string;
  timestamp: Date;
}

// ─── Role Hierarchy ──────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<MemberRole, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  member: 40,
  viewer: 20,
};

const ROLE_DEFAULT_PERMISSIONS: Record<MemberRole, string[]> = {
  owner: ['*'],
  admin: ['read', 'write', 'delete', 'manage_members', 'manage_settings', 'manage_teams'],
  manager: ['read', 'write', 'delete', 'manage_members'],
  member: ['read', 'write'],
  viewer: ['read'],
};

// ─── Implementation ──────────────────────────────────────────────────────────

class OrgHierarchyManager {
  private nodes = new Map<string, OrgNode>();
  private members = new Map<string, MemberRecord>();
  private policies = new Map<string, CrossTeamPolicy>();
  private lifecycleEvents: MemberLifecycleEvent[] = [];
  private childIndex = new Map<string, Set<string>>();
  private nodeMemberIndex = new Map<string, Set<string>>();
  private userMemberIndex = new Map<string, Set<string>>();

  constructor() {
    logger.info('OrgHierarchyManager initialized');
  }

  // ── Node Management ──────────────────────────────────────────────────────

  createNode(
    id: string,
    type: NodeType,
    name: string,
    parentId: string | null,
    description = '',
    settings: Record<string, unknown> = {},
  ): OrgNode {
    if (this.nodes.has(id)) {
      throw new Error(`Node ${id} already exists`);
    }
    if (parentId && !this.nodes.has(parentId)) {
      throw new Error(`Parent node ${parentId} not found`);
    }

    if (parentId) {
      const parent = this.nodes.get(parentId)!;
      if (type === 'organization') {
        throw new Error('Organization nodes cannot have a parent');
      }
      if (type === 'member' && parent.type === 'organization') {
        // Members can be directly under orgs or teams - both valid
      }
      if (type === 'team' && parent.type === 'member') {
        throw new Error('Teams cannot be nested under member nodes');
      }
    } else if (type !== 'organization') {
      throw new Error('Only organization nodes can be root nodes');
    }

    const now = new Date();
    const node: OrgNode = { id, parentId, type, name, description, settings, createdAt: now, updatedAt: now };
    this.nodes.set(id, node);

    if (parentId) {
      if (!this.childIndex.has(parentId)) {
        this.childIndex.set(parentId, new Set());
      }
      this.childIndex.get(parentId)!.add(id);
    }

    logger.info('Org node created', { nodeId: id, type, parentId });
    return node;
  }

  updateNodeSettings(nodeId: string, settings: Record<string, unknown>): OrgNode {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.settings = { ...node.settings, ...settings };
    node.updatedAt = new Date();
    return node;
  }

  getNode(nodeId: string): OrgNode | null {
    return this.nodes.get(nodeId) ?? null;
  }

  getChildren(nodeId: string): OrgNode[] {
    const childIds = this.childIndex.get(nodeId);
    if (!childIds) return [];
    return Array.from(childIds)
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);
  }

  getAncestors(nodeId: string): OrgNode[] {
    const ancestors: OrgNode[] = [];
    let current = this.nodes.get(nodeId);
    while (current?.parentId) {
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;
      ancestors.push(parent);
      current = parent;
    }
    return ancestors;
  }

  // ── Member Lifecycle ─────────────────────────────────────────────────────

  inviteMember(
    userId: string,
    nodeId: string,
    role: MemberRole,
    invitedBy: string,
    permissions?: string[],
  ): MemberRecord {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const existing = this.findMemberInNode(userId, nodeId);
    if (existing && existing.status !== 'removed') {
      throw new Error(`User ${userId} already has membership in node ${nodeId}`);
    }

    const memberId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const record: MemberRecord = {
      id: memberId,
      userId,
      nodeId,
      role,
      status: 'invited',
      permissions: permissions ?? [...ROLE_DEFAULT_PERMISSIONS[role]],
      invitedBy,
      joinedAt: null,
      updatedAt: new Date(),
    };

    this.members.set(memberId, record);
    this.indexMember(record);
    this.recordEvent({ memberId, userId, action: 'invited', toNodeId: nodeId, toRole: role, performedBy: invitedBy, timestamp: new Date() });
    logger.info('Member invited', { memberId, userId, nodeId, role });
    return record;
  }

  acceptInvite(memberId: string): MemberRecord {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);
    if (member.status !== 'invited') {
      throw new Error(`Member ${memberId} is not in invited state (current: ${member.status})`);
    }

    member.status = 'active';
    member.joinedAt = new Date();
    member.updatedAt = new Date();
    this.recordEvent({ memberId, userId: member.userId, action: 'joined', toNodeId: member.nodeId, performedBy: member.userId, timestamp: new Date() });
    logger.info('Member joined', { memberId, nodeId: member.nodeId });
    return member;
  }

  removeMember(memberId: string, performedBy: string): void {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);

    member.status = 'removed';
    member.updatedAt = new Date();
    this.recordEvent({ memberId, userId: member.userId, action: 'removed', fromNodeId: member.nodeId, performedBy, timestamp: new Date() });
    logger.info('Member removed', { memberId, nodeId: member.nodeId });
  }

  suspendMember(memberId: string, performedBy: string): void {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);

    member.status = 'suspended';
    member.updatedAt = new Date();
    this.recordEvent({ memberId, userId: member.userId, action: 'suspended', fromNodeId: member.nodeId, performedBy, timestamp: new Date() });
    logger.info('Member suspended', { memberId });
  }

  transferMember(memberId: string, targetNodeId: string, performedBy: string, newRole?: MemberRole): MemberRecord {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);
    if (!this.nodes.has(targetNodeId)) throw new Error(`Target node ${targetNodeId} not found`);

    const fromNodeId = member.nodeId;
    const fromRole = member.role;

    this.nodeMemberIndex.get(fromNodeId)?.delete(memberId);
    member.nodeId = targetNodeId;
    if (newRole) member.role = newRole;
    member.updatedAt = new Date();

    if (!this.nodeMemberIndex.has(targetNodeId)) {
      this.nodeMemberIndex.set(targetNodeId, new Set());
    }
    this.nodeMemberIndex.get(targetNodeId)!.add(memberId);

    this.recordEvent({
      memberId, userId: member.userId, action: 'transferred',
      fromNodeId, toNodeId: targetNodeId, fromRole, toRole: newRole ?? fromRole,
      performedBy, timestamp: new Date(),
    });
    logger.info('Member transferred', { memberId, fromNodeId, toNodeId: targetNodeId });
    return member;
  }

  changeRole(memberId: string, newRole: MemberRole, performedBy: string): MemberRecord {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`Member ${memberId} not found`);

    const oldRole = member.role;
    member.role = newRole;
    member.permissions = [...ROLE_DEFAULT_PERMISSIONS[newRole]];
    member.updatedAt = new Date();

    this.recordEvent({
      memberId, userId: member.userId, action: 'role_changed',
      toNodeId: member.nodeId, fromRole: oldRole, toRole: newRole,
      performedBy, timestamp: new Date(),
    });
    logger.info('Member role changed', { memberId, oldRole, newRole });
    return member;
  }

  // ── Permission Resolution ────────────────────────────────────────────────

  resolvePermissions(userId: string, targetNodeId: string): InheritedPermission[] {
    const result: InheritedPermission[] = [];
    const targetNode = this.nodes.get(targetNodeId);
    if (!targetNode) return result;

    // Collect ancestor chain including target
    const chain = [targetNode, ...this.getAncestors(targetNodeId)];

    for (const node of chain) {
      const member = this.findActiveMember(userId, node.id);
      if (!member) continue;

      const inherited = node.id !== targetNodeId;
      for (const perm of member.permissions) {
        if (!result.some((r) => r.permission === perm && !inherited)) {
          result.push({
            permission: perm,
            source: node.id,
            sourceType: node.type,
            role: member.role,
            inherited,
          });
        }
      }
    }

    return result;
  }

  hasPermission(userId: string, targetNodeId: string, permission: string): boolean {
    const resolved = this.resolvePermissions(userId, targetNodeId);
    return resolved.some((r) => r.permission === '*' || r.permission === permission);
  }

  getEffectiveRole(userId: string, nodeId: string): MemberRole | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    const chain = [node, ...this.getAncestors(nodeId)];
    let highestRole: MemberRole | null = null;

    for (const n of chain) {
      const member = this.findActiveMember(userId, n.id);
      if (member) {
        if (!highestRole || ROLE_HIERARCHY[member.role] > ROLE_HIERARCHY[highestRole]) {
          highestRole = member.role;
        }
      }
    }
    return highestRole;
  }

  // ── Cross-Team Collaboration ─────────────────────────────────────────────

  setCrossTeamPolicy(
    sourceTeamId: string,
    targetTeamId: string,
    policy: CollaborationPolicy,
    allowedPermissions: string[],
  ): CrossTeamPolicy {
    if (!this.nodes.has(sourceTeamId) || !this.nodes.has(targetTeamId)) {
      throw new Error('Both source and target teams must exist');
    }
    if (sourceTeamId === targetTeamId) {
      throw new Error('Cannot set cross-team policy between a team and itself');
    }

    const id = `policy_${sourceTeamId}_${targetTeamId}`;
    const record: CrossTeamPolicy = {
      id,
      sourceTeamId,
      targetTeamId,
      policy,
      allowedPermissions,
      createdAt: new Date(),
    };
    this.policies.set(id, record);
    logger.info('Cross-team policy set', { sourceTeamId, targetTeamId, policy });
    return record;
  }

  canCollaborate(userId: string, sourceTeamId: string, targetTeamId: string, permission: string): boolean {
    if (sourceTeamId === targetTeamId) {
      return this.hasPermission(userId, sourceTeamId, permission);
    }

    if (!this.findActiveMember(userId, sourceTeamId)) return false;

    const policyKey = `policy_${sourceTeamId}_${targetTeamId}`;
    const reverseKey = `policy_${targetTeamId}_${sourceTeamId}`;
    const policy = this.policies.get(policyKey) ?? this.policies.get(reverseKey);

    if (!policy) return false;
    if (policy.policy === 'restricted') return false;
    if (policy.policy === 'open') {
      return policy.allowedPermissions.includes('*') || policy.allowedPermissions.includes(permission);
    }
    // 'request' policy — requires explicit grant, so default deny
    return false;
  }

  // ── Organization Settings ────────────────────────────────────────────────

  getEffectiveSettings(nodeId: string): Record<string, unknown> {
    const node = this.nodes.get(nodeId);
    if (!node) return {};

    const chain = [...this.getAncestors(nodeId).reverse(), node];
    const merged: Record<string, unknown> = {};

    for (const n of chain) {
      Object.assign(merged, n.settings);
    }
    return merged;
  }

  // ── Reporting ────────────────────────────────────────────────────────────

  buildHierarchyReport(nodeId: string): HierarchyReport | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    const directMembers = this.getActiveMembers(nodeId).length;
    const children = this.getChildren(nodeId).map((child) => this.buildHierarchyReport(child.id)!).filter(Boolean);
    const totalMembers = directMembers + children.reduce((sum, c) => sum + c.totalMembers, 0);
    const depth = this.getAncestors(nodeId).length;

    return { nodeId, name: node.name, type: node.type, depth, directMembers, totalMembers, children };
  }

  getLifecycleEvents(filters?: {
    userId?: string;
    nodeId?: string;
    action?: MemberLifecycleEvent['action'];
    since?: Date;
  }): MemberLifecycleEvent[] {
    let events = [...this.lifecycleEvents];
    if (filters?.userId) events = events.filter((e) => e.userId === filters.userId);
    if (filters?.nodeId) events = events.filter((e) => e.fromNodeId === filters.nodeId || e.toNodeId === filters.nodeId);
    if (filters?.action) events = events.filter((e) => e.action === filters.action);
    if (filters?.since) events = events.filter((e) => e.timestamp >= filters.since!);
    return events;
  }

  getActiveMembers(nodeId: string): MemberRecord[] {
    const memberIds = this.nodeMemberIndex.get(nodeId);
    if (!memberIds) return [];
    return Array.from(memberIds)
      .map((id) => this.members.get(id)!)
      .filter((m) => m && m.status === 'active');
  }

  getUserMemberships(userId: string): MemberRecord[] {
    const memberIds = this.userMemberIndex.get(userId);
    if (!memberIds) return [];
    return Array.from(memberIds)
      .map((id) => this.members.get(id)!)
      .filter((m) => m && m.status !== 'removed');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private findMemberInNode(userId: string, nodeId: string): MemberRecord | undefined {
    const memberIds = this.nodeMemberIndex.get(nodeId);
    if (!memberIds) return undefined;
    for (const id of memberIds) {
      const m = this.members.get(id);
      if (m && m.userId === userId) return m;
    }
    return undefined;
  }

  private findActiveMember(userId: string, nodeId: string): MemberRecord | undefined {
    const member = this.findMemberInNode(userId, nodeId);
    return member?.status === 'active' ? member : undefined;
  }

  private indexMember(record: MemberRecord): void {
    if (!this.nodeMemberIndex.has(record.nodeId)) {
      this.nodeMemberIndex.set(record.nodeId, new Set());
    }
    this.nodeMemberIndex.get(record.nodeId)!.add(record.id);

    if (!this.userMemberIndex.has(record.userId)) {
      this.userMemberIndex.set(record.userId, new Set());
    }
    this.userMemberIndex.get(record.userId)!.add(record.id);
  }

  private recordEvent(event: MemberLifecycleEvent): void {
    this.lifecycleEvents.push(event);
    if (this.lifecycleEvents.length > 10_000) {
      this.lifecycleEvents = this.lifecycleEvents.slice(-5_000);
    }
  }

  getStats(): {
    totalNodes: number;
    totalMembers: number;
    activePolicies: number;
    nodesByType: Record<NodeType, number>;
  } {
    const nodesByType: Record<NodeType, number> = { organization: 0, team: 0, member: 0 };
    for (const node of this.nodes.values()) {
      nodesByType[node.type]++;
    }
    return {
      totalNodes: this.nodes.size,
      totalMembers: this.members.size,
      activePolicies: this.policies.size,
      nodesByType,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__orgHierarchyManager__';

export function getOrgHierarchyManager(): OrgHierarchyManager {
  const g = globalThis as unknown as Record<string, OrgHierarchyManager>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new OrgHierarchyManager();
  }
  return g[GLOBAL_KEY];
}

export type {
  OrgNode,
  NodeType,
  MemberRecord,
  MemberRole,
  MemberStatus,
  InheritedPermission,
  CrossTeamPolicy,
  CollaborationPolicy,
  HierarchyReport,
  MemberLifecycleEvent,
};
