import AVFoundation
import Capacitor
import MediaPlayer
import UIKit

/**
 * The app's audio player: AVQueuePlayer + lock screen / Control Center / headset controls, driven
 * by the web player engine through NativeAudioElement (packages/player/src/native.ts — read its
 * header for the contract; ZunoAudioPlugin.java on Android follows the same one).
 *
 * Playback must not depend on the page's JavaScript being awake: system commands are carried out
 * here and then reported, and the page queues the next track (`setNext`) so a song ending moves on
 * natively.
 */
@objc(ZunoAudioPlugin)
public class ZunoAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ZunoAudioPlugin"
    public let jsName = "ZunoAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNowPlaying", returnType: CAPPluginReturnPromise),
    ]

    private struct Meta { let title: String; let artist: String; let album: String; let artworkUrl: String? }
    private struct Entry { let url: URL; let identity: String; let meta: Meta? }

    /** Restart instead of going back when ⏮ is pressed past this point (engine: PREV_RESTART_THRESHOLD_SEC). */
    private let restartThreshold = 3.0

    private let player = AVQueuePlayer()
    /** The item the page loaded or native advanced to, and what it is. */
    private var currentItem: AVPlayerItem?
    private var current: Entry?
    private var currentFailed = false
    private var next: Entry?
    private var nextItem: AVPlayerItem?
    /** The item native just advanced away from: its end notification may arrive after the switch. */
    private var previousItem: AVPlayerItem?
    private var meta: Meta?
    private var seq = 0
    private var lastStatus: AVPlayer.TimeControlStatus = .paused
    private var wasPlayingBeforeInterruption = false
    private var observers: [NSObjectProtocol] = []
    private var playerKvo: [NSKeyValueObservation] = []
    private var itemKvo: [NSKeyValueObservation] = []
    private var timeObserver: Any?
    private var ticks = 0
    private var artworkTask: URLSessionDataTask?
    private var artworkUrl: String?

    override public func load() {
        player.automaticallyWaitsToMinimizeStalling = true
        player.actionAtItemEnd = .advance
        DispatchQueue.main.async { self.setUp() }
    }

    // MARK: - Page → native

    @objc func load(_ call: CAPPluginCall) {
        let seq = call.getInt("seq") ?? 0
        let url = call.getString("url").flatMap(URL.init(string:))
        let autoplay = call.getBool("autoplay") ?? false
        DispatchQueue.main.async {
            self.seq = max(self.seq, seq)
            guard let url else {
                self.player.removeAllItems()
                self.currentItem = nil; self.current = nil; self.nextItem = nil
                call.resolve(); return
            }
            let id = Self.identity(url)
            if let item = self.currentItem, self.player.currentItem === item, !self.currentFailed, self.current?.identity == id {
                // Native already plays it (it moved on while the page slept): replay state, don't reload.
                if autoplay, self.player.timeControlStatus == .paused { self.activateSession(); self.player.play() }
                self.emit("loadedmetadata")
                if self.player.timeControlStatus != .paused { self.emit("play"); self.emit("playing") }
                call.resolve(); return
            }
            self.player.removeAllItems()
            let item = AVPlayerItem(url: url)
            self.current = Entry(url: url, identity: id, meta: self.meta)
            self.currentItem = item
            self.currentFailed = false
            self.nextItem = nil
            self.observe(item)
            self.player.insert(item, after: nil)
            self.queueNext()
            if autoplay { self.activateSession(); self.player.play() }
            self.updateNowPlaying()
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        let seq = call.getInt("seq") ?? 0
        DispatchQueue.main.async {
            self.seq = max(self.seq, seq)
            self.activateSession()
            self.player.play()
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        let seq = call.getInt("seq") ?? 0
        DispatchQueue.main.async {
            self.seq = max(self.seq, seq)
            self.player.pause()
            call.resolve()
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let sec = call.getDouble("sec") ?? 0
        DispatchQueue.main.async { self.seek(to: sec); call.resolve() }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let volume = Float(call.getDouble("volume") ?? 1)
        let muted = call.getBool("muted") ?? false
        DispatchQueue.main.async { self.player.volume = volume; self.player.isMuted = muted; call.resolve() }
    }

    @objc func setNext(_ call: CAPPluginCall) {
        let url = call.getString("url").flatMap(URL.init(string:))
        let meta = Self.meta(call.getObject("meta"))
        DispatchQueue.main.async {
            let entry = url.map { Entry(url: $0, identity: Self.identity($0), meta: meta) }
            if entry?.identity != self.next?.identity || entry?.url != self.next?.url { self.next = entry; self.queueNext() }
            call.resolve()
        }
    }

    @objc func setNowPlaying(_ call: CAPPluginCall) {
        let meta = Self.meta(call.getObject("meta"))
        DispatchQueue.main.async {
            self.meta = meta
            if let c = self.current { self.current = Entry(url: c.url, identity: c.identity, meta: meta) }
            self.updateNowPlaying()
            call.resolve()
        }
    }

    // MARK: - Setup

    private func setUp() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in self?.onInterruption(n) })
        observers.append(nc.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] n in self?.onItemEnded(n) })
        observers.append(nc.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] n in
            guard let self, let item = n.object as? AVPlayerItem, item === self.currentItem else { return }
            self.fail(n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError)
        })

        playerKvo.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.onStatusChange() }
        })
        playerKvo.append(player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.onCurrentItemChange() }
        })
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] _ in
            guard let self, self.player.timeControlStatus == .playing else { return }
            self.ticks += 1
            // 4 Hz in the foreground (smooth progress/lyrics); 1 Hz in the background, where the
            // page may be suspended and every event would queue up for it.
            if UIApplication.shared.applicationState == .active || self.ticks % 4 == 0 { self.emit("timeupdate") }
        }
        setUpRemoteCommands()
    }

    private func observe(_ item: AVPlayerItem) {
        itemKvo = [
            item.observe(\.status, options: [.new]) { [weak self] it, _ in
                DispatchQueue.main.async {
                    guard let self, it === self.currentItem else { return }
                    if it.status == .readyToPlay { self.emit("loadedmetadata"); self.updateNowPlaying() }
                    if it.status == .failed { self.fail(it.error as NSError?) }
                }
            },
            item.observe(\.duration, options: [.new]) { [weak self] it, _ in
                DispatchQueue.main.async { if let self, it === self.currentItem { self.emit("durationchange"); self.updateNowPlaying() } }
            },
        ]
    }

    private func setUpRemoteCommands() {
        let rc = MPRemoteCommandCenter.shared()
        rc.playCommand.addTarget { [weak self] _ in self?.remote("play", handled: true) { $0.activateSession(); $0.player.play() } ?? .commandFailed }
        rc.pauseCommand.addTarget { [weak self] _ in self?.remote("pause", handled: true) { $0.player.pause() } ?? .commandFailed }
        rc.stopCommand.addTarget { [weak self] _ in self?.remote("stop", handled: true) { $0.player.pause() } ?? .commandFailed }
        rc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.remote("toggle", handled: true) { me in
                if me.player.timeControlStatus == .paused { me.activateSession(); me.player.play() } else { me.player.pause() }
            } ?? .commandFailed
        }
        rc.nextTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            // Queued next item: move on here (works with the page asleep). Otherwise the page decides.
            if let item = self.nextItem, self.player.items().contains(item) { return self.remote("next", handled: true) { $0.player.advanceToNextItem() } }
            return self.remote("next", handled: false) { _ in }
        }
        rc.previousTrackCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.player.currentTime().seconds > self.restartThreshold { return self.remote("previous", handled: true) { $0.seek(to: 0) } }
            return self.remote("previous", handled: false) { _ in }
        }
        rc.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return self.remote("seekto", handled: true, seekTime: e.positionTime) { $0.seek(to: e.positionTime) }
        }
        // Withheld on purpose: with skip handlers iOS replaces ⏮ ⏭ with ±15 s on the lock screen.
        rc.skipForwardCommand.isEnabled = false
        rc.skipBackwardCommand.isEnabled = false
    }

    private func remote(_ command: String, handled: Bool, seekTime: Double? = nil, _ action: (ZunoAudioPlugin) -> Void) -> MPRemoteCommandHandlerStatus {
        action(self)
        var data: [String: Any] = ["command": command, "handled": handled]
        if let seekTime { data["seekTime"] = seekTime }
        notifyListeners("remote", data: data)
        return .success
    }

    private func activateSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            CAPLog.print("ZunoAudio: audio session error \(error.localizedDescription)")
        }
    }

    // MARK: - Native → page

    private func onStatusChange() {
        let s = player.timeControlStatus
        defer { lastStatus = s; updateNowPlaying() }
        guard s != lastStatus, currentItem != nil else { return }
        switch s {
        case .paused: emit("pause")
        case .waitingToPlayAtSpecifiedRate:
            if lastStatus == .paused { emit("play") }
            if player.reasonForWaitingToPlay != .noItemToPlay { emit("waiting") }
        case .playing:
            if lastStatus == .paused { emit("play") }
            emit("playing")
        @unknown default: break
        }
    }

    /** AVQueuePlayer moved to the queued next item by itself (track ended, or ⏭ from the lock screen). */
    private func onCurrentItemChange() {
        guard let item = player.currentItem, item !== currentItem, item === nextItem, let n = next else { return }
        previousItem = currentItem
        currentItem = item
        current = n
        currentFailed = false
        meta = n.meta
        next = nil
        nextItem = nil
        observe(item)
        emit("advanced")
        if player.timeControlStatus == .playing { emit("playing") }
        updateNowPlaying()
    }

    private func onItemEnded(_ n: Notification) {
        guard let item = n.object as? AVPlayerItem, item === currentItem || item === previousItem else { return }
        // Still playing if native has moved (or is about to move) on to the queued next item.
        let continues = item !== currentItem || nextItem != nil
        if item === previousItem { previousItem = nil }
        emit("ended", time: Self.finite(item.duration.seconds), paused: !continues)
    }

    private func fail(_ err: NSError?) {
        guard !currentFailed else { return }
        currentFailed = true
        player.pause()
        // MediaError codes the engine understands: 3 decode, otherwise 2 (network — includes an
        // expired stream token, which the engine renews and retries).
        let code = err?.domain == AVFoundationErrorDomain && err?.code == AVError.decodeFailed.rawValue ? 3 : 2
        emit("error", paused: true, extra: ["code": code, "message": "\(err?.domain ?? "?") \(err?.code ?? 0) \(err?.localizedDescription ?? "")"])
    }

    private func emit(_ type: String, time: Double? = nil, paused: Bool? = nil, extra: [String: Any] = [:]) {
        let item = currentItem
        var data: [String: Any] = [
            "type": type,
            "seq": seq,
            "time": Self.finite(time ?? player.currentTime().seconds),
            "duration": Self.finite(item?.duration.seconds ?? 0),
            "paused": paused ?? (player.timeControlStatus == .paused),
        ]
        if let end = item?.loadedTimeRanges.last?.timeRangeValue.end.seconds, end.isFinite { data["buffered"] = end }
        data.merge(extra) { $1 }
        notifyListeners("media", data: data)
    }

    // MARK: - Helpers

    private func queueNext() {
        if let old = nextItem { player.remove(old); nextItem = nil }
        guard let n = next, let cur = currentItem, player.items().contains(cur) else { return }
        let item = AVPlayerItem(url: n.url)
        if player.canInsert(item, after: cur) { player.insert(item, after: cur); nextItem = item }
    }

    private func seek(to sec: Double) {
        player.seek(to: CMTime(seconds: max(0, sec), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] done in
            DispatchQueue.main.async { if done { self?.emit("seeked") }; self?.updateNowPlaying() }
        }
    }

    private func onInterruption(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began { wasPlayingBeforeInterruption = lastStatus != .paused; return }
        let opts = AVAudioSession.InterruptionOptions(rawValue: n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        // After a call or Siri, carry on like Music does (only if we were playing).
        if opts.contains(.shouldResume), wasPlayingBeforeInterruption { activateSession(); player.play() }
    }

    private func updateNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard let m = meta, currentItem != nil else { center.nowPlayingInfo = nil; center.playbackState = .stopped; return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: m.title,
            MPMediaItemPropertyArtist: m.artist,
            MPMediaItemPropertyAlbumTitle: m.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Self.finite(player.currentTime().seconds),
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? 1.0 : 0.0,
        ]
        let d = currentItem?.duration.seconds ?? 0
        if d.isFinite, d > 0 { info[MPMediaItemPropertyPlaybackDuration] = d }
        if m.artworkUrl == artworkUrl, let art = center.nowPlayingInfo?[MPMediaItemPropertyArtwork] { info[MPMediaItemPropertyArtwork] = art }
        center.nowPlayingInfo = info
        center.playbackState = player.timeControlStatus == .paused ? .paused : .playing
        if m.artworkUrl != artworkUrl { loadArtwork(m.artworkUrl) }
    }

    private func loadArtwork(_ s: String?) {
        artworkUrl = s
        artworkTask?.cancel()
        guard let s, let url = URL(string: Self.largeArtwork(s)) else { return }
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, self.artworkUrl == s else { return }
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask?.resume()
    }

    /** Same resize rule as the web Media Session adapter (mediaSession.ts): ask the CDN for 512 px. */
    private static func largeArtwork(_ s: String) -> String {
        guard s.contains("googleusercontent") || s.contains("ggpht"), let r = s.range(of: #"=w\d+-h\d+[^/]*$"#, options: .regularExpression) else { return s }
        return s.replacingCharacters(in: r, with: "=w512-h512-l90-rj")
    }

    /** A stream's identity: its URL without the `t` playback token (a renewed token is the same track). */
    static func identity(_ url: URL) -> String {
        guard var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
        c.queryItems = c.queryItems?.filter { $0.name != "t" }
        if c.queryItems?.isEmpty == true { c.queryItems = nil }
        return c.string ?? url.absoluteString
    }

    private static func meta(_ o: JSObject?) -> Meta? {
        guard let o, let title = o["title"] as? String else { return nil }
        return Meta(title: title, artist: o["artist"] as? String ?? "", album: o["album"] as? String ?? "", artworkUrl: o["artworkUrl"] as? String)
    }

    private static func finite(_ v: Double) -> Double { v.isFinite ? max(0, v) : 0 }
}
