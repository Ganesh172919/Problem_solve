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
