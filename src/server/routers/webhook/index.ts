import { json, Router } from "express";
import type { WebhookMessage } from "./types";
import type { AppDatabaseRedis } from "../../../database/redis";
import * as ipaddr from "ipaddr.js"
import type { EventBus } from "../../../infra/event-bus";
import type { AppEvents } from "../../../infra/event-bus/events";
import type { AppCrypto } from "../../../infra/crypto";
import type { AppDatabaseSql } from "../../../database/sql";
import type { SessionData } from "express-session";

// FIXME 已知问题：有时来自 ZLMediaKit 的 Webhook 消息到达的顺序不对，需要按照请求体中的 hook_index 重新排序。

export function createWebhookRouter(databaseSql: AppDatabaseSql, databaseRedis: AppDatabaseRedis, crypto: AppCrypto, eventBus: EventBus<AppEvents>) {
    const router = Router()
    router.use(json())
    
    router.post('/api/webhook/on_server_started', async (req, res) => {
        const body = req.body as WebhookMessage.OnServerStarted
        const ip = ipaddr.process(req.ip!).toString()
        eventBus.emit('api.webhook.server_started', { remoteAddress: ip, body })
        await databaseRedis.setMediaServer(body, ip)
        res.send({
            "code": 0
        })
    })

    router.post('/api/webhook/on_stream_changed', async (req, res) => {
        const body = req.body as WebhookMessage.OnStreamChanged
        if (body.regist === true) {
            eventBus.emit('api.webhook.stream_registered', { body })
            await databaseRedis.setStream(body)
        } else {
            eventBus.emit('api.webhook.stream_deregistered', { body })
            await databaseRedis.delStream(body)
        }
        res.send({
            "code": 0
        })
    })

    router.post('/api/webhook/on_server_keepalive', async (req, res) => {
        const body = req.body as WebhookMessage.OnServerKeepalive
        const ip = ipaddr.process(req.ip!).toString()
        eventBus.emit('api.webhook.server_keepalive', { body })
        await databaseRedis.mediaServerKeepAlive(body, ip)
        res.send({
            "code": 0
        })
    })

    router.post('/api/webhook/on_publish', async (req, res) => {
        const body = req.body as WebhookMessage.OnPublish
        const params = new URLSearchParams(body.params)

        const ip = params.get('ip') ?? ipaddr.parse(req.ip!).toString()
        const token = params.get('token')
        const password = params.get('pwd')
        const color = params.get('color')
        const name = params.get('name')

        if (token === null) {
            res.status(401).send({ error: '未提供推流令牌' })
            return
        }

        const tokenHash = crypto.sha256Hash(token)
        const result = databaseSql.checkStreamToken(tokenHash)

        if (result === null) {
            res.status(401).send({ error: '推流令牌无效' })
            return
        }

        const user = databaseSql.selectUserById(result.user_id)

        if (user === null) {
            res.status(401).send({ error: '用户不存在' })
            return
        }

        if (user.verified === 0) {
            res.status(403).send({ error: '账号未经过验证' })
        }

        databaseRedis.setStreamMeta({
            ip,
            streamId: body.stream,
            userId: user.id,
            streamTokenId: result.id,
            mediaServerId: body.mediaServerId,
            name,
            color,
            password
        })

        databaseSql.updateStreamToken(result.id, ip)

        res.send({ "code": 0, "msg": "success" })
    })

    router.post('/api/webhook/on_play', async (req, res) => {
        const body = req.body as WebhookMessage.OnPlay
        const params = new URLSearchParams(body.params)
        const sessionId = params.get('session')
        if (sessionId === null) {
            res.status(401).send({ error: "未提供会话ID" })
            return
        }
        const session = await new Promise<SessionData | null | undefined>((resolve, reject) => { req.sessionStore.get(sessionId, (err, session) => { if (err) reject(err); else resolve(session) }) })
        if (session === null || session === undefined) {
            res.status(403).send({ error: "会话不存在" })
            return
        }
        res.send({ "code": 0, "msg": "success" })
    })

    router.post('/api/webhook/on_flow_report', (req, res) => {
        const body = req.body as WebhookMessage.OnFlowReport
        if (!body.player) {
            databaseRedis.delStreamMeta(body.stream)
        }
        res.send({
            "code" : 0,
            "msg" : "success"
        })
    })

    return router
}
