ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_position_uq" UNIQUE ("playlist_id", "position") DEFERRABLE INITIALLY DEFERRED;
