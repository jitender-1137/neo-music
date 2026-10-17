/**
 * Postgres schema. Catalog metadata itself lives with the provider; we store only what the
 * product owns (accounts, library, playlists, listening signals) plus a metadata snapshot per
 * referenced item so library pages render without a provider round-trip.
 */
import { sql } from "drizzle-orm";
import {
  bigserial, boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text,
  timestamp, uniqueIndex, uuid, check,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();

// ---------- identity ----------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
  check("users_email_len", sql`char_length(${t.email}) between 3 and 320`),
  check("users_display_name_len", sql`char_length(${t.displayName}) between 1 and 80`),
]);

export const audioQualityEnum = pgEnum("audio_quality", ["auto", "low", "normal", "high"]);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  audioQuality: audioQualityEnum("audio_quality").notNull().default("auto"),
  hideExplicit: boolean("hide_explicit").notNull().default(false),
  /** Onboarding picks, used for cold-start recommendations. */
  seedArtists: jsonb("seed_artists").$type<{ id: string; name: string }[]>().notNull().default([]),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Opaque session tokens; only the SHA-256 of the token is stored. */
export const userSessions = pgTable("user_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: created(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  userAgent: text("user_agent"),
}, (t) => [index("user_sessions_user_idx").on(t.userId), index("user_sessions_expires_idx").on(t.expiresAt)]);

// ---------- catalog snapshots ----------
export const catalogKindEnum = pgEnum("catalog_kind", ["track", "album", "artist", "playlist"]);

export const catalogItems = pgTable("catalog_items", {
  provider: text("provider").notNull(),
  kind: catalogKindEnum("kind").notNull(),
  itemId: text("item_id").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.provider, t.kind, t.itemId] })]);

// ---------- library ----------
const libraryTable = (name: string, idCol: string) =>
  pgTable(name, {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    itemId: text(idCol).notNull(),
    createdAt: created(),
  }, (t) => [primaryKey({ columns: [t.userId, t.provider, t.itemId] }), index(`${name}_recent_idx`).on(t.userId, t.createdAt)]);

export const userLikes = libraryTable("user_likes", "track_id");
export const userSavedAlbums = libraryTable("user_saved_albums", "album_id");
export const userFollowedArtists = libraryTable("user_followed_artists", "artist_id");
export const userSavedPlaylists = libraryTable("user_saved_playlists", "playlist_id");

export const visibilityEnum = pgEnum("playlist_visibility", ["private", "unlisted", "public"]);

export const playlists = pgTable("playlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  visibility: visibilityEnum("visibility").notNull().default("private"),
  /** Bumped on every mutation; clients send it back for optimistic concurrency on reorder. */
  version: integer("version").notNull().default(1),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  index("playlists_owner_idx").on(t.ownerId, t.updatedAt),
  check("playlists_title_len", sql`char_length(${t.title}) between 1 and 150`),
  check("playlists_desc_len", sql`char_length(${t.description}) <= 5000`),
]);

export const playlistTracks = pgTable("playlist_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  playlistId: uuid("playlist_id").notNull().references(() => playlists.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  trackId: text("track_id").notNull(),
  position: integer("position").notNull(),
  addedAt: created(),
}, (t) => [
  // (playlist_id, position) uniqueness is a DEFERRABLE constraint added in migration 0001 —
  // reorders shift many rows at once and must only be checked at commit.
  index("playlist_tracks_track_idx").on(t.playlistId, t.provider, t.trackId),
  check("playlist_tracks_position_nonneg", sql`${t.position} >= 0`),
]);

export const searchHistory = pgTable("search_history", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  searchedAt: ts("searched_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.query] }), index("search_history_recent_idx").on(t.userId, t.searchedAt)]);

// ---------- listening signals ----------
export const eventTypeEnum = pgEnum("listening_event_type", [
  "impression", "start", "qualified", "complete", "skip", "like", "unlike", "playlist_add",
  "playlist_remove", "queue_add", "search", "follow", "unfollow", "album_save", "not_interested",
  "rec_select",
]);

export const listeningEvents = pgTable("listening_events", {
  /** Client-generated UUID: the idempotency key for ingestion. */
  eventId: uuid("event_id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: eventTypeEnum("type").notNull(),
  provider: text("provider").notNull(),
  trackId: text("track_id"),
  artistIds: jsonb("artist_ids").$type<string[]>().notNull().default([]),
  msPlayed: integer("ms_played"),
  durationMs: integer("duration_ms"),
  /** Where the play came from: album, playlist, radio, search, home shelf… */
  context: jsonb("context").$type<Record<string, string>>().notNull().default({}),
  occurredAt: ts("occurred_at").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  schemaVersion: integer("schema_version").notNull().default(1),
}, (t) => [
  index("listening_events_user_time_idx").on(t.userId, t.occurredAt),
  index("listening_events_track_idx").on(t.provider, t.trackId, t.occurredAt),
]);

/** User-visible history (one row per started play). */
export const listeningHistory = pgTable("listening_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  trackId: text("track_id").notNull(),
  eventId: uuid("event_id").notNull(),
  playedAt: ts("played_at").notNull(),
}, (t) => [uniqueIndex("listening_history_event_uq").on(t.eventId), index("listening_history_user_idx").on(t.userId, t.playedAt)]);

export const userTrackStats = pgTable("user_track_stats", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  trackId: text("track_id").notNull(),
  starts: integer("starts").notNull().default(0),
  qualified: integer("qualified").notNull().default(0),
  completes: integer("completes").notNull().default(0),
  skips: integer("skips").notNull().default(0),
  lastPlayedAt: ts("last_played_at"),
}, (t) => [primaryKey({ columns: [t.userId, t.provider, t.trackId] })]);

/** Time-decayed affinity; `score` is stored as of `updatedAt` and decayed on read. */
export const userArtistAffinity = pgTable("user_artist_affinity", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  artistId: text("artist_id").notNull(),
  artistName: text("artist_name").notNull().default(""),
  score: doublePrecision("score").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.provider, t.artistId] }), index("user_artist_affinity_top_idx").on(t.userId, t.score)]);

/** Item-item co-listening (session co-occurrence), symmetric, a < b. */
export const trackCooccurrences = pgTable("track_cooccurrences", {
  provider: text("provider").notNull(),
  trackA: text("track_a").notNull(),
  trackB: text("track_b").notNull(),
  weight: doublePrecision("weight").notNull().default(0),
  users: integer("users").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.provider, t.trackA, t.trackB] }), index("track_cooc_b_idx").on(t.provider, t.trackB)]);

export const recommendationConfigs = pgTable("recommendation_configs", {
  version: text("version").primaryKey(),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  active: boolean("active").notNull().default(false),
  createdAt: created(),
});

export const recommendationImpressions = pgTable("recommendation_impressions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  configVersion: text("config_version").notNull(),
  surface: text("surface").notNull(),
  provider: text("provider").notNull(),
  trackId: text("track_id").notNull(),
  position: integer("position").notNull(),
  candidateSource: text("candidate_source").notNull(),
  score: doublePrecision("score").notNull(),
  shownAt: ts("shown_at").notNull().defaultNow(),
}, (t) => [index("rec_impressions_user_idx").on(t.userId, t.shownAt)]);

export const feedbackKindEnum = pgEnum("rec_feedback_kind", ["not_interested_track", "not_interested_artist"]);

export const recommendationFeedback = pgTable("recommendation_feedback", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  kind: feedbackKindEnum("kind").notNull(),
  targetId: text("target_id").notNull(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.provider, t.kind, t.targetId] })]);

// ---------- operations ----------
export const outboxEvents = pgTable("outbox_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: created(),
  availableAt: ts("available_at").notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  processedAt: ts("processed_at"),
  /** Set after MAX_ATTEMPTS; the worker stops retrying (dead letter). */
  failedAt: ts("failed_at"),
}, (t) => [index("outbox_pending_idx").on(t.availableAt).where(sql`${t.processedAt} is null and ${t.failedAt} is null`)]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  route: text("route").notNull(),
  status: integer("status").notNull(),
  response: jsonb("response").notNull(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })]);

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
}, (t) => [index("audit_events_user_idx").on(t.userId, t.createdAt)]);
