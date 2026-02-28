import { jest } from '@jest/globals';

// Mock environment variables
(process.env as Record<string, string>)['NODE_ENV'] = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-key-for-jwt-token-generation';
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.PERPLEXITY_API_KEY = 'test-perplexity-key';

// Global test utilities
(globalThis as unknown as Record<string, unknown>)['mockConsole'] = () => {
  global.console = {
    ...console,
    error: jest.fn() as typeof console.error,
    warn: jest.fn() as typeof console.warn,
    log: jest.fn() as typeof console.log,
  };
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Clean up global singleton timers (auto-publisher & task queue) after all tests
afterAll(() => {
  const g = globalThis as unknown as Record<string, { intervalId?: ReturnType<typeof setInterval> | null; running?: boolean }>;

  // Stop auto-publisher scheduler
  const pubState = g['__autoPublisherState__'];
  if (pubState?.intervalId) {
    clearInterval(pubState.intervalId);
    pubState.intervalId = null;
    pubState.running = false;
  }

  // Stop task queue
  const queueState = g['__taskQueueState__'];
  if (queueState?.intervalId) {
    clearInterval(queueState.intervalId);
    queueState.intervalId = null;
    queueState.running = false;
  }
});
