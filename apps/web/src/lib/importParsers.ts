/**
 * Parse playlist exports from other services — entirely in the browser (files are never uploaded).
 *
 * Supported:
 *  - CSV: Exportify (Spotify), TuneMyMusic, Soundiiz, Google Takeout (YouTube Music), Neo Music CSV,
 *         and any CSV with a title/track column (+ artist column).
 *  - Apple Music / iTunes: "Export Playlist…" as XML (plist) or as plain text (UTF‑16, tab separated).
 *  - M3U / M3U8, PLS, plain text ("Artist - Title", "Title by Artist", or YouTube links per line),
 *  - JSON: Neo Music data export, or an array of { title, artist }.
 */
import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import type { ImportCollection, ImportItem, ImportSource } from "@zuno/core";

export type ParsedImport = { collections: ImportCollection[]; warnings: string[] };

const YT_ID = /^[\w-]{11}$/;

export function youtubeIdFrom(text: string): string | undefined {
  const t = text.trim();
  if (YT_ID.test(t)) return undefined; // a bare 11-char word is too ambiguous to treat as an id
  try {
    const u = new URL(t);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) { const id = u.pathname.slice(1, 12); return YT_ID.test(id) ? id : undefined; }
    if (/(^|\.)youtube\.com$/.test(u.hostname)) { const v = u.searchParams.get("v"); return v && YT_ID.test(v) ? v : undefined; }
  } catch { /* not a URL */ }
  return undefined;
}

/** "Artist - Title" / "Title by Artist" / "Title" */
export function splitLine(line: string): { title: string; artist: string } | null {
  const s = line.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, "").trim();
  if (!s) return null;
  const dash = s.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) return { artist: dash[0]!.trim(), title: dash.slice(1).join(" - ").trim() };
  const by = /^(.*)\s+by\s+(.+)$/i.exec(s);
  if (by) return { title: by[1]!.trim(), artist: by[2]!.trim() };
  return { title: s, artist: "" };
}

function clean(items: (ImportItem | null)[]): ImportItem[] {
  return items.filter((i): i is ImportItem => !!i && !!i.title?.trim()).map((i) => ({
    ...i, title: i.title.trim().slice(0, 300), artist: (i.artist ?? "").trim().slice(0, 300),
    album: i.album?.trim().slice(0, 300) || undefined,
  }));
}

function baseName(name: string) { return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Imported playlist"; }

// ---------- CSV ----------
type Row = Record<string, string>;
const pick = (row: Row, keys: string[]): string | undefined => {
  for (const k of Object.keys(row)) if (keys.includes(k.trim().toLowerCase())) { const v = row[k]?.trim(); if (v) return v; }
  return undefined;
};
const TITLE = ["track name", "track", "title", "song", "song name", "name", "track title"];
const ARTIST = ["artist name(s)", "artist name", "artist", "artists", "artist(s)", "creator"];
const ALBUM = ["album name", "album", "album title"];
const DURATION_MS = ["duration (ms)", "duration_ms", "track duration (ms)"];
const DURATION = ["duration", "length", "time", "duration (s)"];
const ISRC = ["isrc"];
const PLAYLIST = ["playlist name", "playlist", "playlist title"];
const VIDEO_ID = ["video id", "videoid", "video_id"];

function durationFrom(row: Row): number | undefined {
  const ms = pick(row, DURATION_MS);
  if (ms && /^\d+$/.test(ms)) return Math.round(Number(ms) / 1000);
  const d = pick(row, DURATION);
  if (!d) return undefined;
  if (/^\d+(\.\d+)?$/.test(d)) { const n = Number(d); return n > 10_000 ? Math.round(n / 1000) : Math.round(n); }
  const parts = d.split(":").map(Number);
  if (parts.length >= 2 && parts.every(Number.isFinite)) return parts.reduce((a, p) => a * 60 + p, 0);
  return undefined;
}

export function parseCsv(text: string, fileName: string): ParsedImport {
  const res = Papa.parse<Row>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", delimiter: "" });
  const rows = res.data;
  const headers = (res.meta.fields ?? []).map((h) => h.trim().toLowerCase());
  const warnings: string[] = [];
  // Google Takeout (YouTube Music playlists): video ids only.
  if (headers.some((h) => VIDEO_ID.includes(h)) && !headers.some((h) => TITLE.includes(h))) {
    const items = clean(rows.map((r) => { const id = pick(r, VIDEO_ID); return id && YT_ID.test(id) ? { title: id, artist: "", catalogId: id } : null; }));
    return { collections: items.length ? [{ name: baseName(fileName).replace(/-videos$/i, ""), kind: "playlist", source: "takeout", items }] : [], warnings };
  }
  if (!headers.some((h) => TITLE.includes(h))) {
    return { collections: [], warnings: ["This CSV has no Title/Track column. Export it again from Exportify, TuneMyMusic or Soundiiz."] };
  }
  const byPlaylist = new Map<string, ImportItem[]>();
  for (const r of rows) {
    const title = pick(r, TITLE);
    if (!title) continue;
    const vid = pick(r, VIDEO_ID);
    const item: ImportItem = { title, artist: pick(r, ARTIST) ?? "", album: pick(r, ALBUM), durationSec: durationFrom(r), isrc: pick(r, ISRC), catalogId: vid && YT_ID.test(vid) ? vid : undefined };
    const pl = pick(r, PLAYLIST) ?? baseName(fileName);
    byPlaylist.set(pl, [...(byPlaylist.get(pl) ?? []), item]);
  }
  const liked = (n: string) => /liked|favou?rite|loved/i.test(n);
  const collections = [...byPlaylist].map(([name, items]): ImportCollection => ({ name: name.slice(0, 150), kind: liked(name) ? "liked" : "playlist", source: "csv", items: clean(items) }));
  if (res.errors.length) warnings.push(`${res.errors.length} row(s) couldn't be read and were skipped.`);
  return { collections, warnings };
}

// ---------- Apple Music / iTunes ----------
/** Apple "Export Playlist… → XML": a plist with a Tracks dict and a Playlists array. */
export function parseAppleXml(text: string, fileName: string): ParsedImport {
  const parser = new XMLParser({ ignoreAttributes: true, preserveOrder: true, trimValues: true });
  const doc = parser.parse(text) as unknown[];
  type Node = Record<string, unknown>;
  const childrenOf = (n: Node, tag: string) => (n[tag] as Node[]) ?? [];
  const textOf = (n: Node) => String(((n["#text"] ?? (Object.values(n)[0] as Node[] | undefined)?.[0]?.["#text"]) as string | number | undefined) ?? "");
  /** Convert an ordered plist <dict> into a JS object. */
  const dictToObj = (children: Node[]): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < children.length - 1; i += 2) {
      const k = children[i]!; const v = children[i + 1]!;
      if (!("key" in k)) { i--; continue; }
      const key = textOf((k.key as Node[])[0] ?? {});
      const [tag] = Object.keys(v).filter((x) => x !== ":@");
      if (!tag) continue;
      if (tag === "dict") o[key] = dictToObj(childrenOf(v, "dict"));
      else if (tag === "array") o[key] = childrenOf(v, "array").filter((x) => "dict" in x).map((x) => dictToObj(childrenOf(x, "dict")));
      else if (tag === "true" || tag === "false") o[key] = tag === "true";
      else o[key] = (childrenOf(v, tag)[0] as Node | undefined)?.["#text"];
    }
    return o;
  };
  const plist = (doc.find((n) => "plist" in (n as Node)) as Node | undefined);
  const root = plist ? childrenOf(plist, "plist").find((n) => "dict" in n) : undefined;
  if (!root) return { collections: [], warnings: ["That XML isn't an Apple Music / iTunes playlist export."] };
  const data = dictToObj(childrenOf(root, "dict")) as { Tracks?: Record<string, Record<string, unknown>>; Playlists?: Record<string, unknown>[] };
  const tracks = data.Tracks ?? {};
  const toItem = (t?: Record<string, unknown>): ImportItem | null => t && t.Name ? {
    title: String(t.Name), artist: String(t.Artist ?? t["Album Artist"] ?? ""), album: t.Album ? String(t.Album) : undefined,
    durationSec: t["Total Time"] ? Math.round(Number(t["Total Time"]) / 1000) : undefined,
  } : null;
  const lists = (data.Playlists ?? []).filter((p) => Array.isArray(p["Playlist Items"]) && !p.Master && !p["Distinguished Kind"]);
  const collections: ImportCollection[] = lists.map((p) => ({
    name: String(p.Name ?? baseName(fileName)).slice(0, 150), kind: "playlist", source: "apple_music",
    items: clean((p["Playlist Items"] as Record<string, unknown>[]).map((it) => toItem(tracks[String(it["Track ID"])]))),
  }));
  if (!collections.length && Object.keys(tracks).length) {
    collections.push({ name: baseName(fileName), kind: "playlist", source: "apple_music", items: clean(Object.values(tracks).map(toItem)) });
  }
  return { collections, warnings: [] };
}

/** Apple "Export Playlist… → Plain text": tab-separated, header row "Name\tArtist\t…\tAlbum…\tTime". */
export function parseAppleTxt(text: string, fileName: string): ParsedImport {
  const res = Papa.parse<Row>(text.replace(/^﻿/, ""), { header: true, delimiter: "\t", skipEmptyLines: "greedy" });
  const items = clean(res.data.map((r) => {
    const title = pick(r, ["name"]);
    return title ? { title, artist: pick(r, ["artist"]) ?? "", album: pick(r, ["album"]), durationSec: (() => { const t = pick(r, ["time", "total time"]); return t && /^\d+$/.test(t) ? Number(t) : t ? durationFrom({ duration: t }) : undefined; })() } : null;
  }));
  return { collections: items.length ? [{ name: baseName(fileName), kind: "playlist", source: "apple_music", items }] : [], warnings: [] };
}

// ---------- M3U / PLS / TXT ----------
export function parseM3u(text: string, fileName: string): ParsedImport {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let name = baseName(fileName);
  const items: (ImportItem | null)[] = [];
  let pending: { title: string; artist: string; durationSec?: number } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#PLAYLIST:")) { name = line.slice(10).trim() || name; continue; }
    if (line.startsWith("#EXTINF:")) {
      const m = /^#EXTINF:(-?\d+)[^,]*,(.*)$/.exec(line);
      const sp = splitLine(m?.[2] ?? "");
      pending = sp ? { ...sp, durationSec: m && Number(m[1]) > 0 ? Number(m[1]) : undefined } : null;
      continue;
    }
    if (line.startsWith("#")) continue;
    const id = youtubeIdFrom(line);
    if (id) { items.push({ title: pending?.title ?? id, artist: pending?.artist ?? "", durationSec: pending?.durationSec, catalogId: id }); pending = null; continue; }
    if (pending) { items.push(pending); pending = null; continue; }
    // Path only: "Artist/Album/01 - Title.mp3"
    const file = line.split(/[\\/]/).pop()!.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/^\d+\s*[-.]\s*/, "");
    items.push(splitLine(file));
  }
  return { collections: [{ name, kind: "playlist", source: "m3u", items: clean(items) }], warnings: [] };
}

export function parsePls(text: string, fileName: string): ParsedImport {
  const entries = new Map<number, { title?: string; file?: string; length?: number }>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(File|Title|Length)(\d+)=(.*)$/i.exec(line.trim());
    if (!m) continue;
    const e = entries.get(Number(m[2])) ?? {};
    const k = m[1]!.toLowerCase();
    if (k === "title") e.title = m[3]; else if (k === "file") e.file = m[3]; else e.length = Number(m[3]);
    entries.set(Number(m[2]), e);
  }
  const items = [...entries.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => {
    const id = e.file ? youtubeIdFrom(e.file) : undefined;
    const sp = splitLine(e.title ?? (e.file ?? "").split(/[\\/]/).pop()!.replace(/\.[a-z0-9]{2,4}$/i, ""));
    return sp ? { ...sp, durationSec: e.length && e.length > 0 ? e.length : undefined, catalogId: id } : null;
  });
  return { collections: [{ name: baseName(fileName), kind: "playlist", source: "pls", items: clean(items) }], warnings: [] };
}

export function parseText(text: string, name = "Pasted list", source: ImportSource = "txt"): ParsedImport {
  const items = text.split(/\r?\n/).map((l) => {
    const id = youtubeIdFrom(l);
    if (id) return { title: id, artist: "", catalogId: id };
    return splitLine(l);
  });
  return { collections: [{ name, kind: "playlist", source, items: clean(items) }], warnings: [] };
}

// ---------- JSON ----------
export function parseJson(text: string, fileName: string): ParsedImport {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { collections: [], warnings: ["That JSON file couldn't be read."] }; }
  // Neo Music data export (Account → Download my data)
  const d = data as { playlists?: { title: string; tracks: { trackId: string }[] }[]; likes?: { itemId: string }[] };
  if (d && Array.isArray(d.playlists) && (d.playlists.length === 0 || "tracks" in (d.playlists[0] ?? {}))) {
    const collections: ImportCollection[] = d.playlists.map((p) => ({ name: p.title, kind: "playlist", source: "json", items: p.tracks.map((t) => ({ title: t.trackId, artist: "", catalogId: t.trackId })) }));
    if (Array.isArray(d.likes) && d.likes.length) collections.unshift({ name: "Liked music", kind: "liked", source: "json", items: d.likes.map((l) => ({ title: l.itemId, artist: "", catalogId: l.itemId })) });
    return { collections, warnings: [] };
  }
  const arr = Array.isArray(data) ? data : (data as { tracks?: unknown[] })?.tracks;
  if (Array.isArray(arr)) {
    const items = clean(arr.map((x) => {
      const o = x as Record<string, unknown>;
      const title = String(o.title ?? o.name ?? o.track ?? "");
      const artist = Array.isArray(o.artists) ? (o.artists as { name?: string }[]).map((a) => a.name ?? a).join(", ") : String(o.artist ?? "");
      return title ? { title, artist, album: o.album ? String(o.album) : undefined } : null;
    }));
    return { collections: items.length ? [{ name: baseName(fileName), kind: "playlist", source: "json", items }] : [], warnings: [] };
  }
  return { collections: [], warnings: ["Unrecognised JSON format."] };
}

/** Decode a File honouring BOMs (Apple's plain-text export is UTF‑16 LE). */
export async function readFileText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  return new TextDecoder("utf-8").decode(buf);
}

export function parseImportFile(text: string, fileName: string): ParsedImport {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const head = text.slice(0, 400).trimStart();
  if (ext === "xml" || head.startsWith("<?xml") || head.startsWith("<plist")) return parseAppleXml(text, fileName);
  if (ext === "m3u" || ext === "m3u8" || head.startsWith("#EXTM3U")) return parseM3u(text, fileName);
  if (ext === "pls" || /^\[playlist\]/i.test(head)) return parsePls(text, fileName);
  if (ext === "json") return parseJson(text, fileName);
  if (/^name\t/i.test(head)) return parseAppleTxt(text, fileName);
  if (ext === "csv" || ext === "tsv") return parseCsv(text, fileName);
  return parseText(text, baseName(fileName), "txt");
}
