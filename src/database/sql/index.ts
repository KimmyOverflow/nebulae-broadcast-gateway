import { DatabaseSync, StatementSync, type SQLInputValue } from "node:sqlite";
import { prepareStatements, type AppDatabaseSqlStatements } from "./statements";
import { prepareTables } from "./tables";
import { SQLITE_DATABASE_PATH } from "../../consts";

export class DatabaseError extends Error {
    public readonly stmt: StatementSync
    public readonly params: SQLInputValue[]
    public readonly originalError: Error

    constructor(message: string, context: {
        stmt: StatementSync,
        params?: SQLInputValue[],
        originalError: Error
    }) {
        super(message)
        this.name = 'DatabaseError'
        this.stmt = context.stmt
        this.params = context.params ?? []
        this.originalError = context.originalError
    }
}

export type SqlDatabaseUser = {
    id: number,
    username: string,
    totp_secret_encrypted: string | null,
    passcode_hash: string,
    verified: number,
    recovery_pending: number,
    role: string,
    created_at: string
}

export class AppDatabaseSql {
    private db: DatabaseSync
    private stmts: AppDatabaseSqlStatements

    constructor() {
        this.db = new DatabaseSync(SQLITE_DATABASE_PATH)
        prepareTables(this.db)
        this.stmts = prepareStatements(this.db)
    }

    private wrapError(err: unknown, stmt: StatementSync, params: SQLInputValue[]) {
        if (err instanceof Error) {
            return new DatabaseError(err.message, {
                stmt,
                params,
                originalError: err
            })
        } else {
            return new DatabaseError('Unknown error', {
                stmt,
                params,
                originalError: new Error(String(err))
            })
        }
    }

    private execRun(stmt: StatementSync, params: SQLInputValue[]) {
        try {
            return stmt.run(...params)
        } catch (err) {
            throw this.wrapError(err, stmt, params)
        }
    }

    private execGet(stmt: StatementSync, params: SQLInputValue[]) {
        try {
            return stmt.get(...params)
        } catch (err) {
            throw this.wrapError(err, stmt, params)
        }
    }

    private execAll(stmt: StatementSync, params: SQLInputValue[]) {
        try {
            return stmt.all(...params)
        } catch (err) {
            throw this.wrapError(err, stmt, params)
        }
    }

    // private logError(content: string, additionalContent?: string): void {
    //     this.logger.log({
    //         level: LogLevel.Error,
    //         prefix: "数据库",
    //         content,
    //         additionalContent: additionalContent ?? null,
    //     })
    // }

    // #region User & Auth

    public insertUser(username: string, totpSecretEncrypted: string | null, passcodeHash: string) {
        const row = this.execGet(this.stmts.insertUser, [username, totpSecretEncrypted, passcodeHash])
        if (row === undefined) return null
        return row['id'] as number
    }

    public selectUserById(userId: number) {
        const row = this.execGet(this.stmts.selectUserById, [userId])
        if (row === undefined) return null
        return row as SqlDatabaseUser
    }

    public selectUserByUsername(username: string) {
        const row = this.execGet(this.stmts.selectUserByUsername, [username])
        if (row === undefined) return null
        return row as SqlDatabaseUser
    }

    // public getUserId(username: string) {
    //     const row = this.execGet(this.stmts.selectUserId, [username])
    //     if (row === undefined) return null
    //     return row['id'] as number
    // }

    // public getTotpSecretEncrypted(userId: number) {
    //     const row = this.execGet(this.stmts.selectTotpSecret, [userId])
    //     if (row === undefined) return null
    //     return row['totp_secret_encrypted'] as string
    // }

    // /** Check whether a user's account is verified. Returns null if the user does not exist. */

    // public checkUserVerified(userId: number) {
    //     const row = this.execGet(this.stmts.selectUserVerified, [userId])
    //     if (row === undefined) return null
    //     return row['verified'] === 1
    // }

    // /** Get the role of a user. Returns null if the user does not exist. */

    // public checkUserRole(userId: number) {
    //     const row = this.execGet(this.stmts.selectUserRole, [userId])
    //     if (row === undefined) return null
    //     return row['role'] as 'user' | 'admin'
    // }

    /** Get the latest profile picture of a user. */

    public getProfilePicture(userId: number) {
        const row = this.execGet(this.stmts.selectUserProfilePicture, [userId])
        if (row === undefined) return null
        return row['data'] as string
    }

    public setUserVerified(userId: number) {
        return this.execRun(this.stmts.updateUserVerified, [userId])
    }

    public updateProfilePicture(userId: number, data: string) {
        return this.execRun(this.stmts.insertProfilePicture, [userId, data])
    }

    public updateUsername(userId: number, username: string) {
        return this.execRun(this.stmts.updateUsername, [username, userId])
    }

    public updateTotpSecretEncrypted(userId: number, secretEncrypted: string | null) {
        return this.execRun(this.stmts.updateTotpSecretEncrypted, [secretEncrypted, userId])
    }

    public setUserRecoveryPending(userId: number, pending: boolean) {
        return this.execRun(this.stmts.updateUserRecoveryPending, [pending ? 1 : 0, userId])
    }

    /** 删除未完成 TOTP 设置的待注册账号. 已完成设置的账号（等待管理员批准）不受影响. */

    public removeAbandonedRegistrations(cutoff: string) {
        return this.execRun(this.stmts.deleteAbandonedRegistrations, [cutoff])
    }

    /** 列出已完成 TOTP 设置、等待管理员批准的注册. */

    public getPendingRegistrations() {
        return this.execAll(this.stmts.selectPendingRegistrations, []) as {
            id: number,
            username: string,
            created_at: string
        }[]
    }

    /**
     * 列出发起过找回的账号.
     * totp_installed 为 true 表示管理员尚未批准；为 false 表示已批准、等待用户提交新密钥.
     */

    public getPendingRecoveries() {
        return this.execAll(this.stmts.selectPendingRecoveries, []) as {
            id: number,
            username: string,
            created_at: string,
            totp_installed: 0 | 1
        }[]
    }

    // #endregion

    // #region Refresh token

    public insertRefreshToken(userId: number, tokenHash: string, userAgent: string | null, ip: string | null) {
        const row = this.execGet(this.stmts.insertRefreshToken, [userId, tokenHash, userAgent, ip])
        if (row === undefined) return null
        return row['id'] as number
    }

    public checkRefreshToken(tokenHash: string) {
        const row = this.execGet(this.stmts.selectRefreshToken, [tokenHash])
        if (row === undefined) return null
        return row as {
            "id": number,
            "user_id": number,
            "last_updated_at": string,
            "suspended": 0 | 1
        }
    }

    public getRefreshTokenById(tokenId: number) {
        const row = this.execGet(this.stmts.selectRefreshTokenById, [tokenId])
        if (row === undefined) return null
        return row as {
            "id": number,
            "user_id": number,
            "last_updated_at": string,
            "suspended": 0 | 1
        }
    }

    public getRefreshTokens(userId: number) {
        const row = this.execAll(this.stmts.selectRefreshTokensFromUser, [userId]) as {
            "id": number,
            "alias": string | null,
            "created_at": string,
            "last_updated_at": string,
            "last_user_agent": string | null,
            "last_ip": string | null
        }[]
        return row
    }

    public updateRefreshToken(tokenId: number, newTokenHash: string, userAgent: string | null, ip: string | null) {
        return this.execRun(this.stmts.updateRefreshToken, [newTokenHash, userAgent, ip, tokenId])
    }

    public setRefreshTokenAlias(tokenId: number, alias: string) {
        return this.execRun(this.stmts.updateRefreshTokenAlias, [alias, tokenId])
    }

    public suspendRefreshToken(tokenId: number) {
        return this.execRun(this.stmts.updateRefreshTokenSuspended, [1, tokenId])
    }

    public removeRefreshToken(tokenId: number) {
        return this.execRun(this.stmts.deleteRefreshToken, [tokenId])
    }

    public removeRefreshTokens(userId: number) {
        return this.execRun(this.stmts.deleteRefreshTokens, [userId])
    }

    // #endregion

    // #region Stream token

    public insertStreamToken(userId: number, tokenHash: string, tokenHint: string, alias: string) {
        return this.execRun(this.stmts.insertStreamToken, [userId, tokenHash, tokenHint, alias])
    }

    public getStreamTokens(userId: number) {
        const row = this.execAll(this.stmts.selectStreamTokensFromUser, [userId]) as {
            "id": number,
            "token_hint": string,
            "alias": string,
            "created_at": string,
            "last_used_at": string | null,
            "last_ip": string | null
        }[]
        return row
    }

    public checkStreamToken(tokenHash: string) {
        const row = this.execGet(this.stmts.selectStreamToken, [tokenHash])
        if (row === undefined) return null
        return row as {
            "id": number,
            "user_id": number
        }
    }

    public updateStreamToken(tokenId: number, ip: string | null) {
        return this.execRun(this.stmts.updateStreamToken, [ip, tokenId])
    }

    public setStreamTokenAlias(tokenId: number, alias: string) {
        return this.execRun(this.stmts.updateStreamTokenAlias, [alias, tokenId])
    }

    public removeStreamToken(tokenId: number) {
        return this.execRun(this.stmts.deleteStreamToken, [tokenId])
    }

    public removeStreamTokens(userId: number) {
        return this.execRun(this.stmts.deleteStreamTokens, [userId])
    }

    // #endregion
}
