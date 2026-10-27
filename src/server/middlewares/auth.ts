import type { RequestHandler } from "express";

export interface RequireLoginOptions {
    /** 是否要求当前用户角色为 admin，非 admin 时返回 403. */
    requireAdmin?: boolean
}

/**
 * 登录校验中间件工厂.
 * - 未登录：返回 401
 * - requireAdmin 为 true 且当前用户角色不是 admin：返回 403
 */
export function requireLogin(options: RequireLoginOptions = {}): RequestHandler {
    return (req, res, next) => {
        if (!req.session.isLoggedIn) {
            res.status(401).send({ error: '未登录' })
            return
        }
        if (options.requireAdmin === true && req.session.role !== 'admin') {
            res.status(403).send({ error: '权限不足' })
            return
        }
        next()
    }
}
