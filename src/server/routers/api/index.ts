import { Router } from "express";

import { createAuthenticationRouter } from "./auth";
import { createEventRouter } from "./event";
import { createReportRouter } from "./report";
import { createStatRouter } from "./stat";
import { createUserRouter } from "./user";

import type { AppDatabaseSql } from "../../../database/sql";
import type { AppDatabaseRedis } from "../../../database/redis";
import type { AppCrypto } from "../../../infra/crypto";
import type { EventBus } from "../../../infra/event-bus";
import type { AppEvents } from "../../../infra/event-bus/events";

export function createApiRouter(
    databaseSql: AppDatabaseSql,
    databaseRedis: AppDatabaseRedis,
    crypto: AppCrypto,
    eventBus: EventBus<AppEvents>
) {
    const router = Router()

    router.use(createAuthenticationRouter(databaseSql, databaseRedis, crypto))
    router.use(createEventRouter(eventBus))
    router.use(createReportRouter(databaseRedis))
    router.use(createStatRouter(databaseSql, databaseRedis))
    router.use(createUserRouter(databaseSql, databaseRedis, crypto))

    return router
}
