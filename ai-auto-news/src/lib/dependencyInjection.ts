import { getLogger } from '../lib/logger';

const logger = getLogger();

// ── Enums & Interfaces ──────────────────────────────────────────────────────

export enum Lifetime {
  Singleton = 'singleton',
  Transient = 'transient',
  Scoped = 'scoped',
}

export interface ServiceDescriptor<T = unknown> {
  token: ServiceToken<T>;
  lifetime: Lifetime;
  factory: ServiceFactory<T>;
  name?: string;
  dependencies: ServiceToken[];
  onInit?: (instance: T) => Promise<void> | void;
  onDispose?: (instance: T) => Promise<void> | void;
}

export type ServiceToken<T = unknown> = string | symbol | (new (...args: unknown[]) => T);

export type ServiceFactory<T = unknown> = (container: IContainer) => T;

export interface IContainer {
  resolve<T>(token: ServiceToken<T>, name?: string): T;
  resolveAll<T>(token: ServiceToken<T>): T[];
  has(token: ServiceToken, name?: string): boolean;
  createScope(): IContainer;
  dispose(): Promise<void>;
}

export interface RegistrationBuilder<T> {
  asSingleton(): RegistrationBuilder<T>;
  asTransient(): RegistrationBuilder<T>;
  asScoped(): RegistrationBuilder<T>;
  named(name: string): RegistrationBuilder<T>;
  withDependencies(deps: ServiceToken[]): RegistrationBuilder<T>;
  onInit(hook: (instance: T) => Promise<void> | void): RegistrationBuilder<T>;
  onDispose(hook: (instance: T) => Promise<void> | void): RegistrationBuilder<T>;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class DependencyResolutionError extends Error {
  constructor(
    message: string,
    public readonly token: ServiceToken,
    public readonly resolutionPath: string[],
  ) {
    super(message);
    this.name = 'DependencyResolutionError';
  }
}

export class CircularDependencyError extends DependencyResolutionError {
  constructor(token: ServiceToken, cycle: string[]) {
    super(
      `Circular dependency detected: ${cycle.join(' → ')}`,
      token,
      cycle,
    );
    this.name = 'CircularDependencyError';
  }
}

// ── Token utilities ─────────────────────────────────────────────────────────

function tokenToString(token: ServiceToken): string {
  if (typeof token === 'string') return token;
  if (typeof token === 'symbol') return token.toString();
  return token.name || 'Anonymous';
}

function registryKey(token: ServiceToken, name?: string): string {
  const base = tokenToString(token);
  return name ? `${base}::${name}` : base;
}

// ── Topological sort for dependency ordering ────────────────────────────────

function topologicalSort(descriptors: Map<string, ServiceDescriptor>): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];

  function visit(key: string, path: string[]): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      const cycleStart = path.indexOf(key);
      const cycle = [...path.slice(cycleStart), key];
      throw new CircularDependencyError(key, cycle);
    }

    visiting.add(key);
    path.push(key);

    const descriptor = descriptors.get(key);
    if (descriptor) {
      for (const dep of descriptor.dependencies) {
        const depKey = registryKey(dep);
        if (descriptors.has(depKey)) {
          visit(depKey, [...path]);
        }
      }
    }

    visiting.delete(key);
    visited.add(key);
    order.push(key);
  }

  for (const key of descriptors.keys()) {
    visit(key, []);
  }

  return order;
}

// ── Lazy wrapper for deferred initialization ────────────────────────────────

class Lazy<T> {
  private _value: T | undefined;
  private _initialized = false;

  constructor(private readonly _factory: () => T) {}

  get value(): T {
    if (!this._initialized) {
      this._value = this._factory();
      this._initialized = true;
    }
    return this._value as T;
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  reset(): void {
    this._value = undefined;
    this._initialized = false;
  }
}

// ── Container implementation ────────────────────────────────────────────────

export class Container implements IContainer {
  private readonly descriptors = new Map<string, ServiceDescriptor>();
  private readonly namedDescriptors = new Map<string, Map<string, ServiceDescriptor>>();
  private readonly singletons = new Map<string, Lazy<unknown>>();
  private readonly scopedInstances = new Map<string, unknown>();
  private readonly initializedInstances = new Set<unknown>();
  private readonly disposables: Array<{ instance: unknown; dispose: (i: unknown) => Promise<void> | void }> = [];
  private readonly children = new Set<Container>();
  private readonly parent: Container | null;
  private disposed = false;
  private sortedKeys: string[] | null = null;

  constructor(parent: Container | null = null) {
    this.parent = parent;
  }

  // ── Registration ──────────────────────────────────────────────────────

  register<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): RegistrationBuilder<T> {
    this.ensureNotDisposed();
    this.sortedKeys = null;

    const descriptor: ServiceDescriptor<T> = {
      token,
      lifetime: Lifetime.Singleton,
      factory,
      dependencies: [],
    };

    const key = registryKey(token);
    this.descriptors.set(key, descriptor as ServiceDescriptor);

    logger.debug('Service registered', { token: tokenToString(token), lifetime: descriptor.lifetime });

    const builder: RegistrationBuilder<T> = {
      asSingleton: () => { descriptor.lifetime = Lifetime.Singleton; return builder; },
      asTransient: () => { descriptor.lifetime = Lifetime.Transient; return builder; },
      asScoped: () => { descriptor.lifetime = Lifetime.Scoped; return builder; },
      named: (name: string) => {
        descriptor.name = name;
        this.descriptors.delete(key);
        const namedKey = registryKey(token, name);
        this.descriptors.set(namedKey, descriptor as ServiceDescriptor);
        if (!this.namedDescriptors.has(key)) {
          this.namedDescriptors.set(key, new Map());
        }
        this.namedDescriptors.get(key)!.set(name, descriptor as ServiceDescriptor);
        return builder;
      },
      withDependencies: (deps: ServiceToken[]) => {
        descriptor.dependencies = deps;
        this.sortedKeys = null;
        return builder;
      },
      onInit: (hook) => { descriptor.onInit = hook as (instance: unknown) => Promise<void> | void; return builder; },
      onDispose: (hook) => { descriptor.onDispose = hook as (instance: unknown) => Promise<void> | void; return builder; },
    };

    return builder;
  }

  registerInstance<T>(token: ServiceToken<T>, instance: T, name?: string): void {
    this.ensureNotDisposed();
    this.sortedKeys = null;

    const key = registryKey(token, name);
    const descriptor: ServiceDescriptor<T> = {
      token,
      lifetime: Lifetime.Singleton,
      factory: () => instance,
      name,
      dependencies: [],
    };

    this.descriptors.set(key, descriptor as ServiceDescriptor);
    this.singletons.set(key, new Lazy(() => instance));
    // Force-initialize so value is immediately available
    this.singletons.get(key)!.value;

    if (name) {
      const baseKey = registryKey(token);
      if (!this.namedDescriptors.has(baseKey)) {
        this.namedDescriptors.set(baseKey, new Map());
      }
      this.namedDescriptors.get(baseKey)!.set(name, descriptor as ServiceDescriptor);
    }

    logger.debug('Instance registered', { token: tokenToString(token), name });
  }

  registerFactory<T>(token: ServiceToken<T>, factory: ServiceFactory<T>, lifetime: Lifetime = Lifetime.Transient): void {
    this.register(token, factory);
    const key = registryKey(token);
    const desc = this.descriptors.get(key);
    if (desc) desc.lifetime = lifetime;
  }

  // ── Resolution ────────────────────────────────────────────────────────

  resolve<T>(token: ServiceToken<T>, name?: string): T {
    this.ensureNotDisposed();
    return this.resolveInternal<T>(token, name, []);
  }

  resolveAll<T>(token: ServiceToken<T>): T[] {
    this.ensureNotDisposed();
    const baseKey = registryKey(token);
    const results: T[] = [];

    // Resolve the unnamed registration if present
    if (this.descriptors.has(baseKey)) {
      results.push(this.resolveInternal<T>(token, undefined, []));
    }

    // Resolve all named registrations
    const named = this.namedDescriptors.get(baseKey) ?? this.parent?.namedDescriptors.get(baseKey);
    if (named) {
      for (const name of named.keys()) {
        results.push(this.resolveInternal<T>(token, name, []));
      }
    }

    return results;
  }

  has(token: ServiceToken, name?: string): boolean {
    const key = registryKey(token, name);
    if (this.descriptors.has(key)) return true;
    return this.parent?.has(token, name) ?? false;
  }

  private resolveInternal<T>(token: ServiceToken<T>, name: string | undefined, path: string[]): T {
    const key = registryKey(token, name);
    const displayKey = name ? `${tokenToString(token)}(${name})` : tokenToString(token);

    // Circular dependency detection
    if (path.includes(displayKey)) {
      const cycle = [...path, displayKey];
      logger.error('Circular dependency detected', undefined, { cycle });
      throw new CircularDependencyError(token, cycle);
    }

    const descriptor = this.findDescriptor(key);
    if (!descriptor) {
      throw new DependencyResolutionError(
        `No registration found for "${displayKey}"`,
        token,
        path,
      );
    }

    const nextPath = [...path, displayKey];

    switch (descriptor.lifetime) {
      case Lifetime.Singleton:
        return this.resolveSingleton<T>(key, descriptor, nextPath);
      case Lifetime.Scoped:
        return this.resolveScoped<T>(key, descriptor, nextPath);
      case Lifetime.Transient:
        return this.resolveTransient<T>(descriptor, nextPath);
      default:
        throw new DependencyResolutionError(
          `Unknown lifetime "${descriptor.lifetime}" for "${displayKey}"`,
          token,
          path,
        );
    }
  }

  private findDescriptor(key: string): ServiceDescriptor | undefined {
    return this.descriptors.get(key) ?? this.parent?.findDescriptor(key);
  }

  private resolveSingleton<T>(key: string, descriptor: ServiceDescriptor, path: string[]): T {
    // Singletons are owned by the root container
    if (this.parent) {
      const root = this.getRoot();
      if (root.descriptors.has(key)) {
        return root.resolveSingleton<T>(key, descriptor, path);
      }
    }

    if (!this.singletons.has(key)) {
      this.singletons.set(key, new Lazy(() => this.createInstance(descriptor, path)));
    }
    const instance = this.singletons.get(key)!.value as T;
    this.runInit(instance, descriptor);
    return instance;
  }

  private resolveScoped<T>(key: string, descriptor: ServiceDescriptor, path: string[]): T {
    if (this.scopedInstances.has(key)) {
      return this.scopedInstances.get(key) as T;
    }

    const instance = this.createInstance<T>(descriptor, path);
    this.scopedInstances.set(key, instance);
    this.runInit(instance, descriptor);
    return instance;
  }

  private resolveTransient<T>(descriptor: ServiceDescriptor, path: string[]): T {
    const instance = this.createInstance<T>(descriptor, path);
    this.runInit(instance, descriptor);
    return instance;
  }

  private createInstance<T>(descriptor: ServiceDescriptor, path: string[]): T {
    // Resolve all declared dependencies first to validate the graph
    for (const dep of descriptor.dependencies) {
      this.resolveInternal(dep, undefined, path);
    }

    const instance = descriptor.factory(this) as T;

    if (descriptor.onDispose) {
      this.disposables.push({ instance, dispose: descriptor.onDispose });
    }

    logger.debug('Service created', {
      token: tokenToString(descriptor.token),
      lifetime: descriptor.lifetime,
      name: descriptor.name,
    });

    return instance;
  }

  private runInit<T>(instance: T, descriptor: ServiceDescriptor): void {
    if (descriptor.onInit && !this.initializedInstances.has(instance)) {
      this.initializedInstances.add(instance);
      const result = descriptor.onInit(instance);
      if (result instanceof Promise) {
        result.catch((err: Error) => {
          logger.error('Service init hook failed', err instanceof Error ? err : undefined, { token: tokenToString(descriptor.token) });
        });
      }
    }
  }

  private getRoot(): Container {
    let current: Container = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  // ── Scope management ──────────────────────────────────────────────────

  createScope(): Container {
    this.ensureNotDisposed();
    const child = new Container(this);
    this.children.add(child);
    logger.debug('Child scope created');
    return child;
  }

  // ── Validation ────────────────────────────────────────────────────────

  validate(): void {
    this.ensureNotDisposed();
    logger.info('Validating container registrations');

    // Verify the entire dependency graph is acyclic
    try {
      this.ensureSorted();
    } catch (err) {
      if (err instanceof CircularDependencyError) {
        throw err;
      }
      throw err;
    }

    // Verify every declared dependency has a registration
    for (const [key, descriptor] of this.descriptors) {
      for (const dep of descriptor.dependencies) {
        const depKey = registryKey(dep);
        if (!this.has(dep)) {
          throw new DependencyResolutionError(
            `Unresolved dependency: "${tokenToString(dep)}" required by "${key}"`,
            dep,
            [key],
          );
        }
        // Scoped/transient services must not depend on shorter-lived services from singleton
        if (descriptor.lifetime === Lifetime.Singleton) {
          const depDescriptor = this.findDescriptor(depKey);
          if (depDescriptor && depDescriptor.lifetime === Lifetime.Scoped) {
            throw new DependencyResolutionError(
              `Captive dependency: singleton "${key}" depends on scoped "${depKey}"`,
              dep,
              [key, depKey],
            );
          }
        }
      }
    }

    logger.info('Container validation passed', { registrations: this.descriptors.size });
  }

  private ensureSorted(): string[] {
    if (!this.sortedKeys) {
      this.sortedKeys = topologicalSort(this.descriptors);
    }
    return this.sortedKeys;
  }

  // ── Disposal ──────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    logger.info('Disposing container', {
      singletons: this.singletons.size,
      scoped: this.scopedInstances.size,
      disposables: this.disposables.length,
      children: this.children.size,
    });

    // Dispose children first (innermost scopes first)
    const childDisposals = Array.from(this.children).map((c) => c.dispose());
    await Promise.all(childDisposals);
    this.children.clear();

    // Dispose services in reverse creation order
    const reversed = [...this.disposables].reverse();
    for (const { instance, dispose } of reversed) {
      try {
        await dispose(instance);
      } catch (err) {
        logger.error('Service disposal failed', err instanceof Error ? err : new Error(String(err)));
      }
    }
    this.disposables.length = 0;

    // Clear all caches
    for (const lazy of this.singletons.values()) {
      lazy.reset();
    }
    this.singletons.clear();
    this.scopedInstances.clear();
    this.initializedInstances.clear();

    if (this.parent) {
      this.parent.children.delete(this);
    }

    logger.info('Container disposed');
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Cannot use a disposed container');
    }
  }

  // ── Introspection ─────────────────────────────────────────────────────

  getRegistrations(): ReadonlyMap<string, ServiceDescriptor> {
    return this.descriptors;
  }

  getResolutionOrder(): string[] {
    return this.ensureSorted();
  }
}

// ── Decorator-style metadata helpers ────────────────────────────────────────

const INJECT_METADATA_KEY = Symbol('di:inject');

export interface InjectableOptions {
  lifetime?: Lifetime;
  name?: string;
  dependencies?: ServiceToken[];
}

export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return function (target: Function): void {
    Reflect.defineProperty(target, INJECT_METADATA_KEY, {
      value: {
        lifetime: options.lifetime ?? Lifetime.Singleton,
        name: options.name,
        dependencies: options.dependencies ?? [],
      },
      enumerable: false,
      configurable: false,
    });
  };
}

export function getInjectableMetadata(target: Function): InjectableOptions | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(target, INJECT_METADATA_KEY);
  return descriptor?.value as InjectableOptions | undefined;
}

export function registerClass<T>(
  container: Container,
  token: ServiceToken<T>,
  ctor: new (...args: unknown[]) => T,
): RegistrationBuilder<T> {
  const meta = getInjectableMetadata(ctor);
  const deps = meta?.dependencies ?? [];

  const builder = container.register<T>(token, (c: IContainer) => {
    const args = deps.map((dep) => c.resolve(dep));
    return new ctor(...args);
  }).withDependencies(deps);

  if (meta?.lifetime === Lifetime.Transient) builder.asTransient();
  else if (meta?.lifetime === Lifetime.Scoped) builder.asScoped();
  else builder.asSingleton();

  if (meta?.name) builder.named(meta.name);

  return builder;
}

// ── Container builder for fluent setup ──────────────────────────────────────

export class ContainerBuilder {
  private readonly registrations: Array<(container: Container) => void> = [];

  addSingleton<T>(token: ServiceToken<T>, factory: ServiceFactory<T>, deps?: ServiceToken[]): this {
    this.registrations.push((c) => {
      const b = c.register(token, factory).asSingleton();
      if (deps) b.withDependencies(deps);
    });
    return this;
  }

  addTransient<T>(token: ServiceToken<T>, factory: ServiceFactory<T>, deps?: ServiceToken[]): this {
    this.registrations.push((c) => {
      const b = c.register(token, factory).asTransient();
      if (deps) b.withDependencies(deps);
    });
    return this;
  }

  addScoped<T>(token: ServiceToken<T>, factory: ServiceFactory<T>, deps?: ServiceToken[]): this {
    this.registrations.push((c) => {
      const b = c.register(token, factory).asScoped();
      if (deps) b.withDependencies(deps);
    });
    return this;
  }

  addInstance<T>(token: ServiceToken<T>, instance: T): this {
    this.registrations.push((c) => c.registerInstance(token, instance));
    return this;
  }

  addClass<T>(token: ServiceToken<T>, ctor: new (...args: unknown[]) => T): this {
    this.registrations.push((c) => registerClass(c, token, ctor));
    return this;
  }

  build(): Container {
    const container = new Container();
    for (const reg of this.registrations) {
      reg(container);
    }
    logger.info('Container built via builder', { registrations: this.registrations.length });
    return container;
  }
}

// ── Convenience token factory ───────────────────────────────────────────────

export function createToken<T>(description: string): ServiceToken<T> {
  return Symbol(description) as ServiceToken<T>;
}
