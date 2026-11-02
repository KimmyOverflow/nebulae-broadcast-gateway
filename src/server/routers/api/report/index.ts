import { json, Router } from "express";
import { requireLogin } from "../../../middlewares/auth";
import { object, safeParse, string } from "zod";
import type { AppDatabaseRedis } from "../../../../database/redis";

const PlayStartSchema = object({
    stream_id: string(),
})

export function createReportRouter(databaseRedis: AppDatabaseRedis) {
    const router = Router()

    router.post('/api/report/play_start', requireLogin(), json(), (req, res) => {
        const result = safeParse(PlayStartSchema, req.body)
        if (result.error) {
            res.status(400).send({ error: '参数错误' })
            return
        }

        databaseRedis.setViewer(result.data.stream_id, req.session.userId!, req.sessionID)
        res.status(200).end()
    })

    router.post('/api/report/play_stop', requireLogin(), (req, res) => {
        databaseRedis.delViewer(req.session.userId!, req.sessionID)
        res.status(200).end()
    })

    return router
}
