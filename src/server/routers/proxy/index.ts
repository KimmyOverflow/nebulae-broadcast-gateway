import type { Request, Response } from "express"
import { Router, text } from "express"
import { requireLogin } from "../../middlewares/auth"
import type { AppLogger } from "../../../infra/logger"
import { LogLevel } from "../../../infra/logger"
import { Resolver } from "node:dns/promises"
import type { AppDatabaseSql } from "../../../database/sql"
import type { AppDatabaseRedis } from "../../../database/redis"
import type { AppCrypto } from "../../../infra/crypto"
import * as ipaddr from "ipaddr.js"
import {
    MEDIA_SERVER_REQUEST_TIMEOUT_MS,
    buildMediaServerUrl,
    parseMediaServerConfig,
    parseMediaServerTarget,
} from "./validation"

// /** BEGIN Deprecated code: We have ditched encoding params in base64 */

// // ============================================================
// // 代理请求中 base64 编码的 JSON 参数类型
// // ============================================================

// type WhipParameters = {
//     username: string
//     password: string
//     mediaServerId: string
//     streamName?: string
//     streamColor?: string
//     streamPassword?: string
// }

// type WhepParameters = {
//     username: string
//     password: string
//     streamId: string
//     mediaServerId: string
//     streamPassword?: string
// }

// // ============================================================
// // 工具函数
// // ============================================================

// /**
//  * 将 base64 字符串解码为 JSON 对象.
//  * 解析失败返回 null.
//  */
// function decodeParams<T>(encoded: string | undefined): T | null {
//     try {
//         if (!encoded) return null
//         const decoded = Buffer.from(encoded, "base64").toString("utf-8")
//         return JSON.parse(decoded) as T
//     } catch {
//         return null
//     }
// }

// /** END Deprecated code */

/**
 * 将 SDP 文本中出现的所有域名替换为 DNS 解析后的 IP 地址.
 * 若某个域名解析失败，则原样保留.
 */

const resolver = new Resolver()
resolver.setServers([
    '223.5.5.5',
    '223.6.6.6'
])

async function resolveDomainsInSdp(sdp: string): Promise<string> {
    const resolved = new Map<string, string>()

    const resolveHost = async (host: string): Promise<string> => {
        // 空串、纯 IPv4 数字、含冒号的 IPv6 都不需要解析
        if (host === '' || /^[\d.]+$/.test(host) || host.includes(':')) return host
        if (resolved.has(host)) return resolved.get(host)!

        try {
            const addresses = await resolver.resolve4(host)
            if (addresses.length > 0 && addresses[0] !== undefined) {
                resolved.set(host, addresses[0])
                return addresses[0]
            }
        } catch {
            // DNS 解析失败（如 mDNS 的 .local），保留原样
        }

        resolved.set(host, host)
        return host
    }

    const lines = sdp.split(/\r\n|\r|\n/)
    const out: string[] = []

    for (const line of lines) {
        if (line.startsWith('c=')) {
            const parts = line.split(' ')
            // c=IN IP4 <地址>
            if (parts.length >= 3) {
                parts[2] = await resolveHost(parts[2]!)
            }
            out.push(parts.join(' '))
        } else if (line.startsWith('a=candidate:')) {
            const parts = line.split(' ')
            // a=candidate:<foundation> <component> <transport> <priority> <地址> <port> ...
            if (parts.length >= 6) {
                parts[4] = await resolveHost(parts[4]!)
            }
            const raddrIdx = parts.indexOf('raddr')
            if (raddrIdx !== -1 && parts[raddrIdx + 1] !== undefined) {
                parts[raddrIdx + 1] = await resolveHost(parts[raddrIdx + 1]!)
            }
            out.push(parts.join(' '))
        } else {
            // extmap、rtcp-fb、msid 等标识符行原样保留
            out.push(line)
        }
    }

    return out.join('\r\n')
}

export function createProxyRouter(databaseSql: AppDatabaseSql, databaseRedis: AppDatabaseRedis, crypto: AppCrypto, logger: AppLogger) {
    const router = Router()

    router.post("/api/whip", text({ type: '*/*' }), async (req, res) => {
        const authHeader = req.headers['authorization']
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

        if (!token) {
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

        const mediaServerId = (req.query['server'] ?? null) as string | null
        const password = (req.query['pwd'] ?? null) as string | null
        const streamColor = (req.query['color'] ?? null) as string | null
        const streamName = (req.query['name'] ?? null) as string | null

        if (mediaServerId === null) {
            logger.log({
                level: LogLevel.Error,
                prefix: '代理',
                content: `WHIP 请求 ${req.url} 未指定目标媒体服务器.`
            })
            res.status(400).send({ error: "未指定媒体服务器" })
            return
        }

        const serverIp = await databaseRedis.client.hget(`mediaServer:${mediaServerId}`, 'ip')
        const serverConfig = parseMediaServerConfig(await databaseRedis.client.hget(`mediaServer:${mediaServerId}`, 'config'))
        const target = parseMediaServerTarget(serverIp, serverConfig['http.port'])
        if (target === null) {
            logger.log({
                level: LogLevel.Error,
                prefix: '代理',
                content: `无法获取指定媒体服务器 ${mediaServerId} 的有效IP地址或服务端口号.`
            })
            res.status(400).send({ error: '指定的媒体服务器不可用' })
            return
        }

        const clientIp = ipaddr.parse(req.ip!).toString()
        const streamId = `${user.username}-${Date.now()}`
        const targetUrl = buildMediaServerUrl(target, '/index/api/whip')
        targetUrl.searchParams.set('app', 'live')
        targetUrl.searchParams.set('stream', streamId)
        targetUrl.searchParams.set('token', token)
        targetUrl.searchParams.set('ip', clientIp)
        if (password) targetUrl.searchParams.set('pwd', password)
        if (streamColor) targetUrl.searchParams.set('color', streamColor)
        if (streamName) targetUrl.searchParams.set('name', streamName)

        const upstream = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": req.headers["content-type"] || "application/sdp" },
            body: req.body,
            redirect: 'manual',
            signal: AbortSignal.timeout(MEDIA_SERVER_REQUEST_TIMEOUT_MS),
        })

        const body = await upstream.text()

        logger.log({
            level: LogLevel.Info,
            prefix: '代理',
            content: `处理来自 ${clientIp} 的 WHIP 请求 ${req.url} 上游响应 ${upstream.status}`
        })

        res
            .status(upstream.status)
            .set("Content-Type", upstream.headers.get("content-type") || "application/sdp")
            .set("Location", upstream.headers.get("location") ?? undefined)
            .send(body)
    })

    router.post("/api/whep", requireLogin(), text({ type: '*/*' }), async (req: Request, res: Response) => {
        const streamId = (req.query['stream'] ?? null) as string | null
        const password = (req.query['pwd'] ?? null) as string | null
        
        if (streamId === null) {
            res.status(400).send({ error: "未提供流ID" })
            return
        }

        const streamMeta = await databaseRedis.getStreamMeta(streamId)
        if (streamMeta === null) {
            res.status(404).send({ error: "指定的流不存在" })
            return
        }

        if (streamMeta.password !== null && streamMeta.password !== password) {
            res.status(403).send({ error: "密码错误" })
            return
        }

        const serverIp = await databaseRedis.client.hget(`mediaServer:${streamMeta.mediaServerId}`, 'ip')

        if (serverIp === null) {
            res.status(404).send({ error: "媒体服务器不存在" })
            return
        }

        const serverConfig = parseMediaServerConfig(await databaseRedis.client.hget(`mediaServer:${streamMeta.mediaServerId}`, 'config'))
        const target = parseMediaServerTarget(serverIp, serverConfig["http.port"])

        if (target === null) {
            res.status(500).send({ error: "指定的媒体服务器未设置有效的HTTP端口" })
            return
        }

        const targetUrl = buildMediaServerUrl(target, '/index/api/whep')
        targetUrl.searchParams.set('app', 'live')
        targetUrl.searchParams.set('stream', streamId)
        targetUrl.searchParams.set('type', 'play')
        targetUrl.searchParams.set('session', req.sessionID)

        try {
            const upstream = await fetch(targetUrl, {
                method: "POST",
                headers: { "Content-Type": req.headers["content-type"] || "application/sdp" },
                body: req.body,
                redirect: 'manual',
                signal: AbortSignal.timeout(MEDIA_SERVER_REQUEST_TIMEOUT_MS),
            })

            let body = await upstream.text()

            try {
                body = await resolveDomainsInSdp(body)
            } catch (dnsErr) {
                logger.log({
                    level: LogLevel.Warn,
                    prefix: "代理",
                    content: "WHEP 响应中的域名解析失败，将使用原始 SDP.",
                    additionalContent: String(dnsErr),
                })
            }

            logger.log({
                level: LogLevel.Info,
                prefix: "代理",
                content: `处理来自 ${ipaddr.parse(req.ip!).toString()} 的 WHEP 请求 ${req.url} 上游响应 ${upstream.status}`,
            })

            res
                .status(upstream.status)
                .set("Content-Type", upstream.headers.get("content-type") || "application/sdp",)
                .set("Location", upstream.headers.get("location") ?? undefined)
                .send(body)
        } catch (err) {
            logger.log({
                level: LogLevel.Error,
                prefix: "代理",
                content: `WHEP 转发失败 -> ${targetUrl.origin}${targetUrl.pathname}`,
                additionalContent: String(err),
            })
            res.status(502).send({ error: "网关错误" })
        }
    })

    return router
}
