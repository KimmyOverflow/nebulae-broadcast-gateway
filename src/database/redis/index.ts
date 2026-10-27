import Redis from "ioredis";
import type { WebhookMessage } from "../../server/routers/webhook/types";
import { SESSION_MAX_AGE } from "../../consts";
import type { EventBus } from "../../infra/event-bus";
import type { AppEvents } from "../../infra/event-bus/events";

export type StreamMeta = {
    ip: string,
    streamId: string,
    userId: number,
    streamTokenId: number
    mediaServerId: string
    name: string | null,
    color: string | null,
    password: string | null
}

export class AppDatabaseRedis {
    public client: Redis
    private eventBus: EventBus<AppEvents>
    constructor(eventBus: EventBus<AppEvents>) {
        this.client = new Redis()
        this.eventBus = eventBus
    }

    public async setStream(stream: WebhookMessage.OnStreamChanged.Registered) {
        await this.client.multi()
            .sadd(`stream:${stream.stream}:schemas`, `stream:${stream.stream}:schema:${stream.schema}`)
            .set(`stream:${stream.stream}:schema:${stream.schema}`, JSON.stringify(stream))
            
            .expire(`mediaServer:${stream.mediaServerId}:streams`, 120)
            .expire(`stream:${stream.stream}:schemas`, 120)
            .expire(`stream:${stream.stream}:schema:${stream.schema}`, 120)
            
            .exec()
    }

    public async delStream(stream: WebhookMessage.OnStreamChanged.Deregistered) {
        await this.client.multi()
            .srem(`stream:${stream.stream}:schemas`, `stream:${stream.stream}:schema:${stream.schema}`)
            .del(`stream:${stream.stream}:schema:${stream.schema}`)
            .exec()
    }

    public async setStreamMeta(meta: StreamMeta) {
        this.eventBus.emit('api.sse.stream_published', {
            user_id: meta.userId,
            stream_id: meta.streamId,
            media_server_id: meta.mediaServerId,
            ...(meta.name && { name: meta.name }),
            ...(meta.color && { color: meta.color }),
            password_protected: meta.password !== null ? true : false
        })

        const pipeline = this.client.pipeline()
        pipeline
            .sadd(`mediaServer:${meta.mediaServerId}:streams`, `stream:${meta.streamId}`)
            .hset(`stream:${meta.streamId}:meta`,
                'ip',               meta.ip,
                'user',             `user:${meta.userId}`,
                'streamTokenId',    meta.streamTokenId,
                'mediaServer',      `mediaServer:${meta.mediaServerId}`,
            )
            .zremrangebyscore(`user:${meta.userId}:streams`, '-inf', `(${Date.now() - 1000 * 120}`)
            .zadd(`user:${meta.userId}:streams`, Date.now(), `stream:${meta.streamId}`)
            .expire(`stream:${meta.streamId}:meta`, 120)

            if (meta.name) pipeline.hset(`stream:${meta.streamId}:meta`, 'name', meta.name)
            if (meta.color) pipeline.hset(`stream:${meta.streamId}:meta`, 'color', meta.color)
            if (meta.password) pipeline.hset(`stream:${meta.streamId}:meta`, 'password', meta.password)
        
        await pipeline.exec()
    }

    public async delStreamMeta(streamId: string) {
        const meta = await this.client.hgetall(`stream:${streamId}:meta`)
        if (Object.keys(meta).length === 0) return

        this.eventBus.emit('api.sse.stream_ended', { stream_id: streamId })

        await this.client.pipeline()
            .srem(`${meta.mediaServer}:streams`, `stream:${streamId}`)
            .zremrangebyscore(`${meta.user}:streams`, '-inf', `(${Date.now() - 1000 * 120}`)
            .zrem(`${meta.user}:streams`, `stream:${streamId}`)
            .del(`stream:${streamId}:meta`)
            .exec()

    }

    public async getStreamMeta(streamId: string): Promise<StreamMeta | null> {
        const meta = await this.client.hgetall(`stream:${streamId}:meta`)
        if (Object.keys(meta).length === 0) return null
        return {
            ip: meta.ip!,
            streamId,
            userId: Number(meta.user!.slice(meta.user!.indexOf(':') + 1)),
            streamTokenId: Number(meta.streamTokenId!),
            mediaServerId: meta.mediaServer!.slice(meta.mediaServer!.indexOf(':') + 1),
            name: meta.name ?? null,
            color: meta.color ?? null,
            password: meta.password ?? null
        }
    }

    public async getStreamMetas(mediaServerId?: string) {
        let streams: string[]
        if (mediaServerId !== undefined) {
            streams = await this.client.smembers(`mediaServer:${mediaServerId}:streams`)
        } else {
            streams = (await this.client.keys('stream:*:meta')).map(key => key.slice(0, key.lastIndexOf(':')))
        }
        return Promise.all(streams.map(async stream => {
            const data = await this.client.hgetall(`${stream}:meta`)
            const viewers = await this.client.smembers(`${stream}:viewers`)
            return {
                media_server_id: data.mediaServer?.slice(data.mediaServer.indexOf(':') + 1),
                stream_id: stream.slice(stream.indexOf(':') + 1),
                user_id: Number(data.user?.slice(data.user.indexOf(':') + 1)),
                viewers: viewers.map(key => key.slice(key.indexOf(':') + 1)),
                name: data.name,
                color: data.color,
                password_protected: data.password !== undefined ? true : false
            }
        }))
    }

    public async setMediaServer(config: WebhookMessage.OnServerStarted, ip: string) {
        const id = config["general.mediaServerId"]
        await this.client.pipeline()
            .hset(`mediaServer:${id}`,
                'config',   JSON.stringify(config),
                'ip',       ip
            )
            .expire(`mediaServer:${id}`, 120)
            .exec()
    }

    public async mediaServerKeepAlive(serverStats: WebhookMessage.OnServerKeepalive, ip: string) {
        const pipeline = this.client.pipeline()

        pipeline
            .set(`mediaServer:${serverStats.mediaServerId}:stats`, JSON.stringify(serverStats.data))
            .hset(`mediaServer:${serverStats.mediaServerId}`, 'ip', ip)
            .expire(`mediaServer:${serverStats.mediaServerId}:stats`, 120)
            .expire(`mediaServer:${serverStats.mediaServerId}`, 120)
            .expire(`mediaServer:${serverStats.mediaServerId}:streams`, 120)

        const streams = await this.client.smembers(`mediaServer:${serverStats.mediaServerId}:streams`)

        await Promise.all(streams.map(async stream => {
            const user = await this.client.hget(stream, 'user')
            if (user !== null) {
                pipeline
                    .zremrangebyscore(`${user}:streams`, '-inf', `(${Date.now() - 1000 * 120}`)
                    .zadd(`${user}:streams`, Date.now(), stream)
            }
            pipeline
                .expire(`${stream}:meta`, 120)
                .expire(`${stream}:schemas`, 120)
                
            const schemas = await this.client.smembers(`${stream}:schemas`)
            schemas.forEach(schema => pipeline.expire(schema, 120))
        }))

        await pipeline.exec()
    }

    public async getMediaServer(mediaServerId: string) {
        const server = await this.client.hgetall(`mediaServer:${mediaServerId}`)
        if (Object.keys(server).length === 0) return null
        const stats = await this.client.get(`mediaServer:${mediaServerId}:stats`)
        const streams = await this.client.smembers(`mediaServer:${mediaServerId}:streams`)
        return {
            ip: server.ip!,
            config: JSON.parse(server.config!) as WebhookMessage.OnServerStarted,
            stats,
            streams
        }
    }

    public async getMediaServers() {
        const mediaServers = (await this.client.keys('mediaServer:*')).filter(key => !key.slice('mediaServer:'.length).includes(':'))
        return Promise.all(mediaServers.map(async key => {
            const stats = await this.client.get(`${key}:stats`)
            const streams = await this.client.smembers(`${key}:streams`)
            return {
                media_server_id: key.slice(key.indexOf(':') + 1),
                stats,
                streams: streams.map(key => key.slice(key.indexOf(':') + 1))
            }
        }))
    }

    public async setSessionMeta(userId: number, sessionId: string, refreshTokenId?: number) {
        const multi = this.client.multi()
        multi
            .hset(`session:${sessionId}:meta`, 'user', `user:${userId}`)
            .sadd(`user:${userId}:sessions`, `session:${sessionId}`)
            .expire(`session:${sessionId}:meta`, SESSION_MAX_AGE / 1000)
            .expire(`user:${userId}:sessions`, SESSION_MAX_AGE / 1000)

        if (refreshTokenId !== undefined) {
            multi
                .set(`refreshToken:${refreshTokenId}:user`, `user:${userId}`)
                .hset(`session:${sessionId}:meta`, 'refreshToken', `refreshToken:${refreshTokenId}`)
                .sadd(`refreshToken:${refreshTokenId}:sessions`, `session:${sessionId}`)
                .expire(`refreshToken:${refreshTokenId}:user`, SESSION_MAX_AGE / 1000)
                .expire(`refreshToken:${refreshTokenId}:sessions`, SESSION_MAX_AGE / 1000)
        }
        await multi.exec()
    }

    public async delSessionMeta(sessionId: string) {
        const meta = await this.client.hgetall(`session:${sessionId}:meta`)
        if (!meta || Object.keys(meta).length === 0) return

        const multi = this.client.multi()
        multi.del(`session:${sessionId}:meta`)

        if (meta.user) {
            multi.srem(`${meta.user}:sessions`, `session:${sessionId}`)
        }
        if (meta.refreshToken) {
            multi.srem(`${meta.refreshToken}:sessions`, `session:${sessionId}`)
        }

        await multi.exec()
    }

    public async delSessionsFromUser(userId: number) {
        const sessions = await this.client.smembers(`user:${userId}:sessions`)
        if (sessions.length === 0) return

        const pipeline = this.client.pipeline()
        const refreshTokenBySession = new Map<string, string>()
        sessions.forEach(session => pipeline.hget(`${session}:meta`, 'refreshToken'))
        await pipeline.exec().then(result => result?.forEach((item, index) => {
            if (!item || item[0]) return
            refreshTokenBySession.set(sessions[index]!, item[1] as string)
        }))

        const multi = this.client.multi()
        sessions.forEach(session => {
            multi
                .del(session)
                .del(`${session}:meta`)
                .srem(`user:${userId}:sessions`, session)

            const refreshToken = refreshTokenBySession.get(session)
            if (refreshToken !== undefined) {
                multi.srem(`${refreshToken}:sessions`, session)
            }
        })
        multi.del(`user:${userId}:sessions`)

        await multi.exec()
    }

    public async delSessionsFromRefreshToken(refreshTokenId: number) {
        const sessions = await this.client.smembers(`refreshToken:${refreshTokenId}:sessions`)
        const user = await this.client.get(`refreshToken:${refreshTokenId}:user`)!
        const multi = this.client.multi()
        sessions.forEach(session => {
            multi
                .del(session)
                .del(`${session}:meta`)
                .srem(`${user}:sessions`, session)
        })
        multi.del(`refreshToken:${refreshTokenId}:user`)
        multi.del(`refreshToken:${refreshTokenId}:sessions`)
        await multi.exec()
    }

    public async setViewer(streamId: string, userId: number, sessionId: string) {
        this.client.hset(`session:${sessionId}:meta`, 'playing', `stream:${streamId}`)
        this.client.sadd(`stream:${streamId}:viewers`, `user:${userId}`)
        const viewers = await this.client.smembers(`stream:${streamId}:viewers`)
        this.eventBus.emit('api.sse.stream_viewer_changed', {
            stream_id: streamId,
            viewers: viewers.map(key => Number(key.slice(key.indexOf(':') + 1)))
        })
    }

    public async delViewer(userId: number, sessionId: string) {
        this.client.hdel(`session:${sessionId}:meta`, 'playing')
        const stream = await this.client.hget(`session:${sessionId}:meta`, 'playing')
        if (stream === null) return
        this.client.srem(`${stream}:viewers`, `user:${userId}`)
        const viewers = await this.client.smembers(`${stream}:viewers`)
        this.eventBus.emit('api.sse.stream_viewer_changed', {
            stream_id: stream.slice(stream.indexOf(':') + 1),
            viewers: viewers.map(key => Number(key.slice(key.indexOf(':') + 1)))
        })
    }

    public async getUsers() {
        const now = Date.now()
        const userKeys = (await this.client.keys('user:*:sessions'))
            .map(key => key.slice(0, key.lastIndexOf(':')))
        return Promise.all(userKeys.map(async user => {
            await this.client.zremrangebyscore(`${user}:streams`, '-inf', `(${now - 1000 * 120}`)
            const streams = await this.client.zrange(`${user}:streams`, 0, -1)
            const sessions = await this.client.smembers(`${user}:sessions`)
            const playings = (await Promise.all(
                sessions.map(session => this.client.hget(`${session}:meta`, 'playing'))
            )).filter((playing): playing is string => playing !== null)
            return {
                user_id: user.slice(user.indexOf(':') + 1),
                streams: streams.map(stream => stream.slice(stream.indexOf(':') + 1)),
                playings
            }
        }))
    }
}
