/**
 * OpenTelemetry (opt-in). Loaded with `node --import ./dist/telemetry.js` so instrumentation
 * patches http/fastify/pg/ioredis before they're imported. Does nothing unless
 * OTEL_EXPORTER_OTLP_ENDPOINT is set — no data leaves the server by default.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "zuno-api", [ATTR_SERVICE_VERSION]: "1.0.0" }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 30_000 }),
    instrumentations: [getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      // Never record query strings (stream signatures, search text) as span attributes.
      "@opentelemetry/instrumentation-http": { ignoreIncomingRequestHook: (req) => req.url === "/healthz" || req.url === "/readyz" },
    })],
  });
  sdk.start();
  process.once("SIGTERM", () => void sdk.shutdown());
}
