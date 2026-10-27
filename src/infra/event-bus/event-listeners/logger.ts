import { type AppLogger } from "../../logger"
import type { AppEvents } from "../events"
import { LogLevel } from "../../logger"
import type { EventBus } from ".."

export function setupLoggerEventListeners(eventBus: EventBus<AppEvents>, logger: AppLogger) {
    eventBus.on('api.webhook.server_started', (header, payload) => {
        logger.log({
            timestamp: header.timestamp,
            level: LogLevel.Info,
            prefix: "Webhook",
            content: `服务器上线：'${payload.body["general.mediaServerId"]}' 远程地址为 ${payload.remoteAddress} (${String(header.eventId)})`,
            additionalContent: JSON.stringify(payload, null, ' ')
        })
    })

    eventBus.on('api.webhook.play', (header, payload) => {
        logger.log({
            timestamp: header.timestamp,
            level: LogLevel.Info,
            prefix: "Webhook",
            content: `客户端拉流请求：来自 ${payload.body.ip} 于媒体服务器 ${payload.body.mediaServerId} (${String(header.eventId)})`,
            additionalContent: JSON.stringify(payload, null, ' ')
        })
    })
    
    eventBus.on('api.webhook.stream_registered', (header, payload) => {
        logger.log({
            timestamp: header.timestamp,
            level: LogLevel.Info,
            prefix: "Webhook",
            content: `直播流注册：'${payload.body.stream}' (${payload.body.schema}) 于媒体服务器 ${payload.body.mediaServerId} (${String(header.eventId)})`,
            additionalContent: JSON.stringify(payload, null, ' ')
        })
    })

    eventBus.on('api.webhook.stream_deregistered', (header, payload) => {
        logger.log({
            timestamp: header.timestamp,
            level: LogLevel.Info,
            prefix: "Webhook",
            content: `直播流注销：'${payload.body.stream}' (${payload.body.schema}) 于媒体服务器 '${payload.body.mediaServerId}' (${String(header.eventId)})`,
            additionalContent: JSON.stringify(payload, null, ' ')
        })
    })
}
