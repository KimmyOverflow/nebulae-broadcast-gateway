import { json, Router } from "express";
import { requireLogin } from "../../middlewares/auth";
import { boolean, number, object, safeParse, string } from "zod";
import { DatabaseError, type AppDatabaseSql, type SqlDatabaseUser } from "../../../database/sql";
import type { AppDatabaseRedis } from "../../../database/redis";
import type { AppCrypto } from "../../../infra/crypto";
import { DEVELOPMENT_MODE, LOGIN_TOKEN_MAX_AGE } from "../../../consts";
import * as ipaddr from "ipaddr.js";

const LoginSchema = object({
    username: string(),
    totp_token: string(),
    remember_me: boolean()
})

const RecoverSchema = object({
    username: string(),
    passcode: string()
})

const RegistrationSchema = object({
    username: string(),
    passcode: string()
})

const VerifySchema = object({
    user_id: number()
})

const ResetSchema = object({
    user_id: number()
})

export const assembleOtpauthUrl = (username: string, totpSecret: string) =>
    `otpauth://totp/NebulaeBroadcast:${username}?secret=${totpSecret}&issuer=NebulaeBroadcast`

const assembleUserResponse = (user: SqlDatabaseUser) => ({
    user_id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at
})

export function createAuthenticationRouter(databaseSql: AppDatabaseSql, databaseRedis: AppDatabaseRedis, crypto: AppCrypto) {
    const router = Router()

    // #region registration

    router.post('/api/auth/registration', json(), async (req, res) => {
        const parsed = safeParse(RegistrationSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const totpSecret = crypto.generateTotpSecret()
        const totpSecretEncrypted = crypto.aes256Encrypt(totpSecret)
        const passcodeHash = await crypto.bcryptHash(parsed.data.passcode)
        try {
            databaseSql.insertUser(parsed.data.username, totpSecretEncrypted, passcodeHash)
        } catch (err) {
            if (err instanceof DatabaseError && (err.originalError as any).errcode === 2067) {
                res.status(409).send({ error: "用户名已被占用" })
                return
            } else throw err // LOL
        }
        res.status(200).send({ otpauth_url: assembleOtpauthUrl(parsed.data.username, totpSecret) });
    })

    // #endregion

    // #region verify

    router.put('/api/auth/verify', requireLogin({ requireAdmin: true }), json(), async (req, res) => {
        const parsed = safeParse(VerifySchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const { changes } = databaseSql.setUserVerified(parsed.data.user_id)
        if (changes === 0) {
            res.status(400).send({ error: "用户ID不存在或已经通过验证" })
            return
        }
        res.status(200).end()
    })

    // #endregion

    // #region login

    // 使用TOTP口令登录.
    router.post('/api/auth/login', json(), async (req, res) => {
        const parsed = safeParse(LoginSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const user = databaseSql.selectUserByUsername(parsed.data.username)
        if (user === null) {
            res.status(401).send({ error: "用户名或口令错误" })
            return
        }
        if (user.verified === 0) {
            res.status(403).send({ error: "用户未通过验证" })
            return
        }
        if (user.recovery_pending === 1) {
            res.status(403).send({ error: "用户已请求找回" })
            return
        }
        if (user.totp_secret_encrypted === null) {
            res.status(400).send({ error: "用户TOTP已被重置" })
            return
        }
        const totpSecret = crypto.aes256Decrypt(user.totp_secret_encrypted)
        const result = crypto.validateTotpToken(parsed.data.totp_token, totpSecret)
        if (result === null) {
            res.status(401).send({ error: "用户名或口令错误" })
            return
        }

        // 查找当前浏览器已关联的刷新令牌记录：优先当前会话，其次刷新令牌 cookie（会话丢失时仍可能存在）.
        const findBrowserRefreshTokenId = () => {
            if (req.session.refreshTokenId !== undefined) {
                const existing = databaseSql.getRefreshTokenById(req.session.refreshTokenId)
                if (existing !== null && existing.user_id === user.id && existing.suspended === 0) {
                    return existing.id
                }
            }

            const browserToken = req.cookies['refresh_token'] as string | undefined
            if (browserToken === undefined) return null
            const tokenPayload = crypto.parseRefreshToken(browserToken)
            if (tokenPayload === null || tokenPayload.userId !== user.id) return null
            const existing = databaseSql.checkRefreshToken(crypto.sha256Hash(browserToken))
            if (existing === null || existing.user_id !== user.id || existing.suspended === 1) return null
            return existing.id
        }

        if (parsed.data.remember_me) {
            const token = crypto.generateRefreshToken(user.id, LOGIN_TOKEN_MAX_AGE)
            const tokenHash = crypto.sha256Hash(token)
            const userAgent = req.headers['user-agent'] ?? null
            let ip = req.ip === undefined ? null : ipaddr.process(req.ip).toString()

            // 重复登录时复用已有记录，避免同一浏览器被重复记录.
            const existingTokenId = findBrowserRefreshTokenId()
            let refreshTokenId: number | null = null
            if (existingTokenId !== null && databaseSql.updateRefreshToken(existingTokenId, tokenHash, userAgent, ip).changes !== 0) {
                refreshTokenId = existingTokenId
            } else {
                refreshTokenId = databaseSql.insertRefreshToken(user.id, tokenHash, userAgent, ip)
            }
            if (refreshTokenId === null) {
                throw new Error("刷新令牌插入失败")
            }
            req.session.refreshTokenId = refreshTokenId
            await databaseRedis.setSessionMeta(user.id, req.sessionID, refreshTokenId)
            res.cookie('refresh_token', token, {
                httpOnly: DEVELOPMENT_MODE ? false : true,
                secure: DEVELOPMENT_MODE ? false : true,
                maxAge: LOGIN_TOKEN_MAX_AGE,
                sameSite: 'strict'
            })
        } else {
            await databaseRedis.setSessionMeta(user.id, req.sessionID)
        }

        req.session.isLoggedIn = true
        req.session.userId = user.id

        res.status(200).send(assembleUserResponse(user))
    })

    // #endregion

    // #region refresh

    // 使用刷新令牌登录或刷新会话.
    router.post('/api/auth/refresh', async (req, res) => {
        const clearCookie = () => {
            res.clearCookie('refresh_token', {
                httpOnly: DEVELOPMENT_MODE ? false : true,
                secure: DEVELOPMENT_MODE ? false : true,
                sameSite: 'strict',
            })

            res.clearCookie('session_id', {
                httpOnly: DEVELOPMENT_MODE ? false : true,
                secure: DEVELOPMENT_MODE ? false : true,
                sameSite: 'strict',
            })
        }

        const refreshToken = req.cookies['refresh_token'] as string | undefined
        if (refreshToken === undefined) {
            res.status(401).send({ error: "未提供刷新令牌" })
            return
        }

        // 验证 HMAC 签名并从令牌中提取用户 ID
        const tokenPayload = crypto.parseRefreshToken(refreshToken)
        if (tokenPayload === null) {
            clearCookie()
            res.status(401).send({ error: "刷新令牌无效" })
            return
        }

        // 检查令牌是否已过绝对有效期
        if (Date.now() > tokenPayload.exp) {
            clearCookie()
            res.status(401).send({ error: "刷新令牌已过期" })
            databaseSql.removeRefreshTokens(tokenPayload.userId)
            await databaseRedis.delSessionsFromUser(tokenPayload.userId)
            return
        }

        const tokenHash = crypto.sha256Hash(refreshToken)
        const result = databaseSql.checkRefreshToken(tokenHash)
        if (result === null) {
            databaseSql.removeRefreshTokens(tokenPayload.userId)
            await databaseRedis.delSessionsFromUser(tokenPayload.userId)
            clearCookie()
            res.status(401).send({ error: "刷新令牌不存在" })
            return
        }

        if (result.suspended === 1) {
            databaseSql.removeRefreshToken(result.id)
            clearCookie()
            res.status(401).send({ error: "刷新令牌已被停用" })
            return
        }

        const lastUpdated = Date.parse(result.last_updated_at)
        if (Date.now() - lastUpdated > LOGIN_TOKEN_MAX_AGE) {
            clearCookie()
            res.status(401).send({ error: "刷新令牌已过期" })
            databaseSql.removeRefreshTokens(result.user_id)
            await databaseRedis.delSessionsFromUser(result.user_id)
            return
        }

        const user = databaseSql.selectUserById(result.user_id)
        if (user === null) {
            clearCookie()
            res.status(401).send({ error: "用户不存在" })
            return
        }

        const newToken = crypto.generateRefreshToken(result.user_id, LOGIN_TOKEN_MAX_AGE)
        const newTokenHash = crypto.sha256Hash(newToken)
        let ip = req.ip === undefined ? null : ipaddr.process(req.ip).toString()
        databaseSql.updateRefreshToken(result.id, newTokenHash, req.headers['user-agent'] ?? null, ip)
        res.cookie('refresh_token', newToken, {
            httpOnly: DEVELOPMENT_MODE ? false : true,
            secure: DEVELOPMENT_MODE ? false : true,
            maxAge: LOGIN_TOKEN_MAX_AGE,
            sameSite: 'strict'
        })
        req.session.isLoggedIn = true
        req.session.userId = result.user_id
        req.session.refreshTokenId = result.id
        await databaseRedis.setSessionMeta(result.user_id, req.sessionID, result.id)

        res.status(200).send(assembleUserResponse(user))
    })

    // #endregion

    // #region query

    router.get('/api/auth/query', requireLogin(), (req, res) => {
        const user = databaseSql.selectUserById(req.session.userId!)
        if (user === null) {
            res.status(404).send({ error: "用户不存在" })
            return
        }
        res.status(200).send(assembleUserResponse(user))
    })

    // #endregion

    // #region logout

    router.post('/api/auth/logout', (req, res) => {
        if (req.session.refreshTokenId) {
            databaseSql.removeRefreshToken(req.session.refreshTokenId)
            databaseRedis.delSessionsFromRefreshToken(req.session.refreshTokenId)
        }

        databaseRedis.delSessionMeta(req.sessionID)

        req.session.destroy(() => {
            res.clearCookie('refresh_token', {
                httpOnly: DEVELOPMENT_MODE ? false : true,
                secure: DEVELOPMENT_MODE ? false : true,
                sameSite: 'strict',
            })

            res.clearCookie('session_id', {
                httpOnly: DEVELOPMENT_MODE ? false : true,
                secure: DEVELOPMENT_MODE ? false : true,
                sameSite: 'strict',
            })

            res.status(200).end()
        })
    })

    // #endregion

    // #region recovery

    router.post('/api/auth/recovery', json(), async (req, res) => {
        const parsed = safeParse(RecoverSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const user = databaseSql.selectUserByUsername(parsed.data.username)
        if (user === null) {
            res.status(401).send({ error: "用户不存在" })
            return
        }
        const result = await crypto.bcryptCompare(parsed.data.passcode, user.passcode_hash)
        if (result === false) {
            res.status(401).send({ error: "安全口令不正确" })
            return
        }

        if (user.totp_secret_encrypted !== null) {
            if (user.recovery_pending === 1) {
                res.status(400).send({ error: "已有待处理的找回请求" })
                return
            }
            databaseSql.setUserRecoveryPending(user.id, true)
            databaseSql.removeRefreshTokens(user.id)
            databaseSql.removeStreamTokens(user.id)
            await databaseRedis.delSessionsFromUser(user.id)
            res.status(200).end()
            return
        }

        const newTotpSecret = crypto.generateTotpSecret()
        const newTotpSecretEncrypted = crypto.aes256Encrypt(newTotpSecret)
        databaseSql.updateTotpSecretEncrypted(user.id, newTotpSecretEncrypted)
        databaseSql.setUserRecoveryPending(user.id, false)
        res.status(200).send({
            message: "管理员已通过找回请求",
            new_otpauth_url: assembleOtpauthUrl(user.username, newTotpSecret)
        })
    })

    // #endregion

    // #region reset

    router.put('/api/auth/reset', requireLogin({ requireAdmin: true }), json(), (req, res) => {
        const parsed = safeParse(ResetSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const targetUser = databaseSql.selectUserById(parsed.data.user_id)
        if (targetUser === null) {
            res.status(400).send({ error: "目标用户不存在" })
            return
        }
        if (targetUser.recovery_pending === 0) {
            res.status(400).send({ error: "目标用户未请求找回" })
            return
        }
        databaseSql.updateTotpSecretEncrypted(parsed.data.user_id, null)
        databaseSql.setUserRecoveryPending(parsed.data.user_id, false)
        res.status(200).end()
    })

    // #endregion
    
    return router
}
