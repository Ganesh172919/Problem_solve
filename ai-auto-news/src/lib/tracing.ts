/**
 * Distributed Tracing with OpenTelemetry
 *
 * Provides end-to-end request tracing across services
 * Supports: Jaeger, Zipkin, Grafana Tempo
 */

import { trace, context as otelContext, SpanStatusCode, Span, SpanKind, type Context as OtelContext } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanOptions {
  attributes?: Record<string, any>;
  kind?: 'server' | 'client' | 'producer' | 'consumer' | 'internal';
  parent?: TraceContext;
}

class DistributedTracer {
  private provider: NodeTracerProvider;
  private serviceName: string;
  private initialized = false;

  constructor(serviceName: string = 'ai-auto-news') {
    this.serviceName = serviceName;
    this.provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '2.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }),
    });
  }

  /**
   * Initialize tracing
   */
  initialize() {
    if (this.initialized) return;

    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

    // Configure exporters
    const exporters = [];

    if (process.env.NODE_ENV === 'production') {
      // OTLP exporter for Jaeger/Tempo
      exporters.push(
        new OTLPTraceExporter({
          url: `${otlpEndpoint}/v1/traces`,
          headers: {},
        })
      );
    } else {
      // Console exporter for development
      exporters.push(new ConsoleSpanExporter());
    }

    // Re-create provider with span processors
    const spanProcessors = exporters.map(exporter =>
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000,
      })
    );

    this.provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: this.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '2.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }),
      spanProcessors,
    });

    // Register the provider
    this.provider.register();

    // Auto-instrument common libraries
    registerInstrumentations({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            ignoreIncomingRequestHook: (req) => {
              const url = (req as { url?: string }).url ?? '';
              return url === '/health' || url === '/metrics';
            },
          },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-redis': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true },
          '@opentelemetry/instrumentation-fs': { enabled: false }, // Too noisy
        }),
      ],
    });

    this.initialized = true;
  }

  /**
   * Start a new span
   */
  startSpan(name: string, options?: SpanOptions): Span {
    const tracer = trace.getTracer(this.serviceName);

    return tracer.startSpan(name, {
      attributes: options?.attributes,
      kind: this.mapSpanKind(options?.kind),
    });
  }

  /**
   * Execute function with automatic span
   */
  async traced<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    const span = this.startSpan(name, options);

    try {
      // Run function in span context
      const result = await otelContext.with(
        trace.setSpan(otelContext.active(), span),
        () => fn(span)
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Add event to current span
   */
  addEvent(name: string, attributes?: Record<string, any>) {
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  /**
   * Set attribute on current span
   */
  setAttribute(key: string, value: any) {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute(key, value);
    }
  }

  /**
   * Get current trace context
   */
  getCurrentContext(): TraceContext | null {
    const span = trace.getActiveSpan();
    if (!span) return null;

    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }

  /**
   * Extract context from headers (for distributed tracing)
   */
  extractContext(headers: Record<string, string>): OtelContext | undefined {
    // OpenTelemetry auto-instrumentation handles this
    return otelContext.active();
  }

  /**
   * Inject context into headers (for distributed tracing)
   */
  injectContext(headers: Record<string, string>): Record<string, string> {
    const span = trace.getActiveSpan();
    if (!span) return headers;

    const spanContext = span.spanContext();

    // W3C Trace Context format
    headers['traceparent'] = `00-${spanContext.traceId}-${spanContext.spanId}-01`;

    return headers;
  }

  /**
   * Shutdown tracing (for graceful shutdown)
   */
  async shutdown() {
    await this.provider.shutdown();
  }

  private mapSpanKind(kind?: string) {
    
    switch (kind) {
      case 'server': return SpanKind.SERVER;
      case 'client': return SpanKind.CLIENT;
      case 'producer': return SpanKind.PRODUCER;
      case 'consumer': return SpanKind.CONSUMER;
      case 'internal': return SpanKind.INTERNAL;
      default: return SpanKind.INTERNAL;
    }
  }
}

// Singleton instance
let tracer: DistributedTracer;

export function getTracer(): DistributedTracer {
  if (!tracer) {
    tracer = new DistributedTracer();
    if (process.env.TRACING_ENABLED !== 'false') {
      tracer.initialize();
    }
  }
  return tracer;
}

// Decorator for tracing methods
export function Traced(spanName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = spanName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      const tracer = getTracer();
      return tracer.traced(
        name,
        () => originalMethod.apply(this, args),
        {
          attributes: {
            'code.function': propertyKey,
            'code.namespace': target.constructor.name,
          },
        }
      );
    };

    return descriptor;
  };
}

// Express middleware for automatic request tracing
export function tracingMiddleware() {
  return (req: any, res: any, next: any) => {
    const tracer = getTracer();
    const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
      kind: 'server',
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.target': req.path,
        'http.host': req.hostname,
        'http.scheme': req.protocol,
        'http.user_agent': req.get('user-agent'),
        'http.client_ip': req.ip,
      },
    });

    // Track response
    const originalSend = res.send;
    res.send = function (data: any) {
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.response_content_length', data?.length || 0);

      if (res.statusCode >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${res.statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
      return originalSend.call(this, data);
    };

    // Run in span context
    otelContext.with(trace.setSpan(otelContext.active(), span), () => {
      next();
    });
  };
}

// Helper to trace database queries
export async function traceQuery<T>(
  queryName: string,
  query: string,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.traced(
    `db.query.${queryName}`,
    async (span) => {
      span.setAttribute('db.system', 'postgresql');
      span.setAttribute('db.statement', query.substring(0, 1000)); // Limit size
      return fn();
    },
    { kind: 'client' }
  );
}

// Helper to trace external API calls
export async function traceExternalCall<T>(
  serviceName: string,
  method: string,
  url: string,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.traced(
    `external.${serviceName}`,
    async (span) => {
      span.setAttribute('http.method', method);
      span.setAttribute('http.url', url);
      span.setAttribute('peer.service', serviceName);
      return fn();
    },
    { kind: 'client' }
  );
}
