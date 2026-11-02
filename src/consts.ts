export const DEVELOPMENT_MODE = true

export const WEBSOCKET_BONJOUR_TIMEOUT = 10000 // 10 秒

export const WEBSOCKET_KEEPALIVE_TIMEOUT = 10000 // 10 秒

export const SERVER_RECORD_KEEPALIVE_TIMEOUT = 60000 // 60 秒

export const LISTENING_PORT = 1225

export const SALT_ROUNDS = 10

export const SQLITE_DATABASE_PATH = './prod.db'

export const LOG_PATH = './logs'

export const MASTER_KEY_PATH = './key.enc'

export const LOGIN_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 天

export const SESSION_MAX_AGE = 30 * 60 * 1000 // 30 分钟

export const TOTP_TOKEN_VALIDATION_TIME_WINDOW = 1

/**
 * 待完成注册的账号保留时长.
 * 同时用于注册令牌有效期与死账号清理阈值：两者必须一致，
 * 否则令牌过期后用户名仍被占用，用户会在自己的号上收到"已被占用".
 */
export const REGISTRATION_PENDING_TIMEOUT = 10 * 60 * 1000 // 10 分钟

/** 死账号清理任务的执行间隔. */
export const REGISTRATION_CLEANUP_INTERVAL = 60 * 1000 // 1 分钟

export const PROFILE_PIC_MAX_SIZE = 1024 * 1024 // 1 MiB
