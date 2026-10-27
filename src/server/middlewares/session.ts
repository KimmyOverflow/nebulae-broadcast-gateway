import { DEVELOPMENT_MODE, SESSION_MAX_AGE } from "../../consts";
import { RedisStore } from "connect-redis";
import session from "express-session";
import type { AppDatabaseRedis } from "../../database/redis";
import type { RequestHandler } from "express";

export const appSession = ( databaseRedis: AppDatabaseRedis, secret: string ): RequestHandler => {
    const expressSession = session({
        store: new RedisStore({ client: databaseRedis.client, prefix: 'session:' }),
        secret,
        resave: false,
        saveUninitialized: false,
        // 滚动续期：会话数据未修改时 express-session 默认不会重新下发 Set-Cookie
        // （其 hash 检测忽略 cookie 字段），导致浏览器 cookie 到期后即使 Redis 会话仍在也会失效。
        // rolling: true 会在每次响应时 touch 会话并重发 cookie，使 Max-Age 重置为 now + maxAge。
        rolling: true,
        name: 'session_id',
        cookie: {
            httpOnly: DEVELOPMENT_MODE ? false : true,
            secure: DEVELOPMENT_MODE ? false : true,
            sameSite: 'strict',
            maxAge: SESSION_MAX_AGE,
        }
    })
    return (req, res, next) => {
        expressSession(req, res, (err) => {
            if (err) return next(err)
            if (req.session.isLoggedIn === true) {
                databaseRedis.setSessionMeta(req.session.userId!, req.sessionID, req.session.refreshTokenId)
                    .then(next)
                    .catch(next)
            } else {
                next()
            }
        })
    }
}
