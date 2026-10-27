import type { WebhookMessage } from "../../server/routers/webhook/types"

export type AppEvents = {
    'api.webhook.server_started': {
        remoteAddress: string | null,
        body: WebhookMessage.OnServerStarted
    }
    'api.webhook.stream_registered': {
        body: WebhookMessage.OnStreamChanged.Registered
    }
    'api.webhook.stream_deregistered': {
        body: WebhookMessage.OnStreamChanged.Deregistered
    }
    'api.webhook.server_keepalive': {
        body:WebhookMessage.OnServerKeepalive
    }
    'api.webhook.play': {
        body: WebhookMessage.OnPlay
    }
    'api.webhook.flow_report': {
        body: WebhookMessage.OnFlowReport
    }
    'api.sse.stream_published': {
        user_id: number,
        stream_id: string,
        media_server_id: string,
        name?: string,
        color?: string,
        password_protected: boolean
    }
    'api.sse.stream_ended': {
        stream_id: string
    }
    'api.sse.stream_viewer_changed': {
        stream_id: string,
        viewers: number[]
    }
}
