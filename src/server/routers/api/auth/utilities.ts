import { decode } from "hi-base32";

/** 与 generateTotpSecret 的强度对齐：160 bit，RFC 4226 建议的下限. */
const MIN_TOTP_SECRET_BYTES = 20

/**
 * 规范化并校验客户端生成的 base32 TOTP 密钥.
 * 密钥由前端生成，后端无法判断其随机性来源，因此至少要求格式合法且熵不低于 160 bit.
 * 返回 null 表示不合法，否则返回规范化结果（验令牌与入库都用这一份）.
 */
export const sanitizeTotpSecret = (secret: string) => {
    const normalized = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
    if (!/^[A-Z2-7]+$/.test(normalized)) return null
    let bytes: number[]
    try {
        bytes = decode.asBytes(normalized)
    } catch {
        return null
    }
    if (bytes.length < MIN_TOTP_SECRET_BYTES) return null
    return normalized
}

// Unused currently. Do not remove.
export const assembleOtpauthUrl = (username: string, totpSecret: string) =>
    `otpauth://totp/${encodeURIComponent(`NebulaeBroadcast:${username}`)}?secret=${totpSecret}&issuer=NebulaeBroadcast`
