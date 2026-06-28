// ─────────────────────────────────────────────────────────────────────────────
// Structured logger for the autonomous agent pipeline.
// Writes to: (1) console with colors, (2) SQLite agent_logs table.
//
// WHY a dedicated agent logger (separate from the existing logger):
//  - Agent logs need run_id correlation for the admin dashboard
//  - Agent logs are persisted to SQLite for querying and pagination
//  - The existing logger is a general-purpose JSON logger for the app
// ─────────────────────────────────────────────────────────────────────────────

import getDb from '@/db/index';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[37m',  // White
  INFO:  '\x1b[32m',  // Green
  WARN:  '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m',  // Red
};
const RESET = '\x1b[0m';

/**
 * AgentLogger — structured logger for agent pipeline.
 * Each logger instance is scoped to a run_id and agent_name.
 *
 * @example
 * const log = new AgentLogger('run-123', 'ResearchAgent');
 * log.info('Found 8 trending topics', { count: 8 });
 */
export class AgentLogger {
  constructor(
    private runId: string,
    private agentName: string,
  ) {}

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('DEBUG', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('INFO', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('WARN', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('ERROR', message, metadata);
  }

  /**
   * log — internal method that writes to console and SQLite.
   * Wrapped in try/catch — logging failure must NEVER crash the agent.
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const color = LEVEL_COLORS[level];

    // ── Console output ──────────────────────────────────────────────────────
    const metaStr = metadata
      ? ' | ' + Object.entries(metadata)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ')
      : '';
    console.log(`${color}[${timestamp}] [${level.padEnd(5)}] [${this.agentName}] ${message}${metaStr}${RESET}`);

    // ── SQLite log entry ─────────────────────────────────────────────────────
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO agent_logs (run_id, agent_name, level, message, metadata, gemini_model)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.runId,
        this.agentName,
        level,
        message,
        metadata ? JSON.stringify(metadata) : null,
        metadata?.model ?? null,
      );
    } catch {
      // Silent — DB write failures don't cascade to agents
    }
  }
}
