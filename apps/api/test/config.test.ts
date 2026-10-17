import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const base = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
  REDIS_URL: "redis://127.0.0.1:6379",
  STREAM_SIGNING_SECRET: "x".repeat(32),
};

describe("config: TRUST_PROXY", () => {
  it("is off when unset or empty", () => {
    expect(loadConfig({ ...base }).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "" }).TRUST_PROXY).toBe(false);
  });

  it('"false", "0", "no" and "off" mean off (any case, surrounding spaces ignored)', () => {
    for (const v of ["false", "FALSE", " False ", "0", "no", "off"]) {
      expect(loadConfig({ ...base, TRUST_PROXY: v }).TRUST_PROXY, v).toBe(false);
    }
  });

  it('"true", "1", "yes" and "on" mean on', () => {
    for (const v of ["true", "True", "1", "yes", "on"]) {
      expect(loadConfig({ ...base, TRUST_PROXY: v }).TRUST_PROXY, v).toBe(true);
    }
  });

  it("anything else is a configuration error, not a guess", () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: "maybe" })).toThrow(/TRUST_PROXY/);
  });
});

describe("config: DB_DRIVER", () => {
  const noDb = { REDIS_URL: base.REDIS_URL, STREAM_SIGNING_SECRET: base.STREAM_SIGNING_SECRET };

  it("defaults to postgres, which needs DATABASE_URL", () => {
    expect(loadConfig({ ...base }).DB_DRIVER).toBe("postgres");
    expect(() => loadConfig({ ...noDb })).toThrow(/DATABASE_URL is required/);
    expect(() => loadConfig({ ...noDb, DATABASE_URL: "" })).toThrow(/DATABASE_URL is required/);
  });

  it("memory needs no DATABASE_URL and always runs the worker inside the API", () => {
    const c = loadConfig({ ...noDb, DB_DRIVER: "memory", WORKER_INLINE: "false" });
    expect(c.DB_DRIVER).toBe("memory");
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.WORKER_INLINE).toBe(true);
    expect(c.MEMORY_DB_DIR).toBeUndefined();
    expect(loadConfig({ ...noDb, DB_DRIVER: "memory", MEMORY_DB_DIR: "/data/neo" }).MEMORY_DB_DIR).toBe("/data/neo");
  });

  it("rejects an unknown driver", () => {
    expect(() => loadConfig({ ...base, DB_DRIVER: "sqlite" })).toThrow(/DB_DRIVER/);
  });
});
