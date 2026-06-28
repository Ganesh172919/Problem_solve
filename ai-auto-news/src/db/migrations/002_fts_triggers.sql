-- Migration 002: FTS5 full-text search with content indexing and sync triggers
-- Adds full-text search on posts with title, summary, tags, and content.
-- Triggers keep the FTS index in sync on INSERT, UPDATE, and DELETE.

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  id UNINDEXED,
  title,
  summary,
  tags,
  content=posts,
  content_rowid=rowid
);

-- Trigger: after INSERT on posts, add to FTS index
CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, id, title, summary, tags)
  VALUES (new.rowid, new.id, new.title, new.summary, new.tags);
END;

-- Trigger: after DELETE on posts, remove from FTS index
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, id, title, summary, tags)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary, old.tags);
END;

-- Trigger: after UPDATE on posts, update FTS index
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, id, title, summary, tags)
  VALUES ('delete', old.rowid, old.id, old.title, old.summary, old.tags);
  INSERT INTO posts_fts(rowid, id, title, summary, tags)
  VALUES (new.rowid, new.id, new.title, new.summary, new.tags);
END;
