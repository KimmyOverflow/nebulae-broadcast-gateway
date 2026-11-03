import { boolean, object, string } from "zod";

export const TotpTokenSchema = string().regex(/^\d{6}$/)

/**
 * 用户名会被拼进 otpauth 的 label，因此禁止空白与 URL 保留字符；
 * 其余字符（含中文）允许。大小写敏感，与数据库 UNIQUE 的比较规则一致.
 */
export const UsernameSchema = string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[^\s:/?&#%+=\u0000-\u001F\u007F]+$/)

export const LoginSchema = object({
    username: string(),
    totp_token: string(),
    remember_me: boolean()
})

export const RecoverSchema = object({
    username: string(),
    recovery_passphrase: string()
})

/** 注册第一步：抢占用户名，此时还不存在 TOTP 密钥. */
export const StartRegistrationSchema = object({
    username: UsernameSchema,
    recovery_passphrase: string()
})

/** 注册第二步：凭签名令牌补交 TOTP 密钥. */
export const FinishRegistrationSchema = object({
    registration_token: string(),
    totp_secret: string(),
    totp_token: TotpTokenSchema
})

export const ResetSchema = object({
    username: string(),
    recovery_passphrase: string(),
    totp_secret: string(),
    totp_token: TotpTokenSchema
})
