import { Router } from "express";

import { createApiRouter } from "./api";
import { createProxyRouter } from "./proxy";
import { createWebhookRouter } from "./webhook";

import type { AppDatabaseSql } from "../../database/sql";
import type { AppDatabaseRedis } from "../../database/redis";
import type { AppCrypto } from "../../infra/crypto";
import type { AppEvents } from "../../infra/event-bus/events";
import type { AppLogger } from "../../infra/logger";
import type { EventBus } from "../../infra/event-bus";

export function createAppRouter(
    databaseSql: AppDatabaseSql,
    databaseRedis: AppDatabaseRedis,
    crypto: AppCrypto,
    logger: AppLogger,
    eventBus: EventBus<AppEvents>
) {
    const router = Router()

    router.use(createApiRouter(databaseSql, databaseRedis, crypto, eventBus))
    router.use(createProxyRouter(databaseSql, databaseRedis, crypto, logger))
    router.use(createWebhookRouter(databaseSql, databaseRedis, crypto, eventBus))
    
    return router
}
