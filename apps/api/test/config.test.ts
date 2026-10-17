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
