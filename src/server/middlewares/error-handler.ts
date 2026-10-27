import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { DatabaseError } from "../../database/sql";

export const errorHandler: ErrorRequestHandler = (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    if (res.headersSent) {
        return
    }

    let statusCode = 500
    let errorMessage = '预期外的服务器内部错误'

    if (err instanceof DatabaseError) {
        errorMessage = '数据库错误'
    }

    res.status(statusCode).send({ error: errorMessage })
    console.log(err)

    // TODO: Log all errors here.
}
