import type { FastifyInstance, FastifyError } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError, ErrorCode, type ApiErrorBody } from "@zuno/core";

/** One error shape for every route. Never leaks stack traces, SQL, or provider internals. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    const requestId = req.id;
    let status = 500;
    let body: ApiErrorBody = { error: { code: ErrorCode.Internal, message: "Something went wrong", requestId } };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, requestId } };
      const level = status >= 500 ? "error" : "info";
      req.log[level]({ code: err.code, cause: err.cause_ instanceof Error ? err.cause_.message : undefined }, err.message);
    } else if (hasZodFastifySchemaValidationErrors(err)) {
      status = 400;
      const detail = err.validation.map((v) => `${v.instancePath || "/"} ${v.message}`).join("; ");
      body = { error: { code: ErrorCode.BadRequest, message: `Invalid request: ${detail}`, requestId } };
    } else if (err.statusCode === 429) {
      status = 429;
      body = { error: { code: ErrorCode.RateLimited, message: "Too many requests, slow down", requestId } };
    } else if (err.statusCode && err.statusCode < 500) {
      status = err.statusCode;
      body = { error: { code: status === 404 ? ErrorCode.NotFound : ErrorCode.BadRequest, message: err.message, requestId } };
    } else {
      req.log.error({ err }, "unhandled error");
    }
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: { code: ErrorCode.NotFound, message: "Route not found", requestId: req.id } } satisfies ApiErrorBody);
  });
}
