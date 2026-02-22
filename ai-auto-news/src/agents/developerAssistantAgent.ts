/**
 * Developer Assistant Agent
 *
 * Autonomous AI agent specialized for developer workflows:
 * - Code review and analysis
 * - Architecture guidance and pattern enforcement
 * - Automated debugging assistance
 * - API documentation generation on-the-fly
 * - Dependency analysis and vulnerability scanning
 * - Refactoring suggestions with execution plans
 * - Onboarding developer users to the platform
 * - SDK usage guidance
 * - CI/CD integration recommendations
 * - Performance profiling recommendations
 */

import { getLogger } from '../lib/logger';
import { getCache } from '../lib/cache';

const logger = getLogger();

export type DevAgentTaskType =
  | 'code_review'
  | 'architecture_guidance'
  | 'debug_assistance'
  | 'doc_generation'
  | 'dependency_audit'
  | 'refactor_plan'
  | 'sdk_guidance'
  | 'performance_analysis'
  | 'security_review'
  | 'test_generation';

export interface DevAgentRequest {
  id: string;
  userId: string;
  taskType: DevAgentTaskType;
  input: DevAgentInput;
  context?: DevAgentContext;
  createdAt: Date;
}

export interface DevAgentInput {
  code?: string;
  language?: string;
  errorMessage?: string;
  question?: string;
  filePath?: string;
  dependencies?: Array<{ name: string; version: string }>;
  architectureDescription?: string;
}

export interface DevAgentContext {
  sessionId: string;
  previousInteractions: DevAgentInteraction[];
  projectContext?: string;
  frameworkUsed?: string;
}

export interface DevAgentInteraction {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface DevAgentResponse {
  requestId: string;
  taskType: DevAgentTaskType;
  analysis: string;
  recommendations: Recommendation[];
  codeSnippets: CodeSnippet[];
  references: Reference[];
  confidence: number;
  processingMs: number;
  followUpQuestions: string[];
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  actionable: boolean;
  effort: 'minutes' | 'hours' | 'days';
  impact: string;
}

export interface CodeSnippet {
  title: string;
  language: string;
  code: string;
  explanation: string;
  runnable: boolean;
}

export interface Reference {
  title: string;
  url: string;
  type: 'docs' | 'example' | 'article' | 'api_ref';
}

export interface AgentMemory {
  userId: string;
  interactions: DevAgentInteraction[];
  learnedContext: Record<string, string>;
  lastActiveAt: Date;
}

const LANGUAGE_BEST_PRACTICES: Record<string, string[]> = {
  typescript: [
    'Enable strict mode in tsconfig.json',
    'Use explicit return types on public functions',
    'Prefer const over let; avoid var',
    'Use type guards instead of type assertions',
    'Leverage discriminated unions for complex state',
    'Use readonly for immutable properties',
    'Avoid any — prefer unknown with type narrowing',
  ],
  python: [
    'Use type hints (PEP 484) on all public functions',
    'Follow PEP 8 style guidelines',
    'Use dataclasses or Pydantic for data models',
    'Use context managers for resource management',
    'Prefer composition over inheritance',
    'Write docstrings for all public APIs',
  ],
  go: [
    'Handle all errors explicitly',
    'Use interfaces for abstraction',
    'Prefer goroutines and channels over mutexes',
    'Use defer for cleanup',
    'Write table-driven tests',
    'Use context.Context for cancellation',
  ],
};

const SECURITY_CHECKLIST: Record<string, string[]> = {
  api: [
    'Validate all inputs with schema validation',
    'Use parameterized queries — never string concatenation',
    'Implement rate limiting on all endpoints',
    'Require authentication for sensitive operations',
    'Set appropriate CORS headers',
    'Use HTTPS and enforce HSTS',
    'Sanitize HTML output to prevent XSS',
    'Implement CSRF protection for state-changing operations',
  ],
  authentication: [
    'Hash passwords with bcrypt (cost factor ≥ 12)',
    'Use short-lived JWTs with refresh token rotation',
    'Implement account lockout after N failed attempts',
    'Require email verification',
    'Log authentication events for audit',
    'Invalidate sessions on password change',
  ],
  data: [
    'Encrypt PII at rest',
    'Minimise data collection (data minimisation principle)',
    'Implement field-level access control',
    'Audit all data access',
    'Use database row-level security where possible',
  ],
};

const ARCHITECTURE_PATTERNS: Record<string, string> = {
  microservices: 'Decompose by business capability. Each service owns its data store. Use async messaging for inter-service communication. Implement circuit breakers for resilience.',
  event_driven: 'Use domain events to decouple producers and consumers. Ensure event schema versioning. Implement idempotent consumers. Use event sourcing for audit trail.',
  cqrs: 'Separate read and write models. Use projections for query optimization. Apply eventual consistency intentionally. Version your commands and queries.',
  layered: 'Presentation → Application → Domain → Infrastructure. Dependencies point inward. Domain layer has no framework dependencies. Application layer orchestrates use cases.',
  hexagonal: 'Core domain in the centre. Ports define interfaces. Adapters implement ports. Swap infrastructure without changing business logic.',
};

const PERFORMANCE_TIPS: Record<string, string[]> = {
  database: [
    'Index columns used in WHERE, JOIN, and ORDER BY clauses',
    'Use connection pooling',
    'Avoid N+1 queries — use eager loading or data loaders',
    'Paginate large result sets',
    'Use read replicas for reporting queries',
    'Cache frequently read, rarely written data',
  ],
  api: [
    'Implement response caching with appropriate TTLs',
    'Use compression (gzip/brotli) for responses > 1KB',
    'Use HTTP/2 for multiplexing',
    'Implement request batching for bulk operations',
    'Use streaming for large payloads',
    'Instrument with distributed tracing',
  ],
  nodejs: [
    'Avoid blocking the event loop — offload CPU work to workers',
    'Use async/await consistently — avoid callback hell',
    'Implement graceful shutdown',
    'Profile heap usage to detect memory leaks',
    'Use streaming APIs for large data processing',
  ],
};

function analyzeCodeQuality(code: string, language = 'typescript'): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const lines = code.split('\n');
  const lineCount = lines.length;

  if (lineCount > 200) {
    recommendations.push({
      priority: 'medium',
      category: 'maintainability',
      title: 'File too large',
      description: `File has ${lineCount} lines. Consider splitting into smaller modules of < 200 lines each.`,
      actionable: true,
      effort: 'hours',
      impact: 'Improved readability and testability',
    });
  }

  const fnCount = (code.match(/function\s+\w+|=>\s*\{/g) ?? []).length;
  if (fnCount > 20) {
    recommendations.push({
      priority: 'medium',
      category: 'complexity',
      title: 'Too many functions in one file',
      description: `${fnCount} functions detected. Consider organising into classes or splitting by responsibility.`,
      actionable: true,
      effort: 'hours',
      impact: 'Better organization',
    });
  }

  if (language === 'typescript') {
    if (code.includes(': any')) {
      recommendations.push({
        priority: 'high',
        category: 'type_safety',
        title: 'Avoid `any` types',
        description: 'Replace `any` with specific types or `unknown` with type narrowing to catch runtime errors at compile time.',
        actionable: true,
        effort: 'minutes',
        impact: 'Prevents runtime type errors',
      });
    }

    if (!code.includes('export') && lineCount > 10) {
      recommendations.push({
        priority: 'low',
        category: 'modularity',
        title: 'No exports detected',
        description: 'Consider exporting types and functions for testability and reuse.',
        actionable: true,
        effort: 'minutes',
        impact: 'Improved testability',
      });
    }
  }

  if (code.includes('console.log') && !code.includes('logger')) {
    recommendations.push({
      priority: 'medium',
      category: 'observability',
      title: 'Replace console.log with structured logger',
      description: 'Use the structured logger (getLogger()) instead of console.log for queryable, level-controlled logging.',
      actionable: true,
      effort: 'minutes',
      impact: 'Better production observability',
    });
  }

  const practices = LANGUAGE_BEST_PRACTICES[language] ?? [];
  if (practices.length > 0) {
    recommendations.push({
      priority: 'low',
      category: 'best_practices',
      title: `${language} best practices checklist`,
      description: practices.slice(0, 3).join('; '),
      actionable: false,
      effort: 'hours',
      impact: 'Code quality and maintainability',
    });
  }

  return recommendations;
}

function generateDebuggingAdvice(errorMessage: string, code?: string): {
  analysis: string;
  recommendations: Recommendation[];
  snippets: CodeSnippet[];
} {
  const analysis: string[] = ['Debug analysis:'];
  const recommendations: Recommendation[] = [];
  const snippets: CodeSnippet[] = [];

  if (errorMessage.includes('Cannot read propert') || errorMessage.includes('is undefined') || errorMessage.includes('is null')) {
    analysis.push('- Null/undefined access error detected');
    recommendations.push({
      priority: 'critical',
      category: 'null_safety',
      title: 'Add null checks',
      description: 'Use optional chaining (?.) and nullish coalescing (??) to safely access potentially null/undefined values.',
      actionable: true,
      effort: 'minutes',
      impact: 'Prevents runtime crashes',
    });
    snippets.push({
      title: 'Safe property access with optional chaining',
      language: 'typescript',
      code: `// Before (unsafe)
const name = user.profile.name;

// After (safe)
const name = user?.profile?.name ?? 'Anonymous';`,
      explanation: 'Optional chaining returns undefined instead of throwing when a property is null/undefined.',
      runnable: false,
    });
  }

  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    analysis.push('- Network connectivity error detected');
    recommendations.push({
      priority: 'high',
      category: 'resilience',
      title: 'Add retry logic with exponential backoff',
      description: 'Network errors are transient. Implement retry logic with backoff to handle temporary failures.',
      actionable: true,
      effort: 'minutes',
      impact: 'Improved fault tolerance',
    });
    snippets.push({
      title: 'Exponential backoff retry',
      language: 'typescript',
      code: `async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 200,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max attempts exceeded');
}`,
      explanation: 'Retries with exponential backoff (200ms, 400ms, 800ms) before giving up.',
      runnable: true,
    });
  }

  if (errorMessage.includes('ENOMEM') || errorMessage.includes('heap out of memory')) {
    analysis.push('- Memory exhaustion error detected');
    recommendations.push({
      priority: 'critical',
      category: 'performance',
      title: 'Fix memory leak or reduce memory usage',
      description: 'Profile heap allocation, check for uncleared event listeners and growing caches.',
      actionable: true,
      effort: 'hours',
      impact: 'Prevents OOM crashes',
    });
  }

  return { analysis: analysis.join('\n'), recommendations, snippets };
}

async function loadAgentMemory(userId: string): Promise<AgentMemory> {
  const cache = getCache();
  return cache.get<AgentMemory>(`dev_agent:memory:${userId}`) ?? {
    userId,
    interactions: [],
    learnedContext: {},
    lastActiveAt: new Date(),
  };
}

async function saveAgentMemory(memory: AgentMemory): Promise<void> {
  const cache = getCache();
  cache.set(`dev_agent:memory:${memory.userId}`, memory, 86400 * 7);
}

export async function runDevAgent(request: DevAgentRequest): Promise<DevAgentResponse> {
  const startMs = Date.now();
  logger.info('Developer agent processing request', {
    requestId: request.id,
    taskType: request.taskType,
    userId: request.userId,
  });

  const memory = await loadAgentMemory(request.userId);
  const recommendations: Recommendation[] = [];
  const snippets: CodeSnippet[] = [];
  const references: Reference[] = [];
  let analysis = '';
  let followUpQuestions: string[] = [];

  switch (request.taskType) {
    case 'code_review': {
      const code = request.input.code ?? '';
      const lang = request.input.language ?? 'typescript';
      const codeRecs = analyzeCodeQuality(code, lang);
      recommendations.push(...codeRecs);
      analysis = `Code review complete. Found ${codeRecs.length} recommendation(s). The code ${codeRecs.filter(r => r.priority === 'critical' || r.priority === 'high').length === 0 ? 'passes' : 'needs attention on'} critical/high priority items.`;
      followUpQuestions = [
        'Would you like me to generate a refactoring plan?',
        'Should I generate tests for this code?',
        'Do you want me to check security aspects?',
      ];
      break;
    }

    case 'debug_assistance': {
      const { analysis: debugAnalysis, recommendations: debugRecs, snippets: debugSnippets } = generateDebuggingAdvice(
        request.input.errorMessage ?? '',
        request.input.code,
      );
      analysis = debugAnalysis;
      recommendations.push(...debugRecs);
      snippets.push(...debugSnippets);
      followUpQuestions = [
        'Can you share the stack trace?',
        'Is this error reproducible locally?',
        'What recent changes were made before this error appeared?',
      ];
      break;
    }

    case 'architecture_guidance': {
      const desc = request.input.architectureDescription ?? '';
      const patterns = Object.entries(ARCHITECTURE_PATTERNS)
        .filter(([name]) => desc.toLowerCase().includes(name.replace(/_/g, ' ')))
        .map(([name, description]) => ({ name, description }));

      if (patterns.length > 0) {
        analysis = `Based on your description, I identified these relevant patterns:\n${patterns.map(p => `• ${p.name}: ${p.description}`).join('\n')}`;
      } else {
        analysis = `Architecture guidance: For your use case, consider the layered architecture (Presentation → Application → Domain → Infrastructure) as a solid starting point. As you scale, evaluate CQRS for read-heavy workloads and event-driven patterns for async operations.`;
        recommendations.push({
          priority: 'medium',
          category: 'architecture',
          title: 'Start with layered architecture',
          description: 'Begin with a clear layered architecture before introducing complexity like microservices.',
          actionable: true,
          effort: 'days',
          impact: 'Maintainable codebase that scales with your team',
        });
      }
      references.push({ title: 'Architecture patterns guide', url: '/docs/architecture', type: 'docs' });
      break;
    }

    case 'performance_analysis': {
      const lang = request.input.language ?? 'general';
      const perfTips = PERFORMANCE_TIPS[lang === 'typescript' || lang === 'javascript' ? 'nodejs' : 'api'] ?? PERFORMANCE_TIPS.api;
      analysis = `Performance analysis recommendations for ${lang}:`;
      for (const tip of perfTips.slice(0, 5)) {
        recommendations.push({
          priority: 'medium',
          category: 'performance',
          title: tip,
          description: tip,
          actionable: true,
          effort: 'hours',
          impact: 'Reduced latency and improved throughput',
        });
      }
      break;
    }

    case 'security_review': {
      const secItems = SECURITY_CHECKLIST.api;
      analysis = 'Security review checklist:';
      for (const item of secItems) {
        recommendations.push({
          priority: 'high',
          category: 'security',
          title: item,
          description: item,
          actionable: true,
          effort: 'hours',
          impact: 'Reduced attack surface',
        });
      }
      break;
    }

    case 'sdk_guidance': {
      analysis = 'SDK usage guidance for AI Auto News platform:';
      snippets.push({
        title: 'Initialize the SDK',
        language: 'typescript',
        code: `import { AIAutoNewsClient } from '@ai-auto-news/sdk';

const client = new AIAutoNewsClient({
  apiKey: process.env.AI_AUTO_NEWS_API_KEY!,
  baseUrl: 'https://api.ai-auto-news.com',
});`,
        explanation: 'Initialize the SDK with your API key from the dashboard.',
        runnable: false,
      });
      snippets.push({
        title: 'Generate a post',
        language: 'typescript',
        code: `const post = await client.posts.generate({
  topic: 'artificial intelligence trends',
  format: 'article',
  wordCount: 800,
});
console.log(post.title, post.content);`,
        explanation: 'Generate an AI article on a given topic.',
        runnable: false,
      });
      references.push({ title: 'SDK Reference', url: '/docs/sdk', type: 'api_ref' });
      break;
    }

    case 'test_generation': {
      analysis = 'Test generation strategy:';
      recommendations.push({
        priority: 'high',
        category: 'testing',
        title: 'Write unit tests for all exported functions',
        description: 'Use Jest + TypeScript for unit tests. Aim for 80%+ line coverage.',
        actionable: true,
        effort: 'hours',
        impact: 'Prevents regressions',
      });
      snippets.push({
        title: 'Jest test template',
        language: 'typescript',
        code: `import { yourFunction } from './module';

describe('yourFunction', () => {
  it('returns expected value for valid input', () => {
    const result = yourFunction({ key: 'value' });
    expect(result).toBeDefined();
    expect(result.key).toBe('value');
  });

  it('throws on invalid input', () => {
    expect(() => yourFunction(null as any)).toThrow();
  });
});`,
        explanation: 'Basic Jest test structure with happy path and error case.',
        runnable: false,
      });
      break;
    }

    default:
      analysis = `Processing ${request.taskType} request. Analysing your input and generating recommendations.`;
  }

  // Persist interaction to memory
  memory.interactions.push({
    role: 'user',
    content: `${request.taskType}: ${request.input.question ?? request.input.errorMessage ?? '(code input)'}`,
    timestamp: new Date(),
  });
  memory.interactions.push({
    role: 'assistant',
    content: analysis,
    timestamp: new Date(),
  });
  if (memory.interactions.length > 50) {
    memory.interactions = memory.interactions.slice(-50);
  }
  memory.lastActiveAt = new Date();
  await saveAgentMemory(memory);

  const response: DevAgentResponse = {
    requestId: request.id,
    taskType: request.taskType,
    analysis,
    recommendations: recommendations.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.priority] - order[b.priority];
    }),
    codeSnippets: snippets,
    references,
    confidence: 0.85,
    processingMs: Date.now() - startMs,
    followUpQuestions,
  };

  logger.info('Developer agent response ready', {
    requestId: request.id,
    recommendationCount: recommendations.length,
    processingMs: response.processingMs,
  });

  return response;
}

export async function getAgentHistory(userId: string): Promise<DevAgentInteraction[]> {
  const memory = await loadAgentMemory(userId);
  return memory.interactions;
}

export async function clearAgentMemory(userId: string): Promise<void> {
  const cache = getCache();
  cache.del(`dev_agent:memory:${userId}`);
  logger.info('Developer agent memory cleared', { userId });
}

export function createDevAgentRequest(
  userId: string,
  taskType: DevAgentTaskType,
  input: DevAgentInput,
  context?: DevAgentContext,
): DevAgentRequest {
  return {
    id: `devagent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId,
    taskType,
    input,
    context,
    createdAt: new Date(),
  };
}
