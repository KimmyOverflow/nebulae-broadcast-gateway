import { json, raw, Router } from "express";
import { requireLogin } from "../../../middlewares/auth";
import type { AppDatabaseSql } from "../../../../database/sql";
import type { AppCrypto } from "../../../../infra/crypto";
import { safeParse } from "zod";
import type { AppDatabaseRedis } from "../../../../database/redis";
import { PROFILE_PIC_MAX_SIZE } from "../../../../consts";
import {
    SetRefreshTokenAliasSchema,
    DeleteRefreshTokenSchema,
    GenerateStreamTokenSchema,
    SetStreamTokenAliasSchema,
    DeleteStreamTokenSchema,
    VerifyUserSchema,
    ResetTotpSchema
} from "./schemas";

export function createUserRouter(databaseSql: AppDatabaseSql, databaseRedis: AppDatabaseRedis, crypto: AppCrypto) {
    const router = Router()

    // #region query

    router.get('/api/user/query', (req, res) => {
        const param = (req.query['user_id'] ?? null) as string | null
        if (param === null) {
            res.status(400).send({ error: "未提供用户ID" })
            return
        }
        let id: number
        try {
            id = Number(param)
        } catch {
            res.status(400).send({ error: "用户ID不合法" })
            return
        }
        const user = databaseSql.selectUserById(id)
        if (user === null) {
            res.status(404).send({ error: "用户不存在" })
            return
        }
        res.status(200).send({ user: {
            user_id: user.id,
            username: user.username,
            role: user.role,
            created_at: user.created_at
        }})
    })

    // #endregion

    // #region profile_pic

    router.get('/api/user/profile_pic', (req, res) => {
        const param = (req.query['user_id'] ?? null) as string | null
        if (param === null) {
            res.status(400).send({ error: "未提供用户ID" })
            return
        }
        let id: number
        try {
            id = Number(param)
        } catch {
            res.status(400).send({ error: "用户ID不合法" })
            return
        }
        const user = databaseSql.selectUserById(id)
        if (user === null) {
            res.status(404).send({ error: "用户不存在" })
            return
        }
        const profilePic = databaseSql.getProfilePicture(id)
        if (profilePic === null) {
            res.status(204).end()
            return
        }
        const etag = `"${crypto.sha256Hash(profilePic)}"`
        if (req.headers['if-none-match'] === etag) {
            res.status(304).end()
            return
        }
        let data: Buffer
        try {
            data = Buffer.from(profilePic, 'base64url')
        } catch {
            res.status(500).send({ error: "数据解析失败" })
            return
        }
        res.setHeader('Content-Type', 'image/webp')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('ETag', etag)
        res.status(200).send(data)
    })

    // #endregion
    
    // #region update_profile_pic

    router.post('/api/user/update_profile_pic',
        requireLogin(),
        (req, res, next) => {
            raw({ type: ['image/webp', 'application/octet-stream'], limit: PROFILE_PIC_MAX_SIZE })(req, res, (err) => {
                if (err) {
                    if (err instanceof Error && err.name === 'PayloadTooLargeError') {
                        res.status(413).send({ error: '图像大小超过 1 MiB' })
                        return
                    }
                    next(err)
                    return
                }
                next()
            })
        },
        (req, res) => {
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                res.status(400).send({ error: '请求体格式不正确' })
                return
            }
            const data = req.body as Buffer
            // WebP 魔数：'RIFF' + 4 字节长度 + 'WEBP'
            const isValidWebP = data.length >= 12
                && data.toString('ascii', 0, 4) === 'RIFF'
                && data.toString('ascii', 8, 12) === 'WEBP'
                && data.length === data.readUInt32LE(4) + 8
            if (!isValidWebP) {
                res.status(400).send({ error: '不是有效的 WebP 图像' })
                return
            }
            databaseSql.updateProfilePicture(req.session.userId!, data.toString('base64url'))
            res.status(200).end()
        }
    )

    // #endregion

    // #region Refresh Token

    router.get('/api/user/refresh_tokens', requireLogin(), async (req, res) => {
        const refreshTokens = databaseSql.getRefreshTokens(req.session.userId!)
        res.status(200).send({
            refresh_tokens: await Promise.all(refreshTokens.map(async refreshToken => ({
                ...refreshToken,
                active_sessions: (await databaseRedis.client.smembers(`refreshToken:${refreshToken.id}:sessions`)).length,
                is_used_by_current_session: refreshToken.id === req.session.refreshTokenId
            })))
        })
    })

    router.post('/api/user/set_refresh_token_alias', requireLogin(), json(), (req, res) => {
        const parsed = safeParse(SetRefreshTokenAliasSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        databaseSql.setRefreshTokenAlias(parsed.data.token_id, parsed.data.alias)
        res.status(200).end()
    })

    router.delete('/api/user/suspend_refresh_token', requireLogin(), json(), (req, res) => {
        const parsed = safeParse(DeleteRefreshTokenSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        databaseSql.suspendRefreshToken(parsed.data.token_id)
        databaseRedis.delSessionsFromRefreshToken(parsed.data.token_id)
        res.status(200).end()
    })

    router.post('/api/user/gen_stream_token', requireLogin(), json(), (req, res) => {
        const parsed = safeParse(GenerateStreamTokenSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const streamToken = crypto.generateStreamToken()
        const streamTokenHash = crypto.sha256Hash(streamToken)
        const streamTokenHint = `${streamToken.slice(0, 4)}...${streamToken.slice(-4)}`
        databaseSql.insertStreamToken(req.session.userId!, streamTokenHash, streamTokenHint, parsed.data.alias)
        res.status(200).send({ stream_token: streamToken })
    })

    // #endregion
    
    // #region Stream Token

    router.get('/api/user/stream_tokens', requireLogin(), (req, res) => {
        const streamTokens = databaseSql.getStreamTokens(req.session.userId!)
        res.status(200).send({ stream_tokens: streamTokens })
    })

    router.post('/api/user/set_stream_token_alias', requireLogin(), json(), (req, res) => {
        const parsed = safeParse(SetStreamTokenAliasSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        databaseSql.setStreamTokenAlias(parsed.data.token_id, parsed.data.alias)
        res.status(200).end()
    })

    router.delete('/api/user/suspend_stream_token', requireLogin(), json(), (req, res) => {
        const parsed = safeParse(DeleteStreamTokenSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        databaseSql.removeStreamToken(parsed.data.token_id)
        res.status(200).end()
    })

    // #endregion

    // #region Admin Privileged

    // 管理员批准注册：把待验证用户标记为已验证.
    router.put('/api/user/verify', requireLogin({ requireAdmin: true }), json(), (req, res) => {
        const parsed = safeParse(VerifyUserSchema, req.body)
        if (parsed.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }
        const targetUser = databaseSql.selectUserById(parsed.data.user_id)
        if (targetUser === null) {
            res.status(400).send({ error: "目标用户不存在" })
            return
        }
        // 未完成 TOTP 设置的账号不应被批准，否则批准出来的是个登录不了的死号.
        if (targetUser.totp_secret_encrypted === null) {
            res.status(400).send({ error: "目标用户尚未完成 TOTP 设置" })
            return
        }
        const { changes } = databaseSql.setUserVerified(parsed.data.user_id)
        if (changes === 0) {
            res.status(400).send({ error: "用户ID不存在或已经通过验证" })
            return
        }
        res.status(200).end()
    })

    // 管理员待办队列：注册待批准与找回待批准两类.
    // 找回项中 totp_installed 为 false 表示已批准，仅剩用户提交新密钥这一步.
    router.get('/api/user/pending', requireLogin({ requireAdmin: true }), (_req, res) => {
        res.status(200).send({
            pending_registrations: databaseSql.getPendingRegistrations().map(user => ({
                user_id: user.id,
                username: user.username,
                created_at: user.created_at
            })),
            pending_recoveries: databaseSql.getPendingRecoveries().map(user => ({
                user_id: user.id,
                username: user.username,
                created_at: user.created_at,
                totp_installed: user.totp_installed === 1
            }))
        })
    })

    // 管理员批准找回请求：清空 TOTP 密钥并保留 recovery_pending（阻止登录），
    // 等待用户通过 /api/auth/reset 提交新密钥.
    router.put('/api/user/reset', requireLogin({ requireAdmin: true }), json(), (req, res) => {
        const parsed = safeParse(ResetTotpSchema, req.body)
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
        res.status(200).end()
    })

    return router
}
