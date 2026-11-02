import { LISTENING_PORT, REGISTRATION_CLEANUP_INTERVAL, REGISTRATION_PENDING_TIMEOUT } from "./consts";
import e, { urlencoded, type Application } from "express";
import nocache from "nocache";
import cookieParser from "cookie-parser";
import { EventBus } from "./infra/event-bus";
import type { AppEvents } from "./infra/event-bus/events";
import { AppLogger } from "./infra/logger";
import { AppDatabaseSql } from "./database/sql";
import { setupLoggerEventListeners } from "./infra/event-bus/event-listeners/logger";
import { AppCrypto } from "./infra/crypto";
import { createAppRouter } from "./server/routers";
import { errorHandler } from "./server/middlewares/error-handler";
import { AppDatabaseRedis } from "./database/redis";
import { appSession } from "./server/middlewares/session";
// import { prepareTestAccount } from "./database/sql/test_account";


const eventBus = new EventBus<AppEvents>()
const logger = new AppLogger({ verbose: false })
const crypto = new AppCrypto()
const databaseSql = new AppDatabaseSql()
const databaseRedis = new AppDatabaseRedis(eventBus)

setupLoggerEventListeners(eventBus, logger)

const app: Application = e()
    .set('etag', false)
    // .use((_req, _res, next) => {
    //     setTimeout(next, 500, 'route')
    // })
    .use(nocache())
    .use(urlencoded())
    .use(cookieParser(crypto.masterKey))
    .use(appSession(databaseRedis, crypto.masterKey))
    .use(createAppRouter(databaseSql, databaseRedis, crypto, logger, eventBus))
    .use(errorHandler)

app.listen(LISTENING_PORT, () => {
    console.log(`Server listening on port ${LISTENING_PORT}.`)
})

// 定期清理没有完成 TOTP 设置的待注册账号，避免用户名被永久占用.
const registrationCleanup = setInterval(() => {
    try {
        const { changes } = databaseSql.removeAbandonedRegistrations(
            new Date(Date.now() - REGISTRATION_PENDING_TIMEOUT).toISOString()
        )
        if (changes > 0) {
            console.log(`已清理 ${changes} 个未完成注册的账号.`)
        }
    } catch (err) {
        console.error('清理未完成注册的账号失败:', err)
    }
}, REGISTRATION_CLEANUP_INTERVAL)
registrationCleanup.unref()

// prepareTestAccount(databaseSql, crypto)
