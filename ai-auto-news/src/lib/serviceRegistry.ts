import { getLogger } from '../lib/logger';

const logger = getLogger();

export type ServiceStatus = 'registered' | 'healthy' | 'unhealthy' | 'deregistered';
export type LoadBalanceStrategy = 'round-robin' | 'least-connections' | 'weighted' | 'random';
export type CircuitBreakerStatus = 'closed' | 'open' | 'half-open';

export interface ServiceMetadata {
  name: string;
  version: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'grpc' | 'tcp';
  tags: string[];
  healthEndpoint: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface ServiceInstance {
  id: string;
  meta: ServiceMetadata;
  status: ServiceStatus;
  registeredAt: number;
  lastHeartbeat: number;
  activeConnections: number;
  circuitBreaker: InstanceCircuitBreaker;
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
}

export interface InstanceCircuitBreaker {
  status: CircuitBreakerStatus;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
}

export interface HealthCheckConfig {
  intervalMs: number;
  timeoutMs: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
  deregisterAfterMs: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  openDurationMs: number;
}

export interface ServiceRegistryConfig {
  healthCheck: HealthCheckConfig;
  circuitBreaker: CircuitBreakerConfig;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  defaultLoadBalanceStrategy: LoadBalanceStrategy;
}

export interface ServiceEvent {
  type: 'registered' | 'healthy' | 'unhealthy' | 'deregistered' | 'circuit-open' | 'circuit-closed';
  serviceId: string;
  serviceName: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export type ServiceEventListener = (event: ServiceEvent) => void;

export interface ServiceDependency {
  serviceName: string;
  required: boolean;
  versionRange?: string;
}

export interface DnsLookupResult {
  host: string;
  port: number;
  protocol: string;
  weight: number;
  priority: number;
}

const DEFAULT_CONFIG: ServiceRegistryConfig = {
  healthCheck: {
    intervalMs: 10_000,
    timeoutMs: 5_000,
    unhealthyThreshold: 3,
    healthyThreshold: 2,
    deregisterAfterMs: 60_000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 3,
    openDurationMs: 30_000,
  },
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 30_000,
  defaultLoadBalanceStrategy: 'round-robin',
};

function generateId(name: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `${name}-${Date.now()}-${rand}`;
}

function satisfiesVersion(actual: string, range: string): boolean {
  const parts = actual.split('.').map(Number);
  const [aMajor = 0, aMinor = 0, aPatch = 0] = parts;

  if (range.startsWith('>=')) {
    const req = range.slice(2).split('.').map(Number);
    return compareTuples([aMajor, aMinor, aPatch], [req[0] ?? 0, req[1] ?? 0, req[2] ?? 0]) >= 0;
  }
  if (range.startsWith('>')) {
    const req = range.slice(1).split('.').map(Number);
    return compareTuples([aMajor, aMinor, aPatch], [req[0] ?? 0, req[1] ?? 0, req[2] ?? 0]) > 0;
  }
  if (range.startsWith('<=')) {
    const req = range.slice(2).split('.').map(Number);
    return compareTuples([aMajor, aMinor, aPatch], [req[0] ?? 0, req[1] ?? 0, req[2] ?? 0]) <= 0;
  }
  if (range.startsWith('<')) {
    const req = range.slice(1).split('.').map(Number);
    return compareTuples([aMajor, aMinor, aPatch], [req[0] ?? 0, req[1] ?? 0, req[2] ?? 0]) < 0;
  }
  if (range.startsWith('^')) {
    const req = range.slice(1).split('.').map(Number);
    const [rMajor = 0, rMinor = 0, rPatch = 0] = req;
    if (aMajor !== rMajor) return false;
    return compareTuples([aMinor, aPatch], [rMinor, rPatch]) >= 0;
  }
  if (range.startsWith('~')) {
    const req = range.slice(1).split('.').map(Number);
    const [rMajor = 0, rMinor = 0, rPatch = 0] = req;
    if (aMajor !== rMajor || aMinor !== rMinor) return false;
    return aPatch >= rPatch;
  }
  // Exact match
  return actual === range;
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class ServiceRegistry {
  private instances: Map<string, ServiceInstance> = new Map();
  private roundRobinCounters: Map<string, number> = new Map();
  private listeners: Map<string, ServiceEventListener[]> = new Map();
  private dependencies: Map<string, ServiceDependency[]> = new Map();
  private healthCheckTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: ServiceRegistryConfig;
  private running = false;
  private healthCheckFn: ((instance: ServiceInstance) => Promise<boolean>) | null = null;

  constructor(config: Partial<ServiceRegistryConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      healthCheck: { ...DEFAULT_CONFIG.healthCheck, ...config.healthCheck },
      circuitBreaker: { ...DEFAULT_CONFIG.circuitBreaker, ...config.circuitBreaker },
    };
  }
  register(meta: ServiceMetadata): string {
    const id = generateId(meta.name);
    const instance: ServiceInstance = {
      id,
      meta: { ...meta, tags: [...meta.tags], weight: meta.weight ?? 1 },
      status: 'registered',
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      activeConnections: 0,
      circuitBreaker: { status: 'closed', failureCount: 0, successCount: 0 },
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
    };

    this.instances.set(id, instance);
    logger.info('Service registered', { serviceId: id, name: meta.name, version: meta.version });
    this.emit({ type: 'registered', serviceId: id, serviceName: meta.name, timestamp: Date.now() });

    if (this.running) {
      this.startHealthCheckForInstance(id);
    }
    return id;
  }
  deregister(serviceId: string): boolean {
    const instance = this.instances.get(serviceId);
    if (!instance) {
      logger.warn('Attempted to deregister unknown service', { serviceId });
      return false;
    }

    this.stopHealthCheckForInstance(serviceId);
    instance.status = 'deregistered';
    this.emit({
      type: 'deregistered',
      serviceId,
      serviceName: instance.meta.name,
      timestamp: Date.now(),
    });

    logger.info('Service deregistered', { serviceId, name: instance.meta.name });
    this.instances.delete(serviceId);
    return true;
  }
  findByName(name: string): ServiceInstance[] {
    const results: ServiceInstance[] = [];
    for (const inst of this.instances.values()) {
      if (inst.meta.name === name && inst.status !== 'deregistered') {
        results.push(inst);
      }
    }
    return results;
  }
  findByTags(tags: string[], matchAll = true): ServiceInstance[] {
    const results: ServiceInstance[] = [];
    for (const inst of this.instances.values()) {
      if (inst.status === 'deregistered') continue;
      const matches = matchAll
        ? tags.every(t => inst.meta.tags.includes(t))
        : tags.some(t => inst.meta.tags.includes(t));
      if (matches) results.push(inst);
    }
    return results;
  }
  findByVersion(name: string, versionRange: string): ServiceInstance[] {
    return this.findByName(name).filter(inst =>
      satisfiesVersion(inst.meta.version, versionRange),
    );
  }
  findHealthy(name: string): ServiceInstance[] {
    return this.findByName(name).filter(
      inst => inst.status === 'healthy' && inst.circuitBreaker.status !== 'open',
    );
  }
  getInstance(serviceId: string): ServiceInstance | undefined {
    return this.instances.get(serviceId);
  }
  getAllInstances(): ServiceInstance[] {
    return Array.from(this.instances.values());
  }
  resolve(name: string, strategy?: LoadBalanceStrategy): ServiceInstance | null {
    const healthy = this.findHealthy(name);
    if (healthy.length === 0) {
      logger.debug('No healthy instances for service', { name });
      return null;
    }

    const s = strategy ?? this.config.defaultLoadBalanceStrategy;
    switch (s) {
      case 'round-robin':
        return this.roundRobin(name, healthy);
      case 'least-connections':
        return this.leastConnections(healthy);
      case 'weighted':
        return this.weighted(healthy);
      case 'random':
        return this.random(healthy);
      default:
        return this.roundRobin(name, healthy);
    }
  }
  private roundRobin(name: string, candidates: ServiceInstance[]): ServiceInstance {
    const current = this.roundRobinCounters.get(name) ?? 0;
    const index = current % candidates.length;
    this.roundRobinCounters.set(name, current + 1);
    return candidates[index];
  }
  private leastConnections(candidates: ServiceInstance[]): ServiceInstance {
    let min = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].activeConnections < min.activeConnections) {
        min = candidates[i];
      }
    }
    return min;
  }
  private weighted(candidates: ServiceInstance[]): ServiceInstance {
    const totalWeight = candidates.reduce((sum, c) => sum + (c.meta.weight ?? 1), 0);
    let random = Math.random() * totalWeight;
    for (const c of candidates) {
      random -= c.meta.weight ?? 1;
      if (random <= 0) return c;
    }
    return candidates[candidates.length - 1];
  }
  private random(candidates: ServiceInstance[]): ServiceInstance {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  acquireConnection(serviceId: string): boolean {
    const inst = this.instances.get(serviceId);
    if (!inst || inst.status === 'deregistered') return false;
    inst.activeConnections++;
    inst.totalRequests++;
    return true;
  }
  releaseConnection(serviceId: string, success: boolean): void {
    const inst = this.instances.get(serviceId);
    if (!inst) return;
    inst.activeConnections = Math.max(0, inst.activeConnections - 1);

    if (success) {
      this.recordSuccess(inst);
    } else {
      inst.totalFailures++;
      this.recordFailure(inst);
    }
  }
  private recordSuccess(inst: ServiceInstance): void {
    const cb = inst.circuitBreaker;
    cb.failureCount = 0;
    inst.consecutiveFailures = 0;

    if (cb.status === 'half-open') {
      cb.successCount++;
      if (cb.successCount >= this.config.circuitBreaker.successThreshold) {
        cb.status = 'closed';
        cb.successCount = 0;
        logger.info('Circuit breaker closed', { serviceId: inst.id, name: inst.meta.name });
        this.emit({
          type: 'circuit-closed',
          serviceId: inst.id,
          serviceName: inst.meta.name,
          timestamp: Date.now(),
        });
      }
    }
  }
  private recordFailure(inst: ServiceInstance): void {
    const cb = inst.circuitBreaker;
    cb.failureCount++;
    cb.lastFailureTime = Date.now();
    inst.consecutiveFailures++;

    if (cb.status === 'half-open') {
      this.openCircuit(inst);
    } else if (cb.status === 'closed' && cb.failureCount >= this.config.circuitBreaker.failureThreshold) {
      this.openCircuit(inst);
    }
  }
  private openCircuit(inst: ServiceInstance): void {
    const cb = inst.circuitBreaker;
    cb.status = 'open';
    cb.nextRetryTime = Date.now() + this.config.circuitBreaker.openDurationMs;
    cb.successCount = 0;
    logger.warn('Circuit breaker opened', {
      serviceId: inst.id,
      name: inst.meta.name,
      failures: cb.failureCount,
    });
    this.emit({
      type: 'circuit-open',
      serviceId: inst.id,
      serviceName: inst.meta.name,
      timestamp: Date.now(),
      details: { failureCount: cb.failureCount },
    });
  }
  getCircuitBreakerStatus(serviceId: string): InstanceCircuitBreaker | null {
    const inst = this.instances.get(serviceId);
    return inst ? { ...inst.circuitBreaker } : null;
  }
  attemptCircuitHalfOpen(serviceId: string): boolean {
    const inst = this.instances.get(serviceId);
    if (!inst) return false;
    const cb = inst.circuitBreaker;
    if (cb.status !== 'open') return false;
    if (cb.nextRetryTime && Date.now() < cb.nextRetryTime) return false;
    cb.status = 'half-open';
    cb.successCount = 0;
    logger.debug('Circuit breaker half-open', { serviceId: inst.id });
    return true;
  }
  resetCircuitBreaker(serviceId: string): void {
    const inst = this.instances.get(serviceId);
    if (!inst) return;
    inst.circuitBreaker = { status: 'closed', failureCount: 0, successCount: 0 };
    inst.consecutiveFailures = 0;
  }
  heartbeat(serviceId: string): boolean {
    const inst = this.instances.get(serviceId);
    if (!inst || inst.status === 'deregistered') return false;
    inst.lastHeartbeat = Date.now();
    if (inst.status === 'registered') {
      inst.status = 'healthy';
      this.emit({
        type: 'healthy',
        serviceId: inst.id,
        serviceName: inst.meta.name,
        timestamp: Date.now(),
      });
    }
    return true;
  }
  private checkHeartbeats(): void {
    const now = Date.now();
    for (const inst of this.instances.values()) {
      if (inst.status === 'deregistered') continue;
      const elapsed = now - inst.lastHeartbeat;
      if (elapsed > this.config.heartbeatTimeoutMs && inst.status !== 'unhealthy') {
        inst.status = 'unhealthy';
        logger.warn('Service heartbeat timeout', {
          serviceId: inst.id,
          name: inst.meta.name,
          elapsedMs: elapsed,
        });
        this.emit({
          type: 'unhealthy',
          serviceId: inst.id,
          serviceName: inst.meta.name,
          timestamp: now,
          details: { reason: 'heartbeat-timeout', elapsedMs: elapsed },
        });
      }
      if (elapsed > this.config.healthCheck.deregisterAfterMs) {
        logger.warn('Auto-deregistering unresponsive service', { serviceId: inst.id });
        this.deregister(inst.id);
      }
    }
  }
  setHealthCheckFunction(fn: (instance: ServiceInstance) => Promise<boolean>): void {
    this.healthCheckFn = fn;
  }
  private startHealthCheckForInstance(serviceId: string): void {
    if (this.healthCheckTimers.has(serviceId)) return;
    const timer = setInterval(() => {
      void this.performHealthCheck(serviceId);
    }, this.config.healthCheck.intervalMs);
    this.healthCheckTimers.set(serviceId, timer);
  }
  private stopHealthCheckForInstance(serviceId: string): void {
    const timer = this.healthCheckTimers.get(serviceId);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(serviceId);
    }
  }
  async performHealthCheck(serviceId: string): Promise<boolean> {
    const inst = this.instances.get(serviceId);
    if (!inst || inst.status === 'deregistered') return false;

    if (!this.healthCheckFn) {
      // Without a custom check function, rely on heartbeat-based health
      return inst.status === 'healthy' || inst.status === 'registered';
    }

    try {
      const healthy = await Promise.race<boolean>([
        this.healthCheckFn(inst),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheck.timeoutMs),
        ),
      ]);

      if (healthy) {
        inst.consecutiveFailures = 0;
        if (inst.status !== 'healthy') {
          inst.status = 'healthy';
          logger.info('Service became healthy', { serviceId, name: inst.meta.name });
          this.emit({
            type: 'healthy',
            serviceId,
            serviceName: inst.meta.name,
            timestamp: Date.now(),
          });
        }
      } else {
        this.handleHealthCheckFailure(inst);
      }
      return healthy;
    } catch (err) {
      this.handleHealthCheckFailure(inst);
      logger.debug('Health check error', {
        serviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
  private handleHealthCheckFailure(inst: ServiceInstance): void {
    inst.consecutiveFailures++;
    if (inst.consecutiveFailures >= this.config.healthCheck.unhealthyThreshold && inst.status !== 'unhealthy') {
      inst.status = 'unhealthy';
      logger.warn('Service marked unhealthy', {
        serviceId: inst.id,
        name: inst.meta.name,
        consecutiveFailures: inst.consecutiveFailures,
      });
      this.emit({
        type: 'unhealthy',
        serviceId: inst.id,
        serviceName: inst.meta.name,
        timestamp: Date.now(),
        details: { consecutiveFailures: inst.consecutiveFailures },
      });
    }
  }
  start(): void {
    if (this.running) return;
    this.running = true;

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
      this.evaluateCircuitBreakers();
    }, this.config.heartbeatIntervalMs);

    for (const id of this.instances.keys()) {
      this.startHealthCheckForInstance(id);
    }
    logger.info('Service registry started');
  }
  async shutdown(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const id of Array.from(this.healthCheckTimers.keys())) {
      this.stopHealthCheckForInstance(id);
    }
    const ids = Array.from(this.instances.keys());
    for (const id of ids) {
      this.deregister(id);
    }
    this.roundRobinCounters.clear();
    this.listeners.clear();
    this.dependencies.clear();
    logger.info('Service registry shut down', { deregistered: ids.length });
  }
  private evaluateCircuitBreakers(): void {
    const now = Date.now();
    for (const inst of this.instances.values()) {
      const cb = inst.circuitBreaker;
      if (cb.status === 'open' && cb.nextRetryTime && now >= cb.nextRetryTime) {
        cb.status = 'half-open';
        cb.successCount = 0;
        logger.debug('Circuit breaker auto half-open', { serviceId: inst.id });
      }
    }
  }
  on(eventType: ServiceEvent['type'], listener: ServiceEventListener): () => void {
    const existing = this.listeners.get(eventType) ?? [];
    existing.push(listener);
    this.listeners.set(eventType, existing);
    return () => {
      const arr = this.listeners.get(eventType);
      if (arr) {
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }
  private emit(event: ServiceEvent): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        logger.error('Event listener error', err instanceof Error ? err : new Error(String(err)), {
          eventType: event.type,
        });
      }
    }
  }
  registerDependencies(serviceName: string, deps: ServiceDependency[]): void {
    this.dependencies.set(serviceName, deps);
    logger.debug('Dependencies registered', { serviceName, count: deps.length });
  }
  getDependencies(serviceName: string): ServiceDependency[] {
    return this.dependencies.get(serviceName) ?? [];
  }
  checkDependencies(serviceName: string): { satisfied: boolean; missing: string[] } {
    const deps = this.getDependencies(serviceName);
    const missing: string[] = [];
    for (const dep of deps) {
      const candidates = dep.versionRange
        ? this.findByVersion(dep.serviceName, dep.versionRange)
        : this.findByName(dep.serviceName);
      const hasHealthy = candidates.some(c => c.status === 'healthy');
      if (!hasHealthy && dep.required) {
        missing.push(dep.serviceName);
      }
    }
    return { satisfied: missing.length === 0, missing };
  }
  getDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    for (const [name, deps] of this.dependencies) {
      graph.set(name, deps.map(d => d.serviceName));
    }
    return graph;
  }
  dnsLookup(serviceName: string): DnsLookupResult[] {
    const healthy = this.findHealthy(serviceName);
    return healthy
      .map((inst, i) => ({
        host: inst.meta.host,
        port: inst.meta.port,
        protocol: inst.meta.protocol,
        weight: inst.meta.weight ?? 1,
        priority: i,
      }))
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  }
  resolveUrl(serviceName: string, strategy?: LoadBalanceStrategy): string | null {
    const inst = this.resolve(serviceName, strategy);
    if (!inst) return null;
    return `${inst.meta.protocol}://${inst.meta.host}:${inst.meta.port}`;
  }
  resolveHealthUrl(serviceName: string): string | null {
    const inst = this.resolve(serviceName);
    if (!inst) return null;
    const base = `${inst.meta.protocol}://${inst.meta.host}:${inst.meta.port}`;
    return `${base}${inst.meta.healthEndpoint}`;
  }
  getStats(): {
    totalInstances: number;
    healthy: number;
    unhealthy: number;
    byService: Record<string, { total: number; healthy: number }>;
  } {
    let healthy = 0;
    let unhealthy = 0;
    const byService: Record<string, { total: number; healthy: number }> = {};

    for (const inst of this.instances.values()) {
      if (inst.status === 'deregistered') continue;
      const name = inst.meta.name;
      if (!byService[name]) byService[name] = { total: 0, healthy: 0 };
      byService[name].total++;
      if (inst.status === 'healthy') {
        healthy++;
        byService[name].healthy++;
      } else {
        unhealthy++;
      }
    }

    return { totalInstances: this.instances.size, healthy, unhealthy, byService };
  }
  getServiceNames(): string[] {
    const names = new Set<string>();
    for (const inst of this.instances.values()) {
      if (inst.status !== 'deregistered') names.add(inst.meta.name);
    }
    return Array.from(names);
  }
  isRunning(): boolean {
    return this.running;
  }
}

let registryInstance: ServiceRegistry | null = null;

export function getServiceRegistry(config?: Partial<ServiceRegistryConfig>): ServiceRegistry {
  if (!registryInstance) {
    registryInstance = new ServiceRegistry(config);
  }
  return registryInstance;
}

export function resetServiceRegistry(): void {
  if (registryInstance) {
    void registryInstance.shutdown();
    registryInstance = null;
  }
}
