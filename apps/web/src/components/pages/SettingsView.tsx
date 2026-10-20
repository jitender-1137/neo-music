"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AudioQuality, MusicSource, SourceInfo } from "@zuno/core";
import { getMusicSource, setMusicSource } from "@/lib/musicSource";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clearAllLocal } from "@/lib/guestDb";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { usePlayerEngine } from "@/lib/player";
import { clearPlaybackLog, readPlaybackLog } from "@/lib/playbackLog";
import { capabilityReport } from "@/lib/capabilities";
import { Button } from "../ui/Button";
import { InstallButton } from "../shell/InstallButton";
import { useInstallState } from "@/lib/install";
import { EmptyState } from "../ui/States";
import { MonitorIcon, MoonIcon, SunIcon, UserCircleIcon } from "../icons";

function DiagnosticsButton() {
  const [log, setLog] = useState<string | null>(null);
  const [caps, setCaps] = useState<[string, string][] | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      {caps && (
        <dl data-capabilities className="grid w-full max-w-[min(90vw,40rem)] grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface p-3 text-left text-[11px] text-muted">
          {caps.map(([k, v]) => <div key={k} className="contents"><dt className="font-medium text-foreground">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { if (caps) setCaps(null); else void capabilityReport().then(setCaps); }}>{caps ? "Hide capabilities" : "Capabilities"}</Button>
        <Button size="sm" onClick={() => setLog(log == null ? readPlaybackLog() || "(empty — play something first)" : null)}>{log == null ? "Show log" : "Hide"}</Button>
        <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(readPlaybackLog()).then(() => toast("Log copied"), () => toast("Couldn't copy")); }}>Copy</Button>
        <Button size="sm" variant="ghost" onClick={() => { clearPlaybackLog(); setLog(log == null ? null : ""); toast("Log cleared"); }}>Clear log</Button>
      </div>
      {log != null && <pre data-playback-log className="max-h-64 w-full max-w-[min(90vw,40rem)] overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-left text-[11px] leading-snug text-muted">{log}</pre>}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="font-medium">{title}</div>{desc && <div className="text-sm text-muted">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full glass p-1">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm [&_svg]:h-4 [&_svg]:w-4", value === o.v ? "bg-surface-3 font-medium" : "text-muted hover:text-foreground")}>{o.icon}{o.label}</button>
      ))}
    </div>
  );
}

/**
 * Which library fetches the catalogue (and how songs play). Only the sources this server enables are
 * offered; the trade-offs of the selected one are spelled out under it.
 */
function MusicSourceRow() {
  const q = useQuery({
    queryKey: ["music-sources"],
    queryFn: () => api.get<{ sources: SourceInfo[]; default: MusicSource; current: MusicSource }>("/api/v1/sources"),
    staleTime: 5 * 60_000,
  });
  const [picked, setPicked] = useState<MusicSource | undefined>(() => getMusicSource());
  if (!q.data) return null;
  const { sources, default: def } = q.data;
  const current = picked && sources.some((s) => s.id === picked) ? picked : def;
  const info = sources.find((s) => s.id === current);
  const short: Record<MusicSource, string> = { youtubei: "youtubei.js", ytmusicapi: "ytmusicapi", official: "Official API" };
  const choose = (id: MusicSource) => {
    if (id === current) return;
    setMusicSource(id);
    setPicked(id);
    toast(`Switched to ${short[id]} — reloading…`);
    // Reload so every page, cache and the player start cleanly on the new source.
    setTimeout(() => location.reload(), 400);
  };
  const limits = info && [
    !info.features.albums && "no albums",
    !info.features.lyrics && "no lyrics",
    !info.features.suggestions && "no search suggestions",
    !info.features.backgroundPlayback && "stops when the screen locks",
  ].filter(Boolean).join(" · ");
  return (
    <Row title="Music source" desc={sources.length < 2 ? `${info?.name ?? short[current]} (the only source enabled on this server).` : `${info?.description ?? ""}${limits ? ` Limits: ${limits}.` : ""}`}>
      {sources.length > 1 && (
        <Segmented<MusicSource> label="Music source" value={current} onChange={choose} options={sources.map((s) => ({ v: s.id, label: short[s.id] }))} />
      )}
    </Row>
  );
}

function InstallSection() {
  const st = useInstallState();
  return (
    <section aria-label="App" className="mt-8">
      <h2 className="pb-2 text-sm font-semibold uppercase tracking-wide text-muted">App</h2>
      <Row title="Install Neo Music" desc={st.kind === "installed" ? "Installed — you're using the app." : st.kind === "unavailable" ? "Open Neo Music in Chrome/Edge (Android, desktop) or Safari (iPhone/iPad) over HTTPS to install it." : "Adds Neo Music to your home screen, opens full-screen, and keeps playing with the screen locked."}>
        <InstallButton variant="full" />
      </Row>
    </section>
  );
}

export function SettingsView() {
  const prefs = usePrefs();
  const { user } = useAuth();
  const engine = usePlayerEngine();
  const qc = useQueryClient();
  const setQuality = (q: AudioQuality) => {
    setPrefs({ quality: q });
    if (user) void api.put("/api/v1/account/preferences", { audioQuality: q }).catch(() => undefined);
    toast("Applies from the next song");
  };
  return (
    <div className="mx-auto max-w-2xl px-4 pt-2 md:px-0">
      <h1 className="mb-4 text-3xl font-bold">Settings</h1>
      <section aria-label="Appearance" className="divide-y divide-divider">
        <h2 className="pb-2 text-sm font-semibold uppercase tracking-wide text-muted">Appearance</h2>
        <Row title="Theme"><Segmented label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[{ v: "system", label: "System", icon: <MonitorIcon /> }, { v: "dark", label: "Dark", icon: <MoonIcon /> }, { v: "light", label: "Light", icon: <SunIcon /> }]} /></Row>
      </section>
      <InstallSection />
      <section aria-label="Playback" className="mt-8 divide-y divide-divider">
        <h2 className="pb-2 text-sm font-semibold uppercase tracking-wide text-muted">Playback</h2>
        <MusicSourceRow />
        <Row title="Audio quality" desc="Higher quality uses more data. Only qualities the source offers are used; iPhone and Safari always get AAC.">
          <Segmented label="Audio quality" value={prefs.quality} onChange={setQuality} options={[{ v: "auto", label: "Auto" }, { v: "low", label: "Low" }, { v: "normal", label: "Normal" }, { v: "high", label: "High" }]} />
        </Row>
        <Row title="Autoplay" desc="Keep playing similar songs when your queue ends.">
          <input type="checkbox" className="h-6 w-6 accent-[var(--color-accent)]" checked={prefs.autoplay} onChange={(e) => { setPrefs({ autoplay: e.target.checked }); engine?.setAutoplay(e.target.checked); }} aria-label="Autoplay" />
        </Row>
        <Row title="Hide explicit recommendations" desc="Explicit songs won't be recommended. You can still play them directly.">
          <input type="checkbox" className="h-6 w-6 accent-[var(--color-accent)]" checked={prefs.hideExplicit} aria-label="Hide explicit recommendations"
            onChange={(e) => { setPrefs({ hideExplicit: e.target.checked }); if (user) void api.put("/api/v1/account/preferences", { hideExplicit: e.target.checked }).then(() => qc.invalidateQueries({ queryKey: ["home"] })); }} />
        </Row>
        <Row title="Playback diagnostics" desc="If the lock screen or notification controls misbehave, copy this log and send it to support. It stays on this device.">
          <DiagnosticsButton />
        </Row>
        <Row title="Keyboard shortcuts" desc="Space play/pause · Shift+N next · Shift+P previous · ←/→ seek 2s · M mute · S shuffle · R repeat · F now playing"><span /></Row>
      </section>
      <section aria-label="Data" className="mt-8 divide-y divide-divider">
        <h2 className="pb-2 text-sm font-semibold uppercase tracking-wide text-muted">Your music</h2>
        <Row title="Import from other apps" desc="Spotify, Apple Music, YouTube Music, Deezer, TIDAL, Amazon Music, SoundCloud — links or exported files.">
          <Link href="/import" className="glass hover:glass-strong inline-flex h-9 items-center rounded-full px-4 text-sm font-medium">Import music</Link>
        </Row>
        <Row title="Clear local data" desc={user ? "Removes the queue, cached settings and pending listening events stored in this browser. Your account isn't affected." : "Removes your guest library, playlists, history and queue from this browser. This can't be undone."}>
          <Button variant="outline" onClick={async () => { if (!confirm("Clear all Neo Music data stored in this browser?")) return; await clearAllLocal(); try { localStorage.clear(); } catch { /* ignore */ } toast("Local data cleared"); location.reload(); }}>Clear</Button>
        </Row>
      </section>
      <section aria-label="Account" className="mt-8">
        <h2 className="pb-2 text-sm font-semibold uppercase tracking-wide text-muted">Account</h2>
        {user ? <Link className="text-accent underline" href="/account">Manage your account</Link> : <p className="text-sm text-muted"><Link href="/login" className="text-foreground underline">Sign in</Link> to sync across devices.</p>}
      </section>
      <p className="mt-10 text-xs text-subtle">Neo Music is an independent project and is not affiliated with YouTube or Google. Music metadata and audio are provided by the configured music provider; lyrics from LRCLIB or the provider.</p>
    </div>
  );
}

export function AccountView() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(user?.displayName ?? "");
  const [cur, setCur] = useState(""); const [next, setNext] = useState("");
  if (!user) return <EmptyState icon={<UserCircleIcon />} title="You're not signed in" action={<Button variant="primary" onClick={() => router.push("/login")}>Sign in</Button>} />;
  const field = "h-11 w-full rounded-lg glass px-3 outline-none focus:ring-1 focus:ring-focus";
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-10 px-4 pt-2 md:px-0">
      <h1 className="text-3xl font-bold">Your account</h1>
      <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); try { await api.patch("/api/v1/account", { displayName: name }); await qc.invalidateQueries({ queryKey: ["me"] }); toast("Saved"); } catch (err) { toast.error(err instanceof ApiError ? err.message : "Couldn't save"); } }}>
        <h2 className="font-semibold">Profile</h2>
        <p className="text-sm text-muted">{user.email}</p>
        <label className="flex flex-col gap-1 text-sm">Display name<input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
        <Button type="submit" variant="secondary" className="self-start">Save</Button>
      </form>
      <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); try { await api.post("/api/v1/account/password", { currentPassword: cur, newPassword: next }); setCur(""); setNext(""); toast("Password changed. Other devices were signed out."); } catch (err) { toast.error(err instanceof ApiError ? err.message : "Couldn't change password"); } }}>
        <h2 className="font-semibold">Change password</h2>
        <input className={field} type="password" placeholder="Current password" aria-label="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <input className={field} type="password" placeholder="New password (10+ characters)" aria-label="New password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
        <Button type="submit" variant="secondary" className="self-start">Change password</Button>
      </form>
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Your data</h2>
        <p className="text-sm text-muted">Download everything Neo Music stores about you: library, playlists, history and searches.</p>
        <a href="/api/v1/account/export" className="self-start rounded-full glass px-4 py-2 text-sm font-medium hover:glass-strong">Download my data (JSON)</a>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Sign out</h2>
        <Button variant="outline" className="self-start" onClick={() => void logout().then(() => router.push("/"))}>Sign out</Button>
      </div>
      <div className="flex flex-col gap-3 rounded-xl bg-danger/10 p-4">
        <h2 className="font-semibold text-danger">Delete account</h2>
        <p className="text-sm text-muted">Permanently deletes your account, library, playlists and history. This can't be undone.</p>
        <Button variant="danger" className="self-start" onClick={async () => {
          const pw = prompt("Enter your password to permanently delete your account:");
          if (!pw) return;
          try { await api.del("/api/v1/account", { password: pw }); await qc.invalidateQueries(); toast("Account deleted"); router.push("/"); location.reload(); }
          catch (err) { toast.error(err instanceof ApiError ? err.message : "Couldn't delete account"); }
        }}>Delete account</Button>
      </div>
    </div>
  );
}
