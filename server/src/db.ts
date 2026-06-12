import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'saferoots.db');

let _db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shelters (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      address          TEXT NOT NULL,
      city             TEXT NOT NULL,
      state            TEXT NOT NULL,
      lat              REAL NOT NULL,
      lng              REAL NOT NULL,
      phone            TEXT NOT NULL,
      website          TEXT,
      tags             TEXT NOT NULL DEFAULT '[]',
      capacity         INTEGER NOT NULL DEFAULT 0,
      current_occupancy INTEGER NOT NULL DEFAULT 0,
      rating           REAL NOT NULL DEFAULT 0,
      review_count     INTEGER NOT NULL DEFAULT 0,
      services         TEXT NOT NULL DEFAULT '[]',
      hours            TEXT NOT NULL,
      description      TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS resources (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      description TEXT NOT NULL,
      address     TEXT NOT NULL,
      city        TEXT NOT NULL,
      state       TEXT NOT NULL,
      phone       TEXT NOT NULL,
      website     TEXT,
      hours       TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      is_free     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crisis_alerts (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      city        TEXT,
      expires_at  TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'medium',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS volunteers (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      city         TEXT NOT NULL,
      phone        TEXT,
      organization TEXT,
      skills       TEXT NOT NULL DEFAULT '[]',
      availability TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         TEXT PRIMARY KEY,
      room       TEXT NOT NULL,
      username   TEXT NOT NULL,
      message    TEXT NOT NULL,
      timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_shelters_city  ON shelters(city);
    CREATE INDEX IF NOT EXISTS idx_resources_cat  ON resources(category);
    CREATE INDEX IF NOT EXISTS idx_chat_room      ON chat_messages(room, timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_expires ON crisis_alerts(expires_at);

    CREATE TABLE IF NOT EXISTS shelter_feedback (
      id                  TEXT PRIMARY KEY,
      shelter_id          TEXT NOT NULL,
      felt_safe           INTEGER NOT NULL,
      women_safety_score  REAL NOT NULL,
      lgbtq_safety_score  REAL NOT NULL,
      anti_racism_score   REAL NOT NULL,
      comment             TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shelter_id) REFERENCES shelters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource_live_status (
      id               TEXT PRIMARY KEY,
      resource_id      TEXT NOT NULL,
      status           TEXT NOT NULL,
      essentials       TEXT NOT NULL DEFAULT '{}',
      closes_at        TEXT,
      updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
      verified_by      TEXT NOT NULL DEFAULT 'system',
      note             TEXT,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outreach_popups (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      type             TEXT NOT NULL,
      city             TEXT NOT NULL,
      address          TEXT NOT NULL,
      lat              REAL NOT NULL,
      lng              REAL NOT NULL,
      starts_at        TEXT NOT NULL,
      ends_at          TEXT NOT NULL,
      services         TEXT NOT NULL DEFAULT '[]',
      verified_by      TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS follow_through (
      id               TEXT PRIMARY KEY,
      shelter_id       TEXT,
      resource_id      TEXT,
      helped           INTEGER NOT NULL,
      channel          TEXT NOT NULL,
      notes            TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_metrics (
      id               TEXT PRIMARY KEY,
      event_type       TEXT NOT NULL,
      metadata         TEXT NOT NULL DEFAULT '{}',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS legal_help_flows (
      id               TEXT PRIMARY KEY,
      issue            TEXT NOT NULL,
      city             TEXT NOT NULL,
      title            TEXT NOT NULL,
      steps            TEXT NOT NULL,
      resources        TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outreach_users (
      id               TEXT PRIMARY KEY,
      email            TEXT NOT NULL UNIQUE,
      password_hash    TEXT NOT NULL,
      role             TEXT NOT NULL DEFAULT 'outreach',
      name             TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Shelter claim & verification system
    CREATE TABLE IF NOT EXISTS shelter_claims (
      id               TEXT PRIMARY KEY,
      shelter_id       TEXT NOT NULL UNIQUE,
      operator_email   TEXT NOT NULL,
      operator_name    TEXT NOT NULL,
      phone_number     TEXT,
      verification_token TEXT UNIQUE,
      verification_status TEXT NOT NULL DEFAULT 'pending',
      verified_at      TEXT,
      claimed_at       TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shelter_id) REFERENCES shelters(id) ON DELETE CASCADE
    );

    -- Capacity triage system (🟢 open / 🟡 waitlist / 🔴 full)
    CREATE TABLE IF NOT EXISTS shelter_capacity (
      id               TEXT PRIMARY KEY,
      shelter_id       TEXT NOT NULL UNIQUE,
      status           TEXT NOT NULL DEFAULT 'open',
      status_options   TEXT NOT NULL DEFAULT '["open", "waitlist", "full"]',
      last_updated_by  TEXT NOT NULL DEFAULT 'system',
      last_updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      secret_update_token TEXT UNIQUE,
      FOREIGN KEY (shelter_id) REFERENCES shelters(id) ON DELETE CASCADE
    );

    -- User feedback loop for data quality
    CREATE TABLE IF NOT EXISTS shelter_data_feedback (
      id               TEXT PRIMARY KEY,
      shelter_id       TEXT NOT NULL,
      is_accurate      INTEGER NOT NULL,
      feedback_type    TEXT,
      message          TEXT,
      submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shelter_id) REFERENCES shelters(id) ON DELETE CASCADE
    );

    -- Flag inaccurate listings for review
    CREATE TABLE IF NOT EXISTS shelter_accuracy_flags (
      id               TEXT PRIMARY KEY,
      shelter_id       TEXT NOT NULL UNIQUE,
      inaccuracy_count INTEGER NOT NULL DEFAULT 0,
      flagged_at       TEXT NOT NULL DEFAULT (datetime('now')),
      flagged_reason   TEXT,
      review_status    TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (shelter_id) REFERENCES shelters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_resource_live_resource ON resource_live_status(resource_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_shelter       ON shelter_feedback(shelter_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_popups_city_time       ON outreach_popups(city, starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_followthrough_time     ON follow_through(created_at);
    CREATE INDEX IF NOT EXISTS idx_event_metrics_type     ON event_metrics(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_outreach_users_email   ON outreach_users(email);

    -- Additional performance indexes for frequent queries
    CREATE INDEX IF NOT EXISTS idx_shelters_rating       ON shelters(rating DESC);
    CREATE INDEX IF NOT EXISTS idx_shelters_city_state   ON shelters(city, state);
    CREATE INDEX IF NOT EXISTS idx_resources_city        ON resources(city);
    CREATE INDEX IF NOT EXISTS idx_resources_city_state  ON resources(city, state);
    CREATE INDEX IF NOT EXISTS idx_resources_status      ON resources(live_status);
    CREATE INDEX IF NOT EXISTS idx_volunteers_city       ON volunteers(city);
    CREATE INDEX IF NOT EXISTS idx_volunteers_email      ON volunteers(email);
    CREATE INDEX IF NOT EXISTS idx_alerts_city           ON crisis_alerts(city);
    CREATE INDEX IF NOT EXISTS idx_alerts_type           ON crisis_alerts(type);
    CREATE INDEX IF NOT EXISTS idx_alerts_city_expires   ON crisis_alerts(city, expires_at);
    CREATE INDEX IF NOT EXISTS idx_chat_username         ON chat_messages(username);
    CREATE INDEX IF NOT EXISTS idx_followthrough_shelter ON follow_through(shelter_id);
    CREATE INDEX IF NOT EXISTS idx_followthrough_resource ON follow_through(resource_id);
    CREATE INDEX IF NOT EXISTS idx_legal_flows_issue     ON legal_help_flows(issue);
    CREATE INDEX IF NOT EXISTS idx_legal_flows_city      ON legal_help_flows(city);
    CREATE INDEX IF NOT EXISTS idx_popups_city           ON outreach_popups(city);
  `);

  const addColumnIfMissing = (table: string, columnDef: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    } catch {
      // Column already exists in existing deployments.
    }
  };

  addColumnIfMissing('shelters', 'last_bed_update_at TEXT');
  addColumnIfMissing('shelters', 'women_safety_score REAL');
  addColumnIfMissing('shelters', 'lgbtq_safety_score REAL');
  addColumnIfMissing('shelters', 'anti_racism_score REAL');

  addColumnIfMissing('resources', "live_status TEXT DEFAULT 'open'");
  addColumnIfMissing('resources', 'status_updated_at TEXT');
  addColumnIfMissing('resources', 'closes_at TEXT');
  addColumnIfMissing('resources', "essentials TEXT DEFAULT '{}'");

  db.exec("UPDATE shelters SET last_bed_update_at = COALESCE(last_bed_update_at, datetime('now'))");
  db.exec('UPDATE shelters SET women_safety_score = COALESCE(women_safety_score, 4.3)');
  db.exec('UPDATE shelters SET lgbtq_safety_score = COALESCE(lgbtq_safety_score, 4.2)');
  db.exec('UPDATE shelters SET anti_racism_score = COALESCE(anti_racism_score, 4.1)');
  db.exec("UPDATE resources SET live_status = COALESCE(live_status, 'open')");
  db.exec("UPDATE resources SET status_updated_at = COALESCE(status_updated_at, datetime('now'))");
  db.exec("UPDATE resources SET essentials = COALESCE(essentials, '{}')");
}
