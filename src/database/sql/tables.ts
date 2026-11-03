import type { DatabaseSync } from "node:sqlite"

export function prepareTables(db: DatabaseSync) {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id                      INTEGER     PRIMARY KEY AUTOINCREMENT,
            username                TEXT        NOT NULL UNIQUE,
            totp_secret_encrypted   TEXT,
            passcode_hash           TEXT        NOT NULL,
            verified                INTEGER     NOT NULL DEFAULT 0      CHECK (verified IN (0, 1)),
            recovery_pending        INTEGER     NOT NULL DEFAULT 0      CHECK (recovery_pending IN (0, 1)),
            role                    TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
            created_at              TEXT        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
    `).run()

    db.prepare(`
        CREATE TABLE IF NOT EXISTS profile_pics (
            id          INTEGER     PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER     NOT NULL,
            data        TEXT        NOT NULL,
            format      TEXT        NOT NULL DEFAULT 'webp'     CHECK (format IN ('webp', 'webm')),
            created_at  TEXT        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    `).run()

    db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_user_newest_profile_pic ON profile_pics(user_id, created_at DESC);
    `).run()

    db.prepare(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            token_hash      TEXT    NOT NULL,
            alias           TEXT,
            created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            last_updated_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            last_user_agent TEXT,
            last_ip         TEXT,
            suspended       INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, token_hash)
        );
    `).run()

    db.prepare(`
        CREATE TABLE IF NOT EXISTS stream_tokens (
            id              INTEGER     PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER     NOT NULL,
            token_hash      TEXT        NOT NULL,
            token_hint      TEXT        NOT NULL,
            alias           TEXT        NOT NULL,
            created_at      TEXT        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            last_used_at    TEXT,
            last_ip         TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, token_hash)
        );
    `).run()
}
