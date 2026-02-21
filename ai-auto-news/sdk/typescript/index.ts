/**
 * AI Auto News TypeScript SDK
 *
 * Official SDK for interacting with AI Auto News API
 * Supports: Posts, Generation, Analytics, Subscriptions, API Keys
 */

export interface SDKConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  retries?: number;
  version?: string;
}

export interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  slug: string;
  published: boolean;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface GenerateRequest {
  topic: string;
  type: 'blog' | 'news';
  urgency?: 'low' | 'medium' | 'high' | 'breaking';
  targetLength?: number;
  tone?: string;
  audience?: string;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    requestId: string;
    timestamp: string;
    rateLimit?: {
      remaining: number;
      reset: string;
    };
  };
}

export class AIAutoNewsSDK {
  private config: Required<SDKConfig>;
  private headers: Record<string, string>;

  constructor(config: SDKConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.ai-auto-news.com',
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      version: config.version || 'v1',
    };

    this.headers = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ai-auto-news-sdk-ts/2.0.0',
    };
  }

  /**
   * Posts API
   */
  posts = {
    /**
     * List all posts with pagination
     */
    list: async (params?: {
      page?: number;
      limit?: number;
      category?: string;
      published?: boolean;
    }): Promise<APIResponse<Post[]>> => {
      return this.request('GET', '/posts', { params });
    },

    /**
     * Get a single post by ID or slug
     */
    get: async (idOrSlug: string): Promise<APIResponse<Post>> => {
      return this.request('GET', `/posts/${idOrSlug}`);
    },

    /**
     * Create a new post
     */
    create: async (post: Partial<Post>): Promise<APIResponse<Post>> => {
      return this.request('POST', '/posts', { body: post });
    },

    /**
     * Update an existing post
     */
    update: async (id: string, post: Partial<Post>): Promise<APIResponse<Post>> => {
      return this.request('PUT', `/posts/${id}`, { body: post });
    },

    /**
     * Delete a post
     */
    delete: async (id: string): Promise<APIResponse<void>> => {
      return this.request('DELETE', `/posts/${id}`);
    },

    /**
     * Search posts
     */
    search: async (query: string, params?: {
      limit?: number;
      category?: string;
    }): Promise<APIResponse<Post[]>> => {
      return this.request('GET', '/search', {
        params: { q: query, ...params },
      });
    },
  };

  /**
   * Generation API
   */
  generate = {
    /**
     * Generate content
     */
    create: async (request: GenerateRequest): Promise<APIResponse<Post>> => {
      return this.request('POST', '/generate', { body: request });
    },

    /**
     * Get generation status
     */
    status: async (jobId: string): Promise<APIResponse<{
      status: 'pending' | 'processing' | 'completed' | 'failed';
      progress: number;
      result?: Post;
    }>> => {
      return this.request('GET', `/generate/${jobId}`);
    },
  };

  /**
   * Analytics API
   */
  analytics = {
    /**
     * Get usage statistics
     */
    usage: async (params?: {
      start?: string;
      end?: string;
      metric?: string;
    }): Promise<APIResponse<any>> => {
      return this.request('GET', '/analytics/usage', { params });
    },

    /**
     * Get performance metrics
     */
    metrics: async (): Promise<APIResponse<any>> => {
      return this.request('GET', '/analytics/metrics');
    },
  };

  /**
   * Subscriptions API
   */
  subscriptions = {
    /**
     * Get current subscription
     */
    get: async (): Promise<APIResponse<any>> => {
      return this.request('GET', '/subscriptions/current');
    },

    /**
     * Upgrade subscription
     */
    upgrade: async (tier: 'pro' | 'enterprise'): Promise<APIResponse<any>> => {
      return this.request('POST', '/subscriptions/upgrade', { body: { tier } });
    },

    /**
     * Cancel subscription
     */
    cancel: async (): Promise<APIResponse<void>> => {
      return this.request('POST', '/subscriptions/cancel');
    },
  };

  /**
   * API Keys API
   */
  apiKeys = {
    /**
     * List API keys
     */
    list: async (): Promise<APIResponse<any[]>> => {
      return this.request('GET', '/apikeys');
    },

    /**
     * Create new API key
     */
    create: async (params: {
      name: string;
      scopes?: string[];
      expiresAt?: string;
    }): Promise<APIResponse<{ key: string; id: string }>> => {
      return this.request('POST', '/apikeys', { body: params });
    },

    /**
     * Revoke API key
     */
    revoke: async (keyId: string): Promise<APIResponse<void>> => {
      return this.request('DELETE', `/apikeys/${keyId}`);
    },
  };

  /**
   * Webhooks API
   */
  webhooks = {
    /**
     * List webhooks
     */
    list: async (): Promise<APIResponse<any[]>> => {
      return this.request('GET', '/webhooks');
    },

    /**
     * Create webhook
     */
    create: async (params: {
      url: string;
      events: string[];
      secret?: string;
    }): Promise<APIResponse<any>> => {
      return this.request('POST', '/webhooks', { body: params });
    },

    /**
     * Delete webhook
     */
    delete: async (webhookId: string): Promise<APIResponse<void>> => {
      return this.request('DELETE', `/webhooks/${webhookId}`);
    },
  };

  /**
   * Make HTTP request with retry logic
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      params?: Record<string, any>;
      body?: any;
      headers?: Record<string, string>;
    }
  ): Promise<APIResponse<T>> {
    const url = this.buildURL(path, options?.params);
    const headers = { ...this.headers, ...options?.headers };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            success: false,
            error: {
              code: data.error?.code || 'request_failed',
              message: data.error?.message || response.statusText,
              details: data.error?.details,
            },
            metadata: {
              requestId: response.headers.get('x-request-id') || '',
              timestamp: new Date().toISOString(),
            },
          };
        }

        return {
          success: true,
          data: data.data || data,
          metadata: {
            requestId: response.headers.get('x-request-id') || '',
            timestamp: new Date().toISOString(),
            rateLimit: {
              remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '0'),
              reset: response.headers.get('x-ratelimit-reset') || '',
            },
          },
        };
      } catch (error: any) {
        lastError = error;

        // Don't retry on client errors
        if (error.response?.status && error.response.status < 500) {
          break;
        }

        // Exponential backoff
        if (attempt < this.config.retries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    return {
      success: false,
      error: {
        code: 'request_failed',
        message: lastError?.message || 'Request failed after retries',
        details: lastError,
      },
      metadata: {
        requestId: '',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build URL with query parameters
   */
  private buildURL(path: string, params?: Record<string, any>): string {
    const url = new URL(
      `${this.config.baseURL}/api/${this.config.version}${path}`
    );

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    // Use crypto to verify HMAC signature
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    return signature === expectedSignature;
  }
}

/**
 * Create SDK instance
 */
export function createClient(config: SDKConfig): AIAutoNewsSDK {
  return new AIAutoNewsSDK(config);
}

/**
 * Export default
 */
export default AIAutoNewsSDK;
