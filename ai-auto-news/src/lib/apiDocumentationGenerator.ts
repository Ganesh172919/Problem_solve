/**
 * API Documentation Generator
 *
 * Automatic API documentation generation:
 * - OpenAPI/Swagger spec generation
 * - Route discovery and analysis
 * - Type inference from code
 * - Example generation
 * - Interactive playground
 * - SDK code samples
 * - Changelog tracking
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface APIEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  summary: string;
  description: string;
  tags: string[];
  parameters: APIParameter[];
  requestBody?: APIRequestBody;
  responses: Record<string, APIResponse>;
  security?: SecurityRequirement[];
  deprecated?: boolean;
  version: string;
}

export interface APIParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description: string;
  required: boolean;
  schema: SchemaObject;
  example?: any;
}

export interface APIRequestBody {
  description: string;
  required: boolean;
  content: Record<string, MediaType>;
}

export interface MediaType {
  schema: SchemaObject;
  examples?: Record<string, Example>;
}

export interface SchemaObject {
  type: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  enum?: any[];
  format?: string;
  example?: any;
}

export interface APIResponse {
  description: string;
  content?: Record<string, MediaType>;
  headers?: Record<string, Header>;
}

export interface Header {
  description: string;
  schema: SchemaObject;
}

export interface Example {
  summary: string;
  value: any;
}

export interface SecurityRequirement {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  bearerFormat?: string;
  in?: 'header' | 'query' | 'cookie';
  name?: string;
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact?: {
      name: string;
      email: string;
      url: string;
    };
    license?: {
      name: string;
      url: string;
    };
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, Record<string, any>>;
  components: {
    schemas: Record<string, SchemaObject>;
    securitySchemes: Record<string, SecurityRequirement>;
  };
  tags: Array<{
    name: string;
    description: string;
  }>;
}

class APIDocumentationGenerator {
  private endpoints: Map<string, APIEndpoint> = new Map();
  private schemas: Map<string, SchemaObject> = new Map();
  private tags: Map<string, string> = new Map();

  constructor() {
    this.initializeCommonSchemas();
    this.initializeTags();
  }

  /**
   * Register API endpoint
   */
  registerEndpoint(endpoint: APIEndpoint): void {
    const key = `${endpoint.method}:${endpoint.path}`;
    this.endpoints.set(key, endpoint);

    logger.debug('API endpoint registered', {
      method: endpoint.method,
      path: endpoint.path,
    });
  }

  /**
   * Register schema
   */
  registerSchema(name: string, schema: SchemaObject): void {
    this.schemas.set(name, schema);
  }

  /**
   * Generate OpenAPI specification
   */
  generateOpenAPISpec(): OpenAPISpec {
    const paths: Record<string, Record<string, any>> = {};

    // Convert endpoints to OpenAPI format
    for (const endpoint of this.endpoints.values()) {
      if (!paths[endpoint.path]) {
        paths[endpoint.path] = {};
      }

      paths[endpoint.path][endpoint.method.toLowerCase()] = {
        summary: endpoint.summary,
        description: endpoint.description,
        tags: endpoint.tags,
        parameters: endpoint.parameters,
        requestBody: endpoint.requestBody,
        responses: endpoint.responses,
        security: endpoint.security,
        deprecated: endpoint.deprecated,
      };
    }

    const spec: OpenAPISpec = {
      openapi: '3.0.3',
      info: {
        title: 'AI Auto News API',
        version: '1.0.0',
        description: 'Enterprise-grade AI-powered content generation and management platform',
        contact: {
          name: 'API Support',
          email: 'support@aiautonews.com',
          url: 'https://aiautonews.com/support',
        },
        license: {
          name: 'Proprietary',
          url: 'https://aiautonews.com/license',
        },
      },
      servers: [
        {
          url: 'https://api.aiautonews.com/v1',
          description: 'Production server',
        },
        {
          url: 'https://staging-api.aiautonews.com/v1',
          description: 'Staging server',
        },
        {
          url: 'http://localhost:3000/api/v1',
          description: 'Development server',
        },
      ],
      paths,
      components: {
        schemas: Object.fromEntries(this.schemas),
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: Array.from(this.tags.entries()).map(([name, description]) => ({
        name,
        description,
      })),
    };

    logger.info('OpenAPI spec generated', {
      endpointCount: this.endpoints.size,
      schemaCount: this.schemas.size,
    });

    return spec;
  }

  /**
   * Generate markdown documentation
   */
  generateMarkdownDocs(): string {
    let markdown = '# API Documentation\n\n';

    // Group endpoints by tag
    const endpointsByTag = new Map<string, APIEndpoint[]>();

    for (const endpoint of this.endpoints.values()) {
      for (const tag of endpoint.tags) {
        if (!endpointsByTag.has(tag)) {
          endpointsByTag.set(tag, []);
        }
        endpointsByTag.get(tag)!.push(endpoint);
      }
    }

    // Generate documentation for each tag
    for (const [tag, endpoints] of endpointsByTag) {
      markdown += `## ${tag}\n\n`;
      markdown += `${this.tags.get(tag) || ''}\n\n`;

      for (const endpoint of endpoints) {
        markdown += this.generateEndpointMarkdown(endpoint);
        markdown += '\n---\n\n';
      }
    }

    return markdown;
  }

  /**
   * Generate code samples
   */
  generateCodeSamples(endpoint: APIEndpoint): Record<string, string> {
    return {
      curl: this.generateCurlSample(endpoint),
      typescript: this.generateTypeScriptSample(endpoint),
      python: this.generatePythonSample(endpoint),
      go: this.generateGoSample(endpoint),
    };
  }

  /**
   * Get endpoint documentation
   */
  getEndpointDoc(method: string, path: string): APIEndpoint | null {
    const key = `${method}:${path}`;
    return this.endpoints.get(key) || null;
  }

  /**
   * Search endpoints
   */
  searchEndpoints(query: string): APIEndpoint[] {
    const lowerQuery = query.toLowerCase();

    return Array.from(this.endpoints.values()).filter(
      endpoint =>
        endpoint.path.toLowerCase().includes(lowerQuery) ||
        endpoint.summary.toLowerCase().includes(lowerQuery) ||
        endpoint.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Generate endpoint markdown
   */
  private generateEndpointMarkdown(endpoint: APIEndpoint): string {
    let md = `### ${endpoint.method} ${endpoint.path}\n\n`;
    md += `${endpoint.description}\n\n`;

    if (endpoint.deprecated) {
      md += '**⚠️ DEPRECATED** - This endpoint is deprecated and will be removed in a future version.\n\n';
    }

    // Parameters
    if (endpoint.parameters.length > 0) {
      md += '**Parameters:**\n\n';
      md += '| Name | Type | Required | Description |\n';
      md += '|------|------|----------|-------------|\n';

      for (const param of endpoint.parameters) {
        md += `| ${param.name} | ${param.schema.type} | ${param.required ? 'Yes' : 'No'} | ${param.description} |\n`;
      }
      md += '\n';
    }

    // Request body
    if (endpoint.requestBody) {
      md += '**Request Body:**\n\n';
      md += '```json\n';
      md += JSON.stringify(this.generateExampleFromSchema(endpoint.requestBody.content['application/json']?.schema), null, 2);
      md += '\n```\n\n';
    }

    // Responses
    md += '**Responses:**\n\n';
    for (const [code, response] of Object.entries(endpoint.responses)) {
      md += `**${code}**: ${response.description}\n\n`;

      if (response.content?.['application/json']?.schema) {
        md += '```json\n';
        md += JSON.stringify(this.generateExampleFromSchema(response.content['application/json'].schema), null, 2);
        md += '\n```\n\n';
      }
    }

    return md;
  }

  /**
   * Generate cURL sample
   */
  private generateCurlSample(endpoint: APIEndpoint): string {
    let curl = `curl -X ${endpoint.method} \\\n`;
    curl += `  'https://api.aiautonews.com/v1${endpoint.path}' \\\n`;
    curl += `  -H 'X-API-Key: YOUR_API_KEY'`;

    if (endpoint.requestBody) {
      curl += ` \\\n  -H 'Content-Type: application/json' \\\n`;
      curl += `  -d '${JSON.stringify(this.generateExampleFromSchema(endpoint.requestBody.content['application/json']?.schema), null, 2)}'`;
    }

    return curl;
  }

  /**
   * Generate TypeScript sample
   */
  private generateTypeScriptSample(endpoint: APIEndpoint): string {
    const pathWithoutParams = endpoint.path.replace(/\{[^}]+\}/g, '${id}');

    let ts = `import { AIAutoNewsSDK } from '@ai-auto-news/sdk';\n\n`;
    ts += `const client = new AIAutoNewsSDK({ apiKey: 'YOUR_API_KEY' });\n\n`;
    ts += `const response = await client.${endpoint.method.toLowerCase()}('${pathWithoutParams}'`;

    if (endpoint.requestBody) {
      ts += `, ${JSON.stringify(this.generateExampleFromSchema(endpoint.requestBody.content['application/json']?.schema), null, 2)}`;
    }

    ts += `);\n`;
    ts += `console.log(response);`;

    return ts;
  }

  /**
   * Generate Python sample
   */
  private generatePythonSample(endpoint: APIEndpoint): string {
    let py = `from ai_auto_news import AIAutoNewsClient\n\n`;
    py += `client = AIAutoNewsClient(api_key='YOUR_API_KEY')\n\n`;
    py += `response = client.${endpoint.method.toLowerCase()}('${endpoint.path}'`;

    if (endpoint.requestBody) {
      py += `, data=${JSON.stringify(this.generateExampleFromSchema(endpoint.requestBody.content['application/json']?.schema))}`;
    }

    py += `)\n`;
    py += `print(response)`;

    return py;
  }

  /**
   * Generate Go sample
   */
  private generateGoSample(endpoint: APIEndpoint): string {
    let go = `package main\n\n`;
    go += `import (\n`;
    go += `    "fmt"\n`;
    go += `    "github.com/ai-auto-news/go-sdk"\n`;
    go += `)\n\n`;
    go += `func main() {\n`;
    go += `    client := aiautonews.NewClient("YOUR_API_KEY")\n`;
    go += `    response, err := client.${this.capitalizeFirst(endpoint.method.toLowerCase())}("${endpoint.path}"`;

    if (endpoint.requestBody) {
      go += `, data`;
    }

    go += `)\n`;
    go += `    if err != nil {\n`;
    go += `        panic(err)\n`;
    go += `    }\n`;
    go += `    fmt.Println(response)\n`;
    go += `}`;

    return go;
  }

  /**
   * Generate example from schema
   */
  private generateExampleFromSchema(schema?: SchemaObject): any {
    if (!schema) return {};

    if (schema.example) return schema.example;

    switch (schema.type) {
      case 'object':
        const obj: any = {};
        if (schema.properties) {
          for (const [key, propSchema] of Object.entries(schema.properties)) {
            obj[key] = this.generateExampleFromSchema(propSchema);
          }
        }
        return obj;

      case 'array':
        return schema.items ? [this.generateExampleFromSchema(schema.items)] : [];

      case 'string':
        return schema.enum ? schema.enum[0] : 'string';

      case 'number':
      case 'integer':
        return 0;

      case 'boolean':
        return true;

      default:
        return null;
    }
  }

  /**
   * Initialize common schemas
   */
  private initializeCommonSchemas(): void {
    this.registerSchema('Post', {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'post_123' },
        title: { type: 'string', example: 'AI News Update' },
        slug: { type: 'string', example: 'ai-news-update' },
        content: { type: 'string', example: 'Latest developments...' },
        summary: { type: 'string', example: 'Brief summary' },
        category: { type: 'string', example: 'technology' },
        tags: { type: 'array', items: { type: 'string' }, example: ['ai', 'news'] },
        createdAt: { type: 'string', format: 'date-time' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
      required: ['id', 'title', 'content'],
    });

    this.registerSchema('Error', {
      type: 'object',
      properties: {
        error: { type: 'string', example: 'Error message' },
        code: { type: 'string', example: 'ERROR_CODE' },
        details: { type: 'object' },
      },
      required: ['error'],
    });

    this.registerSchema('PaginationMeta', {
      type: 'object',
      properties: {
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 10 },
        total: { type: 'integer', example: 100 },
        totalPages: { type: 'integer', example: 10 },
      },
    });
  }

  /**
   * Initialize tags
   */
  private initializeTags(): void {
    this.tags.set('Posts', 'Content management endpoints');
    this.tags.set('Users', 'User management endpoints');
    this.tags.set('Authentication', 'Authentication and authorization');
    this.tags.set('Analytics', 'Analytics and reporting');
    this.tags.set('Billing', 'Subscription and billing management');
    this.tags.set('Admin', 'Administrative endpoints');
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

// Singleton
let apiDocGenerator: APIDocumentationGenerator;

export function getAPIDocumentationGenerator(): APIDocumentationGenerator {
  if (!apiDocGenerator) {
    apiDocGenerator = new APIDocumentationGenerator();
  }
  return apiDocGenerator;
}

export { APIDocumentationGenerator };
