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

describe("config: REDIS_URL", () => {
  it("is optional (empty means none)", () => {
    const { REDIS_URL: _r, ...noRedis } = base;
    expect(loadConfig({ ...noRedis }).REDIS_URL).toBeUndefined();
    expect(loadConfig({ ...noRedis, REDIS_URL: "" }).REDIS_URL).toBeUndefined();
    expect(loadConfig({ ...base }).REDIS_URL).toBe(base.REDIS_URL);
  });
});

describe("config: music sources", () => {
  it("defaults to youtubei.js only", () => {
    const c = loadConfig({ ...base });
    expect(c.MUSIC_SOURCES).toEqual(["youtubei"]);
    expect(c.DEFAULT_MUSIC_SOURCE).toBe("youtubei");
  });
  it("parses a list, rejects unknown names and a default that isn't enabled", () => {
    expect(loadConfig({ ...base, MUSIC_SOURCES: "youtubei, ytmusicapi" }).MUSIC_SOURCES).toEqual(["youtubei", "ytmusicapi"]);
    expect(() => loadConfig({ ...base, MUSIC_SOURCES: "youtubei,spotify" })).toThrow(/MUSIC_SOURCES/);
    expect(() => loadConfig({ ...base, MUSIC_SOURCES: "youtubei", DEFAULT_MUSIC_SOURCE: "ytmusicapi" })).toThrow(/DEFAULT_MUSIC_SOURCE/);
  });
  it("the official source needs an API key (kept server-side)", () => {
    expect(() => loadConfig({ ...base, MUSIC_SOURCES: "youtubei,official" })).toThrow(/YOUTUBE_API_KEY/);
    expect(loadConfig({ ...base, MUSIC_SOURCES: "youtubei,official", YOUTUBE_API_KEY: "x".repeat(39) }).YOUTUBE_API_KEY).toHaveLength(39);
  });
});
