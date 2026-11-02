import { Router } from "express";
import { requireLogin } from "../../../middlewares/auth";
import type { AppDatabaseSql } from "../../../../database/sql";
import type { AppDatabaseRedis } from "../../../../database/redis";

export function createStatRouter(databaseSql: AppDatabaseSql, databaseRedis: AppDatabaseRedis) {
    const router = Router()

    router.get('/api/stat/servers', requireLogin(), async (req, res) => {
        const servers = await databaseRedis.getMediaServers()
        res.status(200).send({ servers })
    })

    router.get('/api/stat/streams', requireLogin(), async (req, res) => {
        const mediaServerId = req.query.mediaServerId as string | undefined
        const streams = await databaseRedis.getStreamMetas(mediaServerId)
        res.status(200).send({ streams })
    })

    router.get('/api/stat/users', requireLogin(), async (req, res) => {
        const users = await databaseRedis.getUsers()
        res.status(200).send({ users })
    })

    return router
}
