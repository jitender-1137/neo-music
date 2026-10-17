package com.zuno.music;

import android.app.PendingIntent;
import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Owns the ExoPlayer and the media session: the notification, lock screen, Bluetooth / headset
 * buttons and audio focus. Runs as a foreground service while playing, so audio keeps going with
 * the app in the background. ZunoAudioPlugin drives the player; system commands arrive through
 * {@link SystemControls}, are carried out here and then reported to the page.
 */
public class PlaybackService extends MediaSessionService {
    /** Restart instead of going back when ⏮ is pressed past this point (engine: PREV_RESTART_THRESHOLD_SEC). */
    static final long RESTART_THRESHOLD_MS = 3_000;

    interface RemoteListener { void onRemote(String command, boolean handled, @Nullable Double seekTime); }

    @Nullable static PlaybackService instance;

    ExoPlayer player;
    @Nullable RemoteListener remoteListener;
    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();
        player = new ExoPlayer.Builder(this)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), /* handleAudioFocus= */ true)
            .setHandleAudioBecomingNoisy(true) // headphones out → pause, like other music apps
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build();
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent activity = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, new SystemControls(player)).setSessionActivity(activity).build();
        instance = this;
    }

    @Nullable
    @Override
    public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Swiped away from recents: keep playing if music is on (like Spotify), otherwise stop.
        if (!player.getPlayWhenReady() || player.getMediaItemCount() == 0) stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        session.release();
        player.release();
        super.onDestroy();
    }

    private void report(String command, boolean handled, @Nullable Double seekTime) {
        if (remoteListener != null) remoteListener.onRemote(command, handled, seekTime);
    }

    /**
     * What the system controls see. Next / previous stay available even when the page has to decide.
     * ForwardingPlayer is marked unstable in Media3 (its API may change between releases); pinned
     * via media3Version in variables.gradle.
     */
    @OptIn(markerClass = UnstableApi.class)
    private final class SystemControls extends ForwardingPlayer {
        SystemControls(Player player) { super(player); }

        @Override public void play() { super.play(); report("play", true, null); }
        @Override public void pause() { super.pause(); report("pause", true, null); }
        @Override public void stop() { super.pause(); report("stop", true, null); }

        @Override public void seekTo(long positionMs) { super.seekTo(positionMs); report("seekto", true, positionMs / 1000.0); }

        @Override public void seekToNext() { next(); }
        @Override public void seekToNextMediaItem() { next(); }
        private void next() {
            // Queued next item: move on here (works with the page asleep). Otherwise the page decides.
            if (getWrappedPlayer().hasNextMediaItem()) { super.seekToNextMediaItem(); report("next", true, null); }
            else report("next", false, null);
        }

        @Override public void seekToPrevious() { previous(); }
        @Override public void seekToPreviousMediaItem() { previous(); }
        private void previous() {
            if (getWrappedPlayer().getCurrentPosition() > RESTART_THRESHOLD_MS) { super.seekTo(0); report("previous", true, null); }
            else report("previous", false, null);
        }

        @NonNull
        @Override
        public Player.Commands getAvailableCommands() {
            return super.getAvailableCommands().buildUpon()
                .addAll(COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build();
        }

        @Override
        public boolean isCommandAvailable(int command) {
            return getAvailableCommands().contains(command);
        }
    }
}
