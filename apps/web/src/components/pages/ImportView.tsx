"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ImportCollection, MatchConfidence, MatchResult, Track } from "@zuno/core";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePlayerEngine } from "@/lib/player";
import { parseImportFile, parseText, readFileText } from "@/lib/importParsers";
import { saveImport, type Destination } from "@/lib/importSave";
import { useMyPlaylists } from "../music/AddToPlaylist";
import { userPlaylistHref } from "../music/links";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { CheckCircleIcon, CloseIcon, DownloadIcon, LinkIcon, PlayIcon, SearchIcon, WarningIcon, BackIcon } from "../icons";

// ---------------------------------------------------------------- sources
type SourceId = "ytmusic" | "youtube" | "spotify" | "apple" | "deezer" | "tidal" | "amazon" | "soundcloud" | "file" | "paste";
type Source = { id: SourceId; name: string; color: string; link?: "youtube" | "deezer" | "spotify"; files?: string; steps: React.ReactNode[] };

const ext = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline">{label}</a>;
const SOURCES: Source[] = [
  { id: "ytmusic", name: "YouTube Music", color: "#ff3355", link: "youtube", files: ".csv",
    steps: [<>Copy a playlist or album link (Share → Copy link) and paste it below.</>, <>Your whole library? Use {ext("https://takeout.google.com/", "Google Takeout")} → YouTube and YouTube Music → playlists, then upload the CSV files.</>] },
  { id: "youtube", name: "YouTube", color: "#ff4444", link: "youtube", steps: [<>Paste a YouTube playlist link (or a single video link).</>] },
  { id: "spotify", name: "Spotify", color: "#1ed760", link: "spotify", files: ".csv",
    steps: [<>Open {ext("https://exportify.app/", "Exportify")}, sign in with Spotify and click <b>Export</b> next to any playlist (or <b>Export all</b>, including Liked Songs).</>, <>Upload the CSV file(s) here.</>] },
  { id: "apple", name: "Apple Music", color: "#fa4a6a", files: ".xml,.txt",
    steps: [<>On a Mac: open the <b>Music</b> app, select a playlist, choose <b>File → Library → Export Playlist…</b> (XML or Plain text).</>, <>On iPhone/Windows: use {ext("https://www.tunemymusic.com/", "TuneMyMusic")} → Apple Music → Export to file (CSV).</>, <>Upload the file here.</>] },
  { id: "deezer", name: "Deezer", color: "#a238ff", link: "deezer", files: ".csv", steps: [<>Paste a public playlist or album link (Share → Copy link).</>] },
  { id: "tidal", name: "TIDAL", color: "#33ffee", files: ".csv", steps: [<>Use {ext("https://www.tunemymusic.com/", "TuneMyMusic")} or {ext("https://soundiiz.com/", "Soundiiz")}: choose TIDAL as the source and <b>Export to file → CSV</b>.</>, <>Upload the CSV here.</>] },
  { id: "amazon", name: "Amazon Music", color: "#25d1da", files: ".csv", steps: [<>Use {ext("https://www.tunemymusic.com/", "TuneMyMusic")} or {ext("https://soundiiz.com/", "Soundiiz")} → Amazon Music → <b>Export to file → CSV</b>.</>, <>Upload the CSV here.</>] },
  { id: "soundcloud", name: "SoundCloud", color: "#ff7700", files: ".csv", steps: [<>Use {ext("https://www.tunemymusic.com/", "TuneMyMusic")} → SoundCloud → <b>Export to file → CSV</b>.</>, <>Upload the CSV here.</>] },
  { id: "file", name: "Any file", color: "#8b5cff", files: ".csv,.tsv,.txt,.xml,.m3u,.m3u8,.pls,.json",
    steps: [<>CSV (Exportify, TuneMyMusic, Soundiiz, Google Takeout), Apple Music XML/TXT, M3U/M3U8, PLS, a text list, or a Neo Music data export (JSON).</>, <>Files are read on this device — nothing is uploaded.</>] },
  { id: "paste", name: "Paste a list", color: "#2ec5f0", steps: [<>One song per line: <code>Artist - Title</code>, <code>Title by Artist</code>, or YouTube links.</>] },
];

// ---------------------------------------------------------------- state
type Row = { idx: number; result?: MatchResult; chosen: Track | null; excluded: boolean };
type Coll = { key: string; col: ImportCollection; selected: boolean; name: string; rows: Row[]; dest: "new" | "liked" | string };

const CONF_LABEL: Record<MatchConfidence, string> = { exact: "Exact", high: "Matched", medium: "Good match", low: "Check", none: "Not found" };
const CONF_CLS: Record<MatchConfidence, string> = {
  exact: "bg-success/15 text-success", high: "bg-success/15 text-success", medium: "bg-accent/15 text-accent", low: "bg-warning/15 text-warning", none: "bg-danger/15 text-danger",
};
const needsReview = (r: Row) => !r.excluded && (!r.result || r.result.confidence === "low" || r.result.confidence === "none" || !r.chosen);

function toColls(cols: ImportCollection[]): Coll[] {
  return cols.filter((c) => c.items.length).map((col, i) => ({
    key: `${Date.now()}-${i}`, col, selected: true, name: col.name, dest: col.kind === "liked" ? "liked" : "new",
    rows: col.items.map((_, idx) => ({ idx, chosen: null, excluded: false })),
  }));
}

// ---------------------------------------------------------------- matching
function useMatching(colls: Coll[], setColls: React.Dispatch<React.SetStateAction<Coll[]>>) {
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const run = useCallback(async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    try {
      for (const c of colls) {
        if (!c.selected) continue;
        const pending = c.rows.filter((r) => !r.result);
        for (let i = 0; i < pending.length; i += 25) {
          if (ac.signal.aborted) return;
          const batch = pending.slice(i, i + 25);
          let res: { results: MatchResult[] };
          try {
            res = await api.post<{ results: MatchResult[] }>("/api/v1/import/match", { items: batch.map((r) => c.col.items[r.idx]) }, { signal: ac.signal });
          } catch (e) {
            if ((e as Error).name === "AbortError") return;
            toast.error(e instanceof ApiError ? e.message : "Matching paused — check your connection and press Resume.");
            return;
          }
          setColls((prev) => prev.map((x) => x.key !== c.key ? x : {
            ...x,
            rows: x.rows.map((r) => {
              const k = batch.findIndex((b) => b.idx === r.idx);
              if (k < 0) return r;
              const m = res.results[k]!;
              // Low-confidence/none results are suggestions only — not auto-imported.
              const auto = m.track && (m.confidence === "exact" || m.confidence === "high" || m.confidence === "medium");
              return { ...r, result: m, chosen: auto ? m.track : null };
            }),
          }));
        }
      }
    } finally {
      if (abort.current === ac) setRunning(false);
    }
  }, [colls, setColls]);
  useEffect(() => () => abort.current?.abort(), []);
  return { running, run, stop: () => { abort.current?.abort(); setRunning(false); } };
}

// ---------------------------------------------------------------- component
export function ImportView() {
  const [source, setSource] = useState<Source | null>(null);
  const [colls, setColls] = useState<Coll[]>([]);
  const [stage, setStage] = useState<"pick" | "review" | "done">("pick");
  const [done, setDone] = useState<{ name: string; saved: number; href?: string }[]>([]);
  const reset = () => { setColls([]); setStage("pick"); setDone([]); };

  return (
    <div className="mx-auto max-w-5xl px-4 pt-2 md:px-0">
      <div className="mb-6 flex items-center gap-3">
        {stage !== "pick" || source ? <IconButton label="Back" onClick={() => (stage === "pick" ? setSource(null) : reset())}><BackIcon /></IconButton> : null}
        <div>
          <h1 className="text-3xl font-bold">Import music</h1>
          <p className="text-sm text-muted">Bring your playlists and liked songs from other music apps.</p>
        </div>
      </div>
      <Stepper stage={stage} />
      {stage === "pick" && (source
        ? <SourcePanel source={source} onParsed={(cols) => { setColls(toColls(cols)); setStage("review"); }} />
        : <SourceGrid onPick={setSource} />)}
      {stage === "review" && <Review colls={colls} setColls={setColls} onDone={(d) => { setDone(d); setStage("done"); }} />}
      {stage === "done" && <Done results={done} onAgain={() => { reset(); setSource(null); }} />}
    </div>
  );
}

function Stepper({ stage }: { stage: "pick" | "review" | "done" }) {
  const steps = [["pick", "Choose source"], ["review", "Review matches"], ["done", "Done"]] as const;
  const at = steps.findIndex(([s]) => s === stage);
  return (
    <ol className="mb-8 flex items-center gap-1.5 text-xs sm:gap-2" aria-label="Import steps">
      {steps.map(([id, label], i) => (
        <li key={id} className="flex items-center gap-1.5 sm:gap-2" aria-current={i === at ? "step" : undefined}>
          <span className={cn("grid h-6 w-6 place-items-center rounded-full font-semibold", i < at ? "bg-success/20 text-success" : i === at ? "bg-accent text-accent-fg" : "glass text-muted")}>{i < at ? "✓" : i + 1}</span>
          <span className={cn(i === at ? "whitespace-nowrap font-medium" : "text-muted max-sm:sr-only")}>{label}</span>
          {i < steps.length - 1 && <span className="mx-0.5 h-px w-3 bg-divider sm:mx-1 sm:w-6" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function SourceGrid({ onPick }: { onPick: (s: Source) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {SOURCES.map((s) => (
        <button key={s.id} onClick={() => onPick(s)} className="glass hover:glass-strong group flex flex-col items-start gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.98]">
          <span className="grid h-10 w-10 place-items-center rounded-xl text-sm font-bold text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${s.color}, color-mix(in oklch, ${s.color} 55%, black))` }} aria-hidden>
            {s.id === "file" ? <DownloadIcon className="h-5 w-5" /> : s.id === "paste" ? "≡" : s.name[0]}
          </span>
          <span className="text-sm font-medium">{s.name}</span>
          <span className="text-xs text-muted">{s.link && s.files ? "Link or file" : s.link ? "Paste a link" : s.id === "paste" ? "Type or paste" : "Upload a file"}</span>
        </button>
      ))}
    </div>
  );
}

function SourcePanel({ source, onParsed }: { source: Source; onParsed: (cols: ImportCollection[]) => void }) {
  const caps = useQuery({ queryKey: ["import-caps"], queryFn: () => api.get<{ spotifyLinks: boolean }>("/api/v1/import/capabilities"), staleTime: 3600_000 });
  const linkable = source.link && (source.link !== "spotify" || caps.data?.spotifyLinks);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function fromLink() {
    if (!url.trim()) return;
    setBusy(true);
    try { onParsed([await api.post<ImportCollection>("/api/v1/import/link", { url })]); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't read that link"); }
    finally { setBusy(false); }
  }
  async function fromFiles(files: FileList | File[]) {
    setBusy(true);
    try {
      const all: ImportCollection[] = [];
      for (const f of Array.from(files).slice(0, 50)) {
        if (f.size > 20 * 1024 * 1024) { toast.error(`${f.name} is too large (max 20 MB)`); continue; }
        const r = parseImportFile(await readFileText(f), f.name);
        r.warnings.forEach((w) => toast.warning(`${f.name}: ${w}`));
        all.push(...r.collections);
      }
      if (all.some((c) => c.items.length)) onParsed(all);
      else toast.error("No songs were found in that file.");
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <section className="glass rounded-2xl p-5" aria-label={`How to import from ${source.name}`}>
        <h2 className="mb-3 text-lg font-semibold">From {source.name}</h2>
        <ol className="flex flex-col gap-3 text-sm text-muted">
          {source.steps.map((s, i) => <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{i + 1}</span><span>{s}</span></li>)}
          {source.link === "spotify" && caps.data && !caps.data.spotifyLinks && <li className="flex gap-3 text-xs"><WarningIcon className="h-4 w-4 shrink-0" />Spotify links need API keys on this server, so use the CSV export above.</li>}
        </ol>
      </section>
      <section className="flex flex-col gap-4" aria-label="Import input">
        {linkable && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void fromLink(); }}>
            <label htmlFor="import-url" className="text-sm font-medium">Playlist or album link</label>
            <div className="flex gap-2">
              <div className="glass flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-4 focus-within:glass-strong">
                <LinkIcon className="h-5 w-5 text-muted" />
                <input id="import-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={source.link === "deezer" ? "https://www.deezer.com/playlist/…" : source.link === "spotify" ? "https://open.spotify.com/playlist/…" : "https://music.youtube.com/playlist?list=…"} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle" inputMode="url" autoComplete="off" />
              </div>
              <Button type="submit" variant="primary" loading={busy} disabled={!url.trim()}>Import</Button>
            </div>
          </form>
        )}
        {source.files && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void fromFiles(e.dataTransfer.files); }}
            className={cn("glass flex flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center transition-colors", drag && "glass-strong ring-2 ring-accent")}
          >
            <DownloadIcon className="h-8 w-8 text-accent" />
            <p className="text-sm"><b>Drop files here</b> or choose them</p>
            <p className="text-xs text-muted">{source.files.split(",").join(" ")} · several at once is fine</p>
            <input ref={fileRef} type="file" multiple accept={source.files} className="sr-only" aria-label="Choose playlist files" onChange={(e) => { if (e.target.files?.length) void fromFiles(e.target.files); e.target.value = ""; }} />
            <Button variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>Choose files</Button>
          </div>
        )}
        {(source.id === "paste" || source.id === "file") && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const r = parseText(text, "Pasted list", "paste"); if (r.collections[0]?.items.length) onParsed(r.collections); else toast.error("Add at least one song"); }}>
            <label htmlFor="import-text" className="text-sm font-medium">Paste songs</label>
            <textarea id="import-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"The Beatles - Hey Jude\nBlinding Lights by The Weeknd\nhttps://youtu.be/…"} className="glass rounded-2xl p-4 text-sm outline-none focus:glass-strong" />
            <Button type="submit" variant="primary" disabled={!text.trim()} className="self-end">Find songs</Button>
          </form>
        )}
      </section>
    </div>
  );
}

function Review({ colls, setColls, onDone }: { colls: Coll[]; setColls: React.Dispatch<React.SetStateAction<Coll[]>>; onDone: (d: { name: string; saved: number; href?: string }[]) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const mine = useMyPlaylists();
  const { running, run, stop } = useMatching(colls, setColls);
  // Start matching on mount (and resume after a remount); `run` only processes unmatched rows.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => { void runRef.current(); }, []);
  const [active, setActive] = useState(colls[0]?.key);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const c = colls.find((x) => x.key === active) ?? colls[0];

  const totals = useMemo(() => {
    const sel = colls.filter((x) => x.selected);
    const rows = sel.flatMap((x) => x.rows);
    return { songs: rows.length, matched: rows.filter((r) => r.result).length, ready: rows.filter((r) => r.chosen && !r.excluded).length, review: rows.filter(needsReview).filter((r) => r.result).length };
  }, [colls]);
  const update = (key: string, fn: (c: Coll) => Coll) => setColls((p) => p.map((x) => (x.key === key ? fn(x) : x)));

  async function save() {
    const sel = colls.filter((x) => x.selected);
    const total = sel.reduce((s, x) => s + x.rows.filter((r) => r.chosen && !r.excluded).length, 0);
    setSaving({ done: 0, total });
    const out: { name: string; saved: number; href?: string }[] = [];
    let base = 0;
    try {
      for (const x of sel) {
        const tracks = x.rows.filter((r) => r.chosen && !r.excluded).map((r) => r.chosen!) ;
        if (!tracks.length) continue;
        const dest: Destination = x.dest === "liked" ? { kind: "liked" } : x.dest === "new" ? { kind: "new", title: x.name } : { kind: "existing", id: x.dest };
        const r = await saveImport(tracks, dest, !!user, (d) => setSaving({ done: base + d, total }));
        base += tracks.length;
        out.push({ name: dest.kind === "liked" ? "Liked music" : x.name, saved: r.saved, href: dest.kind === "liked" ? "/library/liked" : r.playlistId ? userPlaylistHref(r.playlistId) : undefined });
      }
      await qc.invalidateQueries({ queryKey: ["my-playlists"] });
      await qc.invalidateQueries({ queryKey: ["library"] });
      await qc.invalidateQueries({ queryKey: ["guest"] });
      onDone(out);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Import stopped. Already-saved songs are kept — you can import again safely.");
      setSaving(null);
    }
  }

  if (!c) return null;
  const rows = c.rows.filter((r) => (filter === "review" ? needsReview(r) && r.result : true));
  const pct = totals.songs ? Math.round((totals.matched / totals.songs) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Progress + actions */}
      <div className="glass sticky top-[calc(var(--m-top-h-compact)+var(--safe-top)+0.5rem)] md:top-[calc(var(--spacing-topbar)+var(--safe-top)+0.5rem)] z-10 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="mb-1.5 flex justify-between text-sm"><span>{running ? `Finding songs… ${totals.matched} of ${totals.songs}` : `${totals.ready} of ${totals.songs} songs ready`}</span>{totals.review > 0 && <span className="text-warning">{totals.review} to check</span>}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Matching progress">
            <div className="h-full rounded-full bg-[var(--song-accent)] transition-[width] duration-300" style={{ width: `${saving ? Math.round((saving.done / Math.max(1, saving.total)) * 100) : pct}%` }} />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {running ? <Button variant="secondary" onClick={stop}>Pause</Button> : totals.matched < totals.songs ? <Button variant="secondary" onClick={() => void run()}>Resume</Button> : null}
          <Button variant="primary" loading={!!saving} disabled={!totals.ready || running} onClick={() => void save()}>
            {saving ? `Importing ${saving.done}/${saving.total}` : `Import ${totals.ready} song${totals.ready === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
      {!user && <p className="text-xs text-muted">You're not signed in — imported music is saved on this device. <Link href="/login" className="underline">Sign in</Link> first to keep it on every device.</p>}

      {/* Collections */}
      <div className="flex flex-col gap-2">
        {colls.map((x) => (
          <div key={x.key} className={cn("glass flex flex-wrap items-center gap-3 rounded-2xl p-3", x.key === c.key && "glass-strong")}>
            <input type="checkbox" checked={x.selected} onChange={(e) => update(x.key, (y) => ({ ...y, selected: e.target.checked }))} aria-label={`Include ${x.name}`} className="h-5 w-5 accent-[var(--color-accent)]" />
            <input value={x.name} onChange={(e) => update(x.key, (y) => ({ ...y, name: e.target.value }))} aria-label="Playlist name" className="min-w-[10rem] flex-1 rounded-lg bg-transparent px-2 py-1 font-medium outline-none focus:glass" maxLength={150} />
            <span className="text-xs text-muted">{x.rows.length} songs</span>
            <select value={x.dest} onChange={(e) => update(x.key, (y) => ({ ...y, dest: e.target.value }))} aria-label={`Import ${x.name} into`} className="glass h-9 rounded-full px-3 text-sm outline-none">
              <option value="new">New playlist</option>
              <option value="liked">Liked music</option>
              {mine.data?.map((p) => <option key={p.id} value={p.id}>Add to “{p.title}”</option>)}
            </select>
            {colls.length > 1 && <Button size="sm" variant={x.key === c.key ? "primary" : "secondary"} onClick={() => setActive(x.key)}>Review</Button>}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="flex items-center gap-2" role="tablist" aria-label="Show songs">
        {(["all", "review"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("h-8 rounded-full px-3 text-xs font-medium", filter === f ? "bg-foreground text-background" : "glass hover:glass-strong")}>
            {f === "all" ? `All (${c.rows.length})` : `Needs review (${c.rows.filter((r) => needsReview(r) && r.result).length})`}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-1" aria-label={`Songs in ${c.name}`}>
        {rows.slice(0, 400).map((r) => <ReviewRow key={r.idx} c={c} r={r} onChange={(next) => update(c.key, (y) => ({ ...y, rows: y.rows.map((z) => (z.idx === r.idx ? next : z)) }))} />)}
      </ul>
      {rows.length > 400 && <p className="text-center text-xs text-muted">Showing the first 400 — every song is still imported.</p>}
    </div>
  );
}

function ReviewRow({ c, r, onChange }: { c: Coll; r: Row; onChange: (r: Row) => void }) {
  const src = c.col.items[r.idx]!;
  const engine = usePlayerEngine();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(`${src.title} ${src.artist}`.trim());
  const search = useQuery({
    queryKey: ["import-search", q], enabled: open && q.length > 1,
    queryFn: ({ signal }) => api.get<{ tracks: Track[]; videos: Track[] }>(`/api/v1/search?q=${encodeURIComponent(q)}&filter=song`, { signal }),
  });
  const conf = r.result?.confidence;
  const options = [...(r.result?.track ? [r.result.track] : []), ...(r.result?.alternatives ?? []), ...(search.data?.tracks ?? [])].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i).slice(0, 10);
  return (
    <li className={cn("rounded-xl px-2 py-2 transition-opacity", r.excluded && "opacity-45")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="col-start-1 row-start-1 min-w-0">
          <div className="line-clamp-1 text-sm">{src.title}</div>
          <div className="line-clamp-1 text-xs text-muted">{src.artist || "Unknown artist"}{src.album ? ` • ${src.album}` : ""}</div>
        </div>
        <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-3 md:col-span-1 md:row-start-auto">
          {!r.result ? <div className="skeleton h-9 w-full rounded-lg" aria-label="Finding a match" /> : r.chosen ? (
            <>
              <button aria-label={`Preview ${r.chosen.title}`} onClick={() => engine?.playTrack(r.chosen!, { type: "queue", title: "Import preview" })} className="relative shrink-0">
                <Artwork src={r.chosen.artworkUrl} alt="" size={36} className="w-9" />
                <span className="absolute inset-0 grid place-items-center rounded-md bg-black/40 opacity-0 hover:opacity-100 [&_svg]:h-4 [&_svg]:w-4"><PlayIcon className="text-white" /></span>
              </button>
              <div className="min-w-0"><div className="line-clamp-1 text-sm">{r.chosen.title}</div><div className="line-clamp-1 text-xs text-muted">{r.chosen.artist}</div></div>
            </>
          ) : <span className="text-xs text-muted">{conf === "none" ? "No match found — search below" : "Suggestion needs a check"}</span>}
        </div>
        <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 md:col-start-3">
          {conf && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CONF_CLS[conf])}>{r.chosen && (conf === "low" || conf === "none") ? "Chosen" : CONF_LABEL[conf]}</span>}
          {r.result && <IconButton size="sm" label={open ? "Close options" : "Change match"} onClick={() => setOpen((o) => !o)}><SearchIcon /></IconButton>}
          <IconButton size="sm" label={r.excluded ? "Include song" : "Skip song"} onClick={() => onChange({ ...r, excluded: !r.excluded })}>{r.excluded ? <CheckCircleIcon /> : <CloseIcon />}</IconButton>
        </div>
      </div>
      {open && (
        <div className="glass mt-2 rounded-xl p-2">
          <form onSubmit={(e) => e.preventDefault()} className="mb-2 flex items-center gap-2 rounded-full px-2">
            <SearchIcon className="h-4 w-4 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the catalog" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </form>
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {options.map((t) => (
              <li key={t.id}>
                <button onClick={() => { onChange({ ...r, chosen: t, excluded: false }); setOpen(false); }} className={cn("flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-hover", r.chosen?.id === t.id && "bg-hover")}>
                  <Artwork src={t.artworkUrl} alt="" size={36} className="w-9" />
                  <div className="min-w-0 flex-1"><div className="line-clamp-1 text-sm">{t.title}</div><div className="line-clamp-1 text-xs text-muted">{t.artist}{t.album ? ` • ${t.album}` : ""}</div></div>
                  {r.chosen?.id === t.id && <CheckCircleIcon className="h-4 w-4 text-accent" />}
                </button>
              </li>
            ))}
            {search.isFetching && <li className="p-2 text-xs text-muted">Searching…</li>}
            {!options.length && !search.isFetching && <li className="p-2 text-xs text-muted">Nothing found. Try different words.</li>}
          </ul>
        </div>
      )}
    </li>
  );
}

function Done({ results, onAgain }: { results: { name: string; saved: number; href?: string }[]; onAgain: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-2xl p-8 text-center">
      <CheckCircleIcon className="h-12 w-12 text-success" />
      <h2 className="text-xl font-semibold">Import complete</h2>
      <ul className="flex flex-col gap-2">
        {results.map((r, i) => (
          <li key={i} className="text-sm">{r.href ? <Link href={r.href} className="font-medium text-accent underline">{r.name}</Link> : <b>{r.name}</b>} — {r.saved} song{r.saved === 1 ? "" : "s"}</li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onAgain}>Import more</Button>
    </div>
  );
}
