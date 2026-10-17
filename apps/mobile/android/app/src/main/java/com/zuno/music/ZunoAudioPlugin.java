package com.zuno.music;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * The app's audio player on Android (Media3 / ExoPlayer in {@link PlaybackService}), driven by the
 * web player engine through NativeAudioElement (packages/player/src/native.ts — read its header for
 * the contract; ZunoAudioPlugin.swift on iOS follows the same one).
 *
 * Each media item's id is its stream identity (URL without the `t` token), so "load the track
 * native already plays" can be recognised and replayed instead of reloaded.
 */
@CapacitorPlugin(name = "ZunoAudio")
public class ZunoAudioPlugin extends Plugin {
    private static final Pattern ARTWORK_SIZE = Pattern.compile("=w\\d+-h\\d+[^/]*$");

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Commands that arrived before the service was connected. */
    private final List<Runnable> waiting = new ArrayList<>();
    @Nullable private ExoPlayer player;
    @Nullable private ListenableFuture<MediaController> controller;

    private int seq = 0;
    private boolean currentFailed = false;
    private boolean metadataSent = false;
    @Nullable private MediaMetadata meta;
    @Nullable private String nextUrl;
    @Nullable private MediaMetadata nextMeta;
    private boolean foreground = true;
    private int ticks = 0;
    private long lastDurationMs = C.TIME_UNSET;

    @Override
    public void load() {
        // Connecting a controller starts the service and lets Media3 run it in the foreground while playing.
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
        controller = new MediaController.Builder(getContext(), token).buildAsync();
        controller.addListener(this::attach, ContextCompat.getMainExecutor(getContext()));
    }

    private void attach() {
        PlaybackService service = PlaybackService.instance;
        if (service == null) return;
        player = service.player;
        service.remoteListener = this::onRemote;
        player.addListener(listener);
        for (Runnable r : waiting) r.run();
        waiting.clear();
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService service = PlaybackService.instance;
        if (service != null) service.remoteListener = null;
        if (player != null) player.removeListener(listener);
        if (controller != null) MediaController.releaseFuture(controller);
    }

    @Override protected void handleOnPause() { foreground = false; }
    @Override protected void handleOnResume() { foreground = true; }

    /** Run on the player's thread once the service is up. */
    private void withPlayer(PluginCall call, PlayerTask task) {
        main.post(() -> {
            Runnable r = () -> { task.run(Objects.requireNonNull(player)); call.resolve(); };
            if (player != null) r.run(); else waiting.add(r);
        });
    }

    private interface PlayerTask { void run(ExoPlayer p); }

    // ---------------- page → native ----------------

    @PluginMethod
    public void load(PluginCall call) {
        int s = call.getInt("seq", 0);
        @Nullable String url = call.getString("url");
        boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", false));
        withPlayer(call, p -> {
            seq = Math.max(seq, s);
            if (url == null) { p.clearMediaItems(); p.stop(); return; }
            String id = identity(url);
            MediaItem cur = p.getCurrentMediaItem();
            if (cur != null && id.equals(cur.mediaId) && !currentFailed && p.getPlaybackState() != Player.STATE_ENDED && p.getPlaybackState() != Player.STATE_IDLE) {
                // Native already plays it (it moved on while the page slept): replay state, don't reload.
                if (autoplay && !p.getPlayWhenReady()) p.play();
                emit("loadedmetadata", null);
                if (p.getPlayWhenReady()) { emit("play", null); if (p.isPlaying()) emit("playing", null); }
                return;
            }
            currentFailed = false;
            metadataSent = false;
            p.setMediaItem(item(url, meta));
            queueNext(p);
            p.setPlayWhenReady(autoplay);
            p.prepare();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        int s = call.getInt("seq", 0);
        withPlayer(call, p -> {
            seq = Math.max(seq, s);
            if (p.getPlaybackState() == Player.STATE_IDLE && p.getMediaItemCount() > 0) p.prepare();
            p.play();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        int s = call.getInt("seq", 0);
        withPlayer(call, p -> { seq = Math.max(seq, s); p.pause(); });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double sec = call.getDouble("sec", 0.0);
        withPlayer(call, p -> p.seekTo(Math.max(0, (long) (sec * 1000))));
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        float volume = call.getFloat("volume", 1f);
        boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        withPlayer(call, p -> p.setVolume(muted ? 0f : volume));
    }

    @PluginMethod
    public void setNext(PluginCall call) {
        @Nullable String url = call.getString("url");
        @Nullable MediaMetadata m = metadata(call.getObject("meta"));
        withPlayer(call, p -> {
            if (Objects.equals(url, nextUrl)) return;
            nextUrl = url;
            nextMeta = m;
            queueNext(p);
        });
    }

    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        @Nullable MediaMetadata m = metadata(call.getObject("meta"));
        withPlayer(call, p -> {
            meta = m;
            MediaItem cur = p.getCurrentMediaItem();
            if (cur == null || m == null || sameMeta(cur.mediaMetadata, m)) return;
            // Metadata-only change: the player keeps playing without re-buffering.
            p.replaceMediaItem(p.getCurrentMediaItemIndex(), cur.buildUpon().setMediaMetadata(m).build());
        });
    }

    // ---------------- native → page ----------------

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
            emit(playWhenReady ? "play" : "pause", null);
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            if (isPlaying) { emit("playing", null); main.removeCallbacks(tick); main.postDelayed(tick, 250); }
            else main.removeCallbacks(tick);
        }

        @Override
        public void onPlaybackStateChanged(int state) {
            ExoPlayer p = Objects.requireNonNull(player);
            if (state == Player.STATE_BUFFERING && p.getPlayWhenReady()) emit("waiting", null);
            if (state == Player.STATE_READY && !metadataSent) { metadataSent = true; emit("loadedmetadata", null); emit("durationchange", null); }
            if (state == Player.STATE_ENDED) emit("ended", true);
            if (p.getDuration() != C.TIME_UNSET) lastDurationMs = p.getDuration();
        }

        @Override
        public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED || item == null) return;
            ExoPlayer p = Objects.requireNonNull(player);
            // Moved to the queued next item by itself: a song ended, or ⏭ from the system controls.
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) emitEndedOfPrevious();
            if (p.getCurrentMediaItemIndex() > 0) p.removeMediaItems(0, p.getCurrentMediaItemIndex());
            meta = item.mediaMetadata;
            nextUrl = null;
            nextMeta = null;
            currentFailed = false;
            metadataSent = false;
            emit("advanced", null);
            if (p.isPlaying()) emit("playing", null);
        }

        @Override
        public void onPositionDiscontinuity(@NonNull Player.PositionInfo oldPosition, @NonNull Player.PositionInfo newPosition, int reason) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK) emit("seeked", null);
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            currentFailed = true;
            int code = error.errorCode >= PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED && error.errorCode < PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED ? 3 : 2;
            JSObject extra = new JSObject();
            extra.put("code", code);
            extra.put("message", error.getErrorCodeName() + " " + error.getMessage());
            emit("error", true, extra);
        }
    };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (player == null || !player.isPlaying()) return;
            // 4 Hz in the foreground (smooth progress/lyrics), 1 Hz in the background.
            if (foreground || ++ticks % 4 == 0) emit("timeupdate", null);
            main.postDelayed(this, 250);
        }
    };

    private void emitEndedOfPrevious() {
        JSObject extra = new JSObject();
        extra.put("time", lastDurationMs == C.TIME_UNSET ? 0 : lastDurationMs / 1000.0);
        extra.put("duration", lastDurationMs == C.TIME_UNSET ? 0 : lastDurationMs / 1000.0);
        emit("ended", false, extra);
    }

    private void onRemote(String command, boolean handled, @Nullable Double seekTime) {
        JSObject data = new JSObject();
        data.put("command", command);
        data.put("handled", handled);
        if (seekTime != null) data.put("seekTime", seekTime);
        notifyListeners("remote", data);
    }

    private void emit(String type, @Nullable Boolean paused) { emit(type, paused, null); }

    private void emit(String type, @Nullable Boolean paused, @Nullable JSObject extra) {
        ExoPlayer p = player;
        if (p == null) return;
        long d = p.getDuration();
        JSObject data = new JSObject();
        data.put("type", type);
        data.put("seq", seq);
        data.put("time", Math.max(0, p.getCurrentPosition()) / 1000.0);
        data.put("duration", d == C.TIME_UNSET ? 0 : d / 1000.0);
        data.put("paused", paused != null ? paused : !p.getPlayWhenReady());
        data.put("buffered", Math.max(0, p.getBufferedPosition()) / 1000.0);
        if (extra != null) for (java.util.Iterator<String> it = extra.keys(); it.hasNext(); ) { String k = it.next(); data.put(k, extra.opt(k)); }
        notifyListeners("media", data);
    }

    // ---------------- helpers ----------------

    private void queueNext(ExoPlayer p) {
        int idx = p.getCurrentMediaItemIndex();
        if (p.getMediaItemCount() > idx + 1) p.removeMediaItems(idx + 1, p.getMediaItemCount());
        if (nextUrl != null && p.getMediaItemCount() > 0) p.addMediaItem(item(nextUrl, nextMeta));
    }

    private static MediaItem item(String url, @Nullable MediaMetadata m) {
        MediaItem.Builder b = new MediaItem.Builder().setMediaId(identity(url)).setUri(url);
        if (m != null) b.setMediaMetadata(m);
        return b.build();
    }

    @Nullable
    private static MediaMetadata metadata(@Nullable JSObject o) {
        if (o == null || o.getString("title") == null) return null;
        MediaMetadata.Builder b = new MediaMetadata.Builder()
            .setTitle(o.getString("title"))
            .setArtist(o.getString("artist", ""))
            .setAlbumTitle(o.getString("album", ""));
        String art = o.getString("artworkUrl");
        if (art != null) b.setArtworkUri(Uri.parse(largeArtwork(art)));
        return b.build();
    }

    private static boolean sameMeta(MediaMetadata a, MediaMetadata b) {
        return Objects.equals(String.valueOf(a.title), String.valueOf(b.title)) && Objects.equals(String.valueOf(a.artist), String.valueOf(b.artist))
            && Objects.equals(String.valueOf(a.albumTitle), String.valueOf(b.albumTitle)) && Objects.equals(a.artworkUri, b.artworkUri);
    }

    /** Same resize rule as the web Media Session adapter (mediaSession.ts): ask the CDN for 512 px. */
    private static String largeArtwork(String s) {
        if (!s.contains("googleusercontent") && !s.contains("ggpht")) return s;
        return ARTWORK_SIZE.matcher(s).replaceFirst("=w512-h512-l90-rj");
    }

    /** A stream's identity: its URL without the `t` playback token (a renewed token is the same track). */
    static String identity(String url) {
        Uri u = Uri.parse(url);
        Uri.Builder b = u.buildUpon().clearQuery();
        for (String name : u.getQueryParameterNames()) {
            if (name.equals("t")) continue;
            for (String v : u.getQueryParameters(name)) b.appendQueryParameter(name, v);
        }
        return b.build().toString();
    }
}
