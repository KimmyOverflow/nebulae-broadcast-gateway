import type { DatabaseSync, StatementSync } from "node:sqlite";

export type AppDatabaseSqlStatements = {
    insertUser: StatementSync
    selectUserById: StatementSync,
    selectUserByUsername: StatementSync
    // selectUserId: StatementSync
    // selectTotpSecret: StatementSync
    // selectUserVerified: StatementSync
    // selectUserRole: StatementSync
    selectUserProfilePicture: StatementSync
    updateUserVerified: StatementSync
    insertProfilePicture: StatementSync
    updateUsername: StatementSync
    updateTotpSecretEncrypted: StatementSync
    updateUserRecoveryPending: StatementSync
    deleteAbandonedRegistrations: StatementSync
    selectPendingRegistrations: StatementSync
    selectPendingRecoveries: StatementSync
    insertRefreshToken: StatementSync
    selectRefreshToken: StatementSync
    selectRefreshTokenById: StatementSync
    selectRefreshTokensFromUser: StatementSync
    updateRefreshToken: StatementSync
    updateRefreshTokenAlias: StatementSync
    updateRefreshTokenSuspended: StatementSync
    deleteRefreshToken: StatementSync
    deleteRefreshTokens: StatementSync
    insertStreamToken: StatementSync
    selectStreamTokensFromUser: StatementSync
    selectStreamToken: StatementSync
    updateStreamToken: StatementSync
    updateStreamTokenAlias: StatementSync
    deleteStreamToken: StatementSync
    deleteStreamTokens: StatementSync
}

export function prepareStatements(db: DatabaseSync): AppDatabaseSqlStatements {
    return {
        // #region User & Auth
        insertUser: db.prepare(`
            INSERT INTO users (username, totp_secret_encrypted, passcode_hash)
            VALUES (?, ?, ?)
            RETURNING id;
        `),
        selectUserById: db.prepare(`
            SELECT *
            FROM users
            WHERE id = ?;
        `),
        selectUserByUsername: db.prepare(`
            SELECT *
            FROM users
            WHERE username = ?;
        `),
        // selectUserId: db.prepare(`
        //     SELECT id
        //     FROM users
        //     WHERE username = ?;
        // `),
        // selectTotpSecret: db.prepare(`
        //     SELECT totp_secret_encrypted
        //     FROM users
        //     WHERE id = ?;
        // `),
        // selectUserVerified: db.prepare(`
        //     SELECT verified
        //     FROM users
        //     WHERE id = ?;
        // `),
        // selectUserRole: db.prepare(`
        //     SELECT role
        //     FROM users
        //     WHERE id = ?;
        // `),
        selectUserProfilePicture: db.prepare(`
            SELECT data
            FROM profile_pics
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 1;
        `),
        updateUserVerified: db.prepare(`
            UPDATE users
            SET verified = 1
            WHERE id = ?;
        `),
        insertProfilePicture: db.prepare(`
            INSERT INTO profile_pics (user_id, data)
            VALUES (?, ?);
        `),
        updateUsername: db.prepare(`
            UPDATE users
            SET username = ?
            WHERE id = ?;
        `),
        updateTotpSecretEncrypted: db.prepare(`
            UPDATE users
            SET totp_secret_encrypted = ?
            WHERE id = ?;
        `),
        updateUserRecoveryPending: db.prepare(`
            UPDATE users
            SET recovery_pending = ?
            WHERE id = ?;
        `),
        deleteAbandonedRegistrations: db.prepare(`
            DELETE FROM users
            WHERE verified = 0
              AND totp_secret_encrypted IS NULL
              AND created_at < ?;
        `),
        selectPendingRegistrations: db.prepare(`
            SELECT id, username, created_at
            FROM users
            WHERE verified = 0
              AND totp_secret_encrypted IS NOT NULL
            ORDER BY created_at;
        `),
        selectPendingRecoveries: db.prepare(`
            SELECT id, username, created_at, totp_secret_encrypted IS NOT NULL AS totp_installed
            FROM users
            WHERE verified = 1
              AND recovery_pending = 1
            ORDER BY created_at;
        `),
        // #endregion
        // #region Refresh token
        insertRefreshToken: db.prepare(`
            INSERT INTO refresh_tokens (user_id, token_hash, last_user_agent, last_ip)
            VALUES (?, ?, ?, ?)
            RETURNING id;
        `),
        selectRefreshToken: db.prepare(`
            SELECT id, user_id, last_updated_at, suspended
            FROM refresh_tokens
            WHERE token_hash = ?;
        `),
        selectRefreshTokenById: db.prepare(`
            SELECT id, user_id, last_updated_at, suspended
            FROM refresh_tokens
            WHERE id = ?;
        `),
        selectRefreshTokensFromUser: db.prepare(`
            SELECT id, alias, created_at, last_updated_at, last_user_agent, last_ip
            FROM refresh_tokens
            WHERE user_id = ? AND suspended = 0;
        `),
        updateRefreshTokenSuspended: db.prepare(`
            UPDATE refresh_tokens
            SET suspended = ?
            WHERE id = ?;
        `),
        deleteRefreshToken: db.prepare(`
            DELETE FROM refresh_tokens
            WHERE id = ?;
        `),
        updateRefreshToken: db.prepare(`
            UPDATE refresh_tokens
            SET token_hash = ?,
                last_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                last_user_agent = ?,
                last_ip = ?
            WHERE id = ?;
        `),
        updateRefreshTokenAlias: db.prepare(`
            UPDATE refresh_tokens
            SET alias = ?
            WHERE id = ?;
        `),
        deleteRefreshTokens: db.prepare(`
            DELETE FROM refresh_tokens
            WHERE user_id = ?;
        `),
        // #endregion
        // #region Stream token
        insertStreamToken: db.prepare(`
            INSERT INTO stream_tokens (user_id, token_hash, token_hint, alias)
            VALUES (?, ?, ?, ?);
        `),
        selectStreamTokensFromUser: db.prepare(`
            SELECT id, token_hint, alias, created_at, last_used_at, last_ip
            FROM stream_tokens
            WHERE user_id = ?;
        `),
        selectStreamToken: db.prepare(`
            SELECT id, user_id
            FROM stream_tokens
            WHERE token_hash = ?;
        `),
        updateStreamToken: db.prepare(`
            UPDATE stream_tokens
            SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                last_ip = ?
            WHERE id = ?;
        `),
        updateStreamTokenAlias: db.prepare(`
            UPDATE stream_tokens
            SET alias = ?
            WHERE id = ?;
        `),
        deleteStreamToken: db.prepare(`
            DELETE FROM stream_tokens
            WHERE id = ?;
        `),
        deleteStreamTokens: db.prepare(`
            DELETE FROM stream_tokens
            WHERE user_id = ?;
        `)
        // #endregion
    }
}
