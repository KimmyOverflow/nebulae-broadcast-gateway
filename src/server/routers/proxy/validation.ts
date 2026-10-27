import * as ipaddr from "ipaddr.js"

// 媒体服务器请求目标（request target）的校验与构造。
// webhook 写入的地址、端口与配置均视为不可信输入，这里把出站目标收敛为
// 「登记时记录的 IP + 1~65535 的整数端口」，避免端口拼接改写目标主机（SSRF）。

// 上游媒体服务器 HTTP 协议。切换到 TLS 时只需修改这一处。
const MEDIA_SERVER_PROTOCOL = "http:"

// 上游请求超时，避免被利用来长时间占用连接或扫描内网端口。
export const MEDIA_SERVER_REQUEST_TIMEOUT_MS = 15_000

export type MediaServerTarget = {
    address: string
    port: number
}

/**
 * 校验媒体服务器地址与端口。
 * 端口只接受纯数字的 1~65535 整数，`80@evil.tld`、`8080/admin` 之类的值一律拒绝。
 */
export function parseMediaServerTarget(rawAddress: unknown, rawPort: unknown): MediaServerTarget | null {
    if (typeof rawAddress !== "string") return null

    let address: string
    try {
        address = ipaddr.process(rawAddress).toString()
    } catch {
        return null
    }

    let port: number
    if (typeof rawPort === "number") {
        port = rawPort
    } else if (typeof rawPort === "string" && /^[0-9]+$/.test(rawPort)) {
        port = Number(rawPort)
    } else {
        return null
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) return null

    return { address, port }
}

/** 解析 webhook 落库的媒体服务器配置。配置内容不可信，解析失败时按空配置处理。 */
export function parseMediaServerConfig(raw: string | null): Record<string, unknown> {
    if (raw === null) return {}
    try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        return parsed as Record<string, unknown>
    } catch {
        return {}
    }
}

/**
 * 用已校验的地址与端口构造上游 URL。
 * 主机来自规范化后的 IP、端口是整数、pathname 为固定常量，查询参数必须由调用方通过
 * searchParams 设置，因此无法靠参数值改写目标主机或路径。
 */
export function buildMediaServerUrl(endpoint: MediaServerTarget, pathname: string): URL {
    const host = endpoint.address.includes(":") ? `[${endpoint.address}]` : endpoint.address
    return new URL(`${MEDIA_SERVER_PROTOCOL}//${host}:${endpoint.port}${pathname}`)
}
