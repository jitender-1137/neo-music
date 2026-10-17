CREATE TYPE "public"."audio_quality" AS ENUM('auto', 'low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."catalog_kind" AS ENUM('track', 'album', 'artist', 'playlist');--> statement-breakpoint
CREATE TYPE "public"."listening_event_type" AS ENUM('impression', 'start', 'qualified', 'complete', 'skip', 'like', 'unlike', 'playlist_add', 'playlist_remove', 'queue_add', 'search', 'follow', 'unfollow', 'album_save', 'not_interested', 'rec_select');--> statement-breakpoint
CREATE TYPE "public"."rec_feedback_kind" AS ENUM('not_interested_track', 'not_interested_artist');--> statement-breakpoint
CREATE TYPE "public"."playlist_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"provider" text NOT NULL,
	"kind" "catalog_kind" NOT NULL,
	"item_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_provider_kind_item_id_pk" PRIMARY KEY("provider","kind","item_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "listening_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"type" "listening_event_type" NOT NULL,
	"provider" text NOT NULL,
	"track_id" text,
	"artist_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ms_played" integer,
	"duration_ms" integer,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"track_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"played_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playlist_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playlist_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"track_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_tracks_position_nonneg" CHECK ("playlist_tracks"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" "playlist_visibility" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlists_title_len" CHECK (char_length("playlists"."title") between 1 and 150),
	CONSTRAINT "playlists_desc_len" CHECK (char_length("playlists"."description") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "recommendation_configs" (
	"version" text PRIMARY KEY NOT NULL,
	"weights" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_feedback" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" "rec_feedback_kind" NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_feedback_user_id_provider_kind_target_id_pk" PRIMARY KEY("user_id","provider","kind","target_id")
);
--> statement-breakpoint
CREATE TABLE "recommendation_impressions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"config_version" text NOT NULL,
	"surface" text NOT NULL,
	"provider" text NOT NULL,
	"track_id" text NOT NULL,
	"position" integer NOT NULL,
	"candidate_source" text NOT NULL,
	"score" double precision NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_history_user_id_query_pk" PRIMARY KEY("user_id","query")
);
--> statement-breakpoint
CREATE TABLE "track_cooccurrences" (
	"provider" text NOT NULL,
	"track_a" text NOT NULL,
	"track_b" text NOT NULL,
	"weight" double precision DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_cooccurrences_provider_track_a_track_b_pk" PRIMARY KEY("provider","track_a","track_b")
);
--> statement-breakpoint
CREATE TABLE "user_artist_affinity" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"artist_id" text NOT NULL,
	"artist_name" text DEFAULT '' NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_artist_affinity_user_id_provider_artist_id_pk" PRIMARY KEY("user_id","provider","artist_id")
);
--> statement-breakpoint
CREATE TABLE "user_followed_artists" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"artist_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_followed_artists_user_id_provider_artist_id_pk" PRIMARY KEY("user_id","provider","artist_id")
);
--> statement-breakpoint
CREATE TABLE "user_likes" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"track_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_likes_user_id_provider_track_id_pk" PRIMARY KEY("user_id","provider","track_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"audio_quality" "audio_quality" DEFAULT 'auto' NOT NULL,
	"hide_explicit" boolean DEFAULT false NOT NULL,
	"seed_artists" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_saved_albums" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"album_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_saved_albums_user_id_provider_album_id_pk" PRIMARY KEY("user_id","provider","album_id")
);
--> statement-breakpoint
CREATE TABLE "user_saved_playlists" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"playlist_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_saved_playlists_user_id_provider_playlist_id_pk" PRIMARY KEY("user_id","provider","playlist_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_track_stats" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"track_id" text NOT NULL,
	"starts" integer DEFAULT 0 NOT NULL,
	"qualified" integer DEFAULT 0 NOT NULL,
	"completes" integer DEFAULT 0 NOT NULL,
	"skips" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	CONSTRAINT "user_track_stats_user_id_provider_track_id_pk" PRIMARY KEY("user_id","provider","track_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_len" CHECK (char_length("users"."email") between 3 and 320),
	CONSTRAINT "users_display_name_len" CHECK (char_length("users"."display_name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_history" ADD CONSTRAINT "listening_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_artist_affinity" ADD CONSTRAINT "user_artist_affinity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_followed_artists" ADD CONSTRAINT "user_followed_artists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_likes" ADD CONSTRAINT "user_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_albums" ADD CONSTRAINT "user_saved_albums_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_playlists" ADD CONSTRAINT "user_saved_playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_track_stats" ADD CONSTRAINT "user_track_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "listening_events_user_time_idx" ON "listening_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "listening_events_track_idx" ON "listening_events" USING btree ("provider","track_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_history_event_uq" ON "listening_history" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "listening_history_user_idx" ON "listening_history" USING btree ("user_id","played_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."processed_at" is null and "outbox_events"."failed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_tracks_position_uq" ON "playlist_tracks" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "playlist_tracks_track_idx" ON "playlist_tracks" USING btree ("playlist_id","provider","track_id");--> statement-breakpoint
CREATE INDEX "playlists_owner_idx" ON "playlists" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "rec_impressions_user_idx" ON "recommendation_impressions" USING btree ("user_id","shown_at");--> statement-breakpoint
CREATE INDEX "search_history_recent_idx" ON "search_history" USING btree ("user_id","searched_at");--> statement-breakpoint
CREATE INDEX "track_cooc_b_idx" ON "track_cooccurrences" USING btree ("provider","track_b");--> statement-breakpoint
CREATE INDEX "user_artist_affinity_top_idx" ON "user_artist_affinity" USING btree ("user_id","score");--> statement-breakpoint
CREATE INDEX "user_followed_artists_recent_idx" ON "user_followed_artists" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_likes_recent_idx" ON "user_likes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_saved_albums_recent_idx" ON "user_saved_albums" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_saved_playlists_recent_idx" ON "user_saved_playlists" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));