import { json, Router } from "express";
import { requireLogin } from "../../../middlewares/auth";

import { DatabaseError, type AppDatabaseSql, type SqlDatabaseUser } from "../../../../database/sql";
import type { AppDatabaseRedis } from "../../../../database/redis";
import type { AppCrypto } from "../../../../infra/crypto";
import { DEVELOPMENT_MODE, LOGIN_TOKEN_MAX_AGE, REGISTRATION_PENDING_TIMEOUT } from "../../../../consts";
import * as ipaddr from "ipaddr.js";

import { safeParse } from "zod";

import {
    StartRegistrationSchema,
    FinishRegistrationSchema,
    LoginSchema,
    RecoverSchema,
    ResetSchema
} from "./schemas";
import { sanitizeTotpSecret } from "./utilities";

const assembleUserResponse = (user: SqlDatabaseUser) => ({
    user_id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at
})

export function createAuthenticationRouter(databaseSql: AppDatabaseSql, databaseRedis: AppDatabaseRedis, crypto: AppCrypto) {
    const router = Router()

    // #region register

    // 注册第一步：立刻写入一行待注册账号（TOTP 密钥留空）以原子地占用用户名，
    // 并通过签名令牌把后续的密钥设置绑定到这次请求上，避免二次提交口令.
    router.post('/api/auth/register', json(), async (req, res) => {
        const parsed = safeParse(StartRegistrationSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const passcodeHash = await crypto.bcryptHash(parsed.data.passcode)
        let userId: number | null = null
        try {
            userId = databaseSql.insertUser(parsed.data.username, null, passcodeHash)
        } catch (err) {
            if (err instanceof DatabaseError && (err.originalError as any).errcode === 2067) {
                res.status(409).send({ error: "用户名已被占用" })
                return
            } else throw err // FIXME: do something about this
        }
        if (userId === null) {
            throw new Error("用户插入失败")
        }
        res.status(200).send({
            user_id: userId,
            registration_token: crypto.generateRegistrationToken(userId, REGISTRATION_PENDING_TIMEOUT)
        })
    })

    // 注册第二步：用户已把密钥加入验证器并算出一次口令，这里复核后补写密钥.
    // 账号仍保持 verified = 0，等待管理员批准.
    router.put('/api/auth/register', json(), async (req, res) => {
        const parsed = safeParse(FinishRegistrationSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const token = crypto.parseRegistrationToken(parsed.data.registration_token)
        if (token === null) {
            res.status(401).send({ error: "注册令牌无效" })
            return
        }
        if (Date.now() > token.exp) {
            res.status(401).send({ error: "注册令牌已过期" })
            return
        }
        const user = databaseSql.selectUserById(token.userId)
        if (user === null || user.verified !== 0) {
            res.status(400).send({ error: "账号状态不允许完成注册" })
            return
        }
        if (user.totp_secret_encrypted !== null) {
            res.status(400).send({ error: "该账号已完成 TOTP 设置" })
            return
        }
        const totpSecret = sanitizeTotpSecret(parsed.data.totp_secret)
        if (totpSecret === null) {
            res.status(400).send({ error: "TOTP 密钥格式不合法或长度不足" })
            return
        }
        // 密钥由前端生成并在添加令牌后自校验过一次，后端复核以确认验证器确实配置正确.
        if (crypto.validateTotpToken(parsed.data.totp_token, totpSecret) === null) {
            res.status(400).send({ error: "TOTP 口令校验失败" })
            return
        }
        databaseSql.updateTotpSecretEncrypted(user.id, crypto.aes256Encrypt(totpSecret))
        res.status(200).send({ user_id: user.id })
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

    // #region recover

    router.post('/api/auth/recover', json(), async (req, res) => {
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

        // 未通过管理员批准的账号不算正式用户：返回 202 但不进入找回流程，
        // 以免污染"verified = 0 即待注册"这一区分依据.
        if (user.verified === 0) {
            res.status(202).end()
            return
        }

        // 首次请求：标记待处理并吊销该用户的全部登录凭据；重复请求同样返回 202，便于前端安全重试.
        if (user.recovery_pending === 0) {
            databaseSql.setUserRecoveryPending(user.id, true)
            databaseSql.removeRefreshTokens(user.id)
            databaseSql.removeStreamTokens(user.id)
            await databaseRedis.delSessionsFromUser(user.id)
        }
        res.status(202).end()
    })

    // #endregion

    // #region reset

    // 管理员批准找回请求后 totp_secret_encrypted 被置空，用户在此提交新的 TOTP 密钥完成重置.
    router.put('/api/auth/reset', json(), async (req, res) => {
        const parsed = safeParse(ResetSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const user = databaseSql.selectUserByUsername(parsed.data.username)
        // 先校验口令再看账号状态，避免未通过口令校验的请求探测账号是否处于找回流程.
        const passcodeMatched = user !== null
            && await crypto.bcryptCompare(parsed.data.passcode, user.passcode_hash)
        if (user === null || passcodeMatched !== true) {
            res.status(401).send({ error: "用户名或安全口令错误" })
            return
        }
        if (user.verified !== 1 || user.totp_secret_encrypted !== null) {
            res.status(400).send({ error: "该账号当前不处于待重置状态" })
            return
        }
        const totpSecret = sanitizeTotpSecret(parsed.data.totp_secret)
        if (totpSecret === null) {
            res.status(400).send({ error: "TOTP 密钥格式不合法或长度不足" })
            return
        }
        if (crypto.validateTotpToken(parsed.data.totp_token, totpSecret) === null) {
            res.status(400).send({ error: "TOTP 口令校验失败" })
            return
        }
        databaseSql.updateTotpSecretEncrypted(user.id, crypto.aes256Encrypt(totpSecret))
        databaseSql.setUserRecoveryPending(user.id, false)
        res.status(200).send({ user_id: user.id })
    })

    // #endregion
    
    return router
}
