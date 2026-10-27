import { Router } from "express";
import { requireLogin } from "../../middlewares/auth";
import type { EventBus, EventHandler, EventHeader } from "../../../infra/event-bus";
import type { AppEvents } from "../../../infra/event-bus/events";

export function createEventRouter(eventBus: EventBus<AppEvents>) {
    const router = Router()
    
    router.get('/api/event/live', requireLogin(), (req, res) => {
        res
            .setHeader('Content-Type', 'text/event-stream')
            .setHeader('Cache-Control', 'no-cache')
            .setHeader('Connection', 'keep-alive')
            .setHeader('X-Accel-Buffering', 'no')
            .flushHeaders()

        const heartbeat = setInterval(() => {
            if(!res.writableEnded) {
                res.write(': ping\n\n')
            }
        }, 15000)

        const write = (header: EventHeader, payload: any) => {
            res.write(
                `data: ${JSON.stringify({
                    event: header.eventId,
                    timestamp: header.timestamp,
                    payload
                })}\n\n`
            )
        }

        const listeners = [
            eventBus.on('api.sse.stream_published', write),
            eventBus.on('api.sse.stream_ended', write),
            eventBus.on('api.sse.stream_viewer_changed', write),
            eventBus.on('api.webhook.server_started', write)
        ]

        req.on('close', () => {
            clearInterval(heartbeat)
            listeners.forEach(listener => listener.remove())
        })
    })

    return router
}
