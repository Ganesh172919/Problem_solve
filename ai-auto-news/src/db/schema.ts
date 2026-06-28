// ─────────────────────────────────────────────────────────────────────────────
// Extended database schema for the Autonomous AI News Platform.
// Adds tables for user preferences, agent logs, trending topics,
// content templates, and scheduler state on top of the existing posts table.
// ─────────────────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';

/**
 * applyExtendedSchema — creates new tables required by the autonomous pipeline.
 * Safe to call multiple times (CREATE IF NOT EXISTS).
 *
 * @param db - The better-sqlite3 database instance
 */
export function applyExtendedSchema(db: Database.Database): void {
  db.exec(`
    -- ── USER PREFERENCES ──────────────────────────────────────────────────────
    -- Stores onboarding quiz answers per anonymous session.
    CREATE TABLE IF NOT EXISTS user_preferences (
      id               TEXT PRIMARY KEY,
      session_token    TEXT UNIQUE NOT NULL,
      topics           TEXT NOT NULL DEFAULT '[]',
      tone             TEXT NOT NULL DEFAULT 'balanced',
      frequency        TEXT NOT NULL DEFAULT 'daily',
      onboarding_done  INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── AGENT LOGS ────────────────────────────────────────────────────────────
    -- Structured logs from every agent run for the admin dashboard.
    CREATE TABLE IF NOT EXISTS agent_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         TEXT NOT NULL,
      agent_name     TEXT NOT NULL,
      level          TEXT NOT NULL,
      message        TEXT NOT NULL,
      metadata       TEXT,
      gemini_model   TEXT,
      tokens_used    INTEGER,
      duration_ms    INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_logs_run_id ON agent_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);

    -- ── TRENDING TOPICS ───────────────────────────────────────────────────────
    -- Populated by ResearchAgent each scheduler cycle. Expires after 24 hours.
    CREATE TABLE IF NOT EXISTS trending_topics (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      topic            TEXT NOT NULL,
      context          TEXT,
      relevance_score  REAL NOT NULL DEFAULT 1.0,
      used_count       INTEGER NOT NULL DEFAULT 0,
      last_used_at     TEXT,
      expires_at       TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── CONTENT TEMPLATES ─────────────────────────────────────────────────────
    -- Registered content templates. is_active lets admin disable without deleting.
    CREATE TABLE IF NOT EXISTS content_templates (
      id                    TEXT PRIMARY KEY,
      name                  TEXT NOT NULL,
      template_type         TEXT NOT NULL,
      category              TEXT NOT NULL,
      scheduling_weight     INTEGER NOT NULL DEFAULT 5,
      usage_count           INTEGER NOT NULL DEFAULT 0,
      last_used_at          TEXT,
      is_active             INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── SCHEDULER STATE ───────────────────────────────────────────────────────
    -- Single-row table tracking the scheduler lifecycle.
    CREATE TABLE IF NOT EXISTS scheduler_state (
      id                          INTEGER PRIMARY KEY DEFAULT 1,
      is_running                  INTEGER NOT NULL DEFAULT 0,
      last_run_at                 TEXT,
      next_run_at                 TEXT,
      interval_ms                 INTEGER NOT NULL DEFAULT 3600000,
      total_articles_generated    INTEGER NOT NULL DEFAULT 0,
      total_runs                  INTEGER NOT NULL DEFAULT 0,
      last_error                  TEXT,
      current_run_id              TEXT
    );

    INSERT OR IGNORE INTO scheduler_state (id) VALUES (1);

    -- ── INDEXES on posts table ────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category, createdAt DESC);
  `);
}
