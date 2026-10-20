"""
Neo Music — ytmusicapi helper service.

A small HTTP server (Python standard library only, plus ytmusicapi) that answers the Neo Music API's
catalogue questions using ytmusicapi and replies in Neo Music's own data format (see
packages/core/src/models.ts), so the Node side only validates and passes results through.

Metadata only: ytmusicapi has no audio, so songs found here are streamed by the API's youtubei.js
provider. Listens on 127.0.0.1 by default — it's an internal service, never exposed to browsers.

    YTMUSICAPI_HOST=127.0.0.1 YTMUSICAPI_PORT=4200 YT_LOCATION=IN YT_LANGUAGE=en python server.py
"""
import json
import os
import re
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from ytmusicapi import YTMusic

HOST = os.environ.get("YTMUSICAPI_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTMUSICAPI_PORT", "4200"))
LOCATION = os.environ.get("YT_LOCATION", "US")
LANGUAGE = os.environ.get("YT_LANGUAGE", "en")
PROVIDER = "youtube"  # same catalogue namespace as youtubei.js: shared ids, likes and history

_local = threading.local()


def yt() -> YTMusic:
    """One client per thread (requests sessions aren't safe to share across threads)."""
    if not hasattr(_local, "client"):
        try:
            _local.client = YTMusic(location=LOCATION, language=LANGUAGE)
        except Exception:
            _local.client = YTMusic(language=LANGUAGE)
    return _local.client


class HttpError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------------------------------------------------------------- mapping helpers

VIDEO_ID = re.compile(r"^[\w-]{11}$")


def art(thumbs, size: int = 544):
    """Largest thumbnail; Google image URLs are re-sized to a square `size`."""
    if isinstance(thumbs, dict):
        thumbs = thumbs.get("thumbnails")
    if not thumbs:
        return None
    url = thumbs[-1].get("url") if isinstance(thumbs, list) else None
    if not url:
        return None
    if "googleusercontent.com" in url or "ggpht.com" in url:
        url = re.sub(r"=w\d+-h\d+[^&?]*$", f"=w{size}-h{size}-l90-rj", url)
    return url


def refs(artists):
    return [{"id": a["id"], "name": a["name"]} for a in (artists or []) if a and a.get("id") and a.get("name")]


def names(artists, fallback: str = ""):
    ns = [a.get("name") for a in (artists or []) if a and a.get("name")]
    if not ns:
        return fallback
    return ns[0] if len(ns) == 1 else ", ".join(ns[:-1]) + " & " + ns[-1]


def seconds(text):
    if not text:
        return None
    parts = [p for p in str(text).split(":") if p.isdigit()]
    if not parts:
        return None
    total = 0
    for p in parts:
        total = total * 60 + int(p)
    return total


def clean(d: dict) -> dict:
    """Drop None values so optional fields are simply absent."""
    return {k: v for k, v in d.items() if v is not None}


def track(t: dict, album: dict | None = None):
    vid = t.get("videoId")
    title = t.get("title")
    if not vid or not title or not VIDEO_ID.match(vid):
        return None
    alb = t.get("album")
    alb_name = alb.get("name") if isinstance(alb, dict) else alb if isinstance(alb, str) else None
    alb_id = alb.get("id") if isinstance(alb, dict) else None
    if album:
        alb_name, alb_id = alb_name or album.get("title"), alb_id or album.get("id")
    dur = t.get("duration_seconds") or seconds(t.get("duration") or t.get("length"))
    thumb = art(t.get("thumbnails") or t.get("thumbnail")) or (album or {}).get("artworkUrl") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    vt = t.get("videoType")
    return clean({
        "id": vid, "provider": PROVIDER, "title": title,
        "artist": names(t.get("artists"), (t.get("author") or "")) or "Unknown artist",
        "artists": refs(t.get("artists")) or None,
        "album": alb_name, "albumId": alb_id,
        "durationSec": int(dur) if dur else None,
        "artworkUrl": thumb,
        "isExplicit": bool(t.get("isExplicit")) if t.get("isExplicit") is not None else None,
        "viewCountText": t.get("views"),
        "isVideo": True if vt in ("MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_UGC") else None,
    })


def album(a: dict):
    bid = a.get("browseId") or a.get("id")
    if not bid or not a.get("title"):
        return None
    kind = (a.get("type") or "").lower()
    return clean({
        "id": bid, "provider": PROVIDER, "title": a["title"],
        "artist": names(a.get("artists"), a.get("year") or "") or "",
        "artists": refs(a.get("artists")) or None,
        "artworkUrl": art(a.get("thumbnails")),
        "year": str(a["year"]) if a.get("year") else None,
        "releaseType": "single" if kind == "single" else "ep" if kind == "ep" else "album" if kind else None,
        "playlistId": a.get("playlistId") or a.get("audioPlaylistId"),
    })


def playlist(p: dict):
    pid = p.get("playlistId") or p.get("browseId") or p.get("id")
    if not pid or not p.get("title"):
        return None
    if pid.startswith("VL"):
        pid = pid[2:]
    author = p.get("author")
    owner = names(author) if isinstance(author, list) else (author.get("name") if isinstance(author, dict) else author)
    return clean({
        "id": pid, "provider": PROVIDER, "title": p["title"], "owner": owner or "YouTube Music",
        "description": p.get("description") if isinstance(p.get("description"), str) else None,
        "artworkUrl": art(p.get("thumbnails")),
        "trackCountText": p.get("itemCount") or (f"{p['trackCount']} songs" if p.get("trackCount") else None),
    })


def artist(a: dict):
    aid = a.get("browseId") or a.get("channelId") or a.get("id")
    name = a.get("artist") or a.get("name") or a.get("title")
    if not aid or not name:
        return None
    return clean({"id": aid, "provider": PROVIDER, "name": name, "artworkUrl": art(a.get("thumbnails")), "subscriberCount": a.get("subscribers")})


def item(x: dict):
    """A home / related / search entry of any kind → ShelfItem."""
    if not isinstance(x, dict):
        return None
    rt = x.get("resultType")
    if x.get("videoId") and rt not in ("album", "playlist", "artist"):
        t = track(x)
        return {"kind": "track", "track": t} if t else None
    bid = x.get("browseId") or ""
    if rt == "album" or bid.startswith("MPRE"):
        a = album(x)
        return {"kind": "album", "album": a} if a else None
    if rt == "artist" or (bid.startswith("UC") and not x.get("playlistId")):
        a = artist(x)
        return {"kind": "artist", "artist": a} if a else None
    if rt == "playlist" or x.get("playlistId") or bid.startswith("VL"):
        p = playlist(x)
        return {"kind": "playlist", "playlist": p} if p else None
    return None


def shelf(sid: str, title: str, contents, layout: str | None = None):
    items = [i for i in (item(x) for x in (contents or [])) if i]
    if not items:
        return None
    if layout is None:
        layout = "list" if sum(1 for i in items if i["kind"] == "track") > len(items) / 2 and len(items) > 4 else "carousel"
    return {"id": sid, "title": title or "", "layout": layout, "items": items}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:60] or "shelf"


# ---------------------------------------------------------------- operations

def op_home(q):
    sections = yt().get_home(limit=8)
    shelves = [s for s in (shelf(f"home-{i}-{slug(sec.get('title'))}", sec.get("title"), sec.get("contents")) for i, sec in enumerate(sections)) if s]
    return {"title": "Home", "chips": [], "shelves": shelves}


def op_explore(q):
    cats = yt().get_mood_categories()
    shelves = []
    for title, entries in cats.items():
        links = [{"kind": "link", "link": {"title": e["title"], "browseId": "FEmusic_moods_and_genres_category", "params": e["params"]}} for e in entries if e.get("params")]
        if links:
            shelves.append({"id": f"explore-{slug(title)}", "title": title, "layout": "chips", "items": links})
    return {"title": "Explore", "chips": [], "shelves": shelves}


def op_browse(q):
    params = q.get("params")
    if not params:
        raise HttpError(400, "not_supported", "This page isn't available with ytmusicapi")
    pls = yt().get_mood_playlists(params)
    s = shelf("mood", "Playlists", [dict(p, resultType="playlist") for p in pls], "carousel")
    return {"title": "Playlists", "chips": [], "shelves": [s] if s else []}


SEARCH_FILTER = {"all": None, "song": "songs", "video": "videos", "album": "albums", "artist": "artists", "playlist": "playlists"}


def op_search(q):
    query, flt = q.get("q", "").strip(), q.get("filter", "all")
    if not query:
        raise HttpError(400, "bad_request", "Empty search")
    res = yt().search(query, filter=SEARCH_FILTER.get(flt), limit=30 if flt != "all" else 20)
    out = {"query": query, "filter": flt, "tracks": [], "videos": [], "albums": [], "artists": [], "playlists": []}
    for r in res:
        rt = r.get("resultType")
        it = item(r)
        if not it:
            continue
        if r.get("category") == "Top result" and "top" not in out:
            out["top"] = it
            if rt in ("song", "video"):
                continue
        k = it["kind"]
        if k == "track":
            (out["videos"] if rt == "video" else out["tracks"]).append(it["track"])
        elif k == "album":
            out["albums"].append(it["album"])
        elif k == "artist":
            out["artists"].append(it["artist"])
        elif k == "playlist":
            out["playlists"].append(it["playlist"])
    return out


def op_suggest(q):
    return {"queries": [s for s in yt().get_search_suggestions(q.get("q", "")) if isinstance(s, str)][:10], "items": []}


def watch(video_id: str, limit: int = 25, radio: bool = False, playlist_id: str | None = None):
    return yt().get_watch_playlist(videoId=video_id, playlistId=playlist_id, limit=limit, radio=radio)


def related_shelves(watch_result):
    rid = watch_result.get("related")
    if not rid:
        return []
    out = []
    for i, sec in enumerate(yt().get_song_related(rid) or []):
        s = shelf(f"related-{i}-{slug(sec.get('title'))}", sec.get("title"), sec.get("contents"))
        if s:
            out.append(s)
    return out


def op_track(q):
    vid = q.get("id", "")
    w = watch(vid, limit=1)
    first = next((t for t in w.get("tracks", []) if t.get("videoId") == vid), None)
    if not first:
        raise HttpError(404, "not_found", "Song not found")
    t = track(first)
    if not t:
        raise HttpError(404, "not_found", "Song not found")
    try:
        rel = related_shelves(w)
    except Exception:
        rel = []
    return {"track": t, "related": rel}


def op_related(q):
    return related_shelves(watch(q.get("id", ""), limit=1))


def op_lyrics(q):
    w = watch(q.get("id", ""), limit=1)
    lid = w.get("lyrics")
    if not lid:
        return None
    try:
        lyr = yt().get_lyrics(lid, timestamps=True)
    except Exception:
        lyr = yt().get_lyrics(lid)
    if not lyr or not lyr.get("lyrics"):
        return None
    body = lyr["lyrics"]
    if lyr.get("hasTimestamps") and isinstance(body, list):
        lines = [clean({"text": l.text, "startMs": int(l.start_time), "endMs": int(l.end_time)}) for l in body]
        return clean({"lines": lines, "timing": "synced", "source": "YouTube Music", "attribution": lyr.get("source")})
    text = body if isinstance(body, str) else "\n".join(getattr(l, "text", str(l)) for l in body)
    return clean({"lines": [{"text": l} for l in text.split("\n")], "timing": "none", "source": "YouTube Music", "attribution": lyr.get("source")})


def op_album(q):
    bid = q.get("id", "")
    a = yt().get_album(bid)
    alb = album(dict(a, browseId=bid, playlistId=a.get("audioPlaylistId")))
    if not alb:
        raise HttpError(404, "not_found", "Album not found")
    tracks = [t for t in (track(x, alb) for x in a.get("tracks", [])) if t]
    others = [x for x in (album(o) for o in (a.get("other_versions") or [])) if x]
    desc = a.get("description")
    return clean({
        "album": alb, "description": desc if isinstance(desc, str) and desc else None,
        "subtitle": " • ".join(x for x in [a.get("type"), str(a.get("year") or "") or None, f"{a.get('trackCount')} songs" if a.get("trackCount") else None] if x) or None,
        "tracks": tracks, "totalDurationSec": a.get("duration_seconds") or sum(t.get("durationSec", 0) for t in tracks) or None,
        "otherVersions": others,
    })


def op_artist(q):
    cid = q.get("id", "")
    a = yt().get_artist(cid)
    art_obj = artist(dict(a, browseId=cid))
    if not art_obj:
        raise HttpError(404, "not_found", "Artist not found")
    top = [t for t in (track(x) for x in ((a.get("songs") or {}).get("results") or [])) if t]
    shelves = []
    for key, title in (("albums", "Albums"), ("singles", "Singles & EPs"), ("videos", "Videos"), ("playlists", "Featured on"), ("related", "Fans might also like")):
        sec = a.get(key) or {}
        contents = sec.get("results") or []
        if key in ("albums", "singles"):
            contents = [dict(x, resultType="album") for x in contents]
        elif key == "related":
            contents = [dict(x, resultType="artist") for x in contents]
        elif key == "playlists":
            contents = [dict(x, resultType="playlist") for x in contents]
        s = shelf(f"artist-{key}", title, contents, "carousel")
        if s:
            shelves.append(s)
    desc = a.get("description")
    return clean({
        "artist": art_obj, "description": desc if isinstance(desc, str) and desc else None,
        "bannerUrl": art(a.get("thumbnails"), 1440), "topTracks": top, "shelves": shelves,
        "radioPlaylistId": a.get("radioId"), "shufflePlaylistId": a.get("shuffleId"),
    })


def op_playlist(q):
    pid = q.get("id", "")
    p = yt().get_playlist(pid, limit=300)
    pl = playlist(dict(p, playlistId=pid))
    if not pl:
        raise HttpError(404, "not_found", "Playlist not found")
    tracks = [t for t in (track(x) for x in p.get("tracks", [])) if t]
    return clean({"playlist": pl, "tracks": tracks, "totalDurationSec": p.get("duration_seconds") or sum(t.get("durationSec", 0) for t in tracks) or None})


def op_radio(q):
    vid, pid = q.get("trackId"), q.get("playlistId")
    if not vid and not pid:
        raise HttpError(400, "bad_request", "trackId or playlistId required")
    w = watch(vid, limit=50, radio=bool(vid and not pid), playlist_id=pid)
    tracks = [t for t in (track(x) for x in w.get("tracks", [])) if t]
    return clean({"tracks": tracks, "playlistId": w.get("playlistId")})


def op_health(q):
    return {"ok": True, "ytmusicapi": True}


ROUTES = {
    "/home": op_home, "/explore": op_explore, "/browse": op_browse, "/search": op_search,
    "/suggestions": op_suggest, "/track": op_track, "/related": op_related, "/lyrics": op_lyrics,
    "/album": op_album, "/artist": op_artist, "/playlist": op_playlist, "/radio": op_radio,
    "/health": op_health,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "neo-ytmusicapi/1"

    def log_message(self, fmt, *args):  # quiet: the Node API logs requests
        pass

    def reply(self, status: int, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        op = ROUTES.get(url.path)
        if not op:
            return self.reply(404, {"error": {"code": "not_found", "message": "Unknown endpoint"}})
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            return self.reply(200, op(q))
        except HttpError as e:
            return self.reply(e.status, {"error": {"code": e.code, "message": e.message}})
        except Exception as e:  # ytmusicapi raises plain exceptions for missing items and upstream errors
            msg = str(e) or e.__class__.__name__
            missing = isinstance(e, (KeyError, IndexError)) or re.search(r"not found|does not exist|invalid", msg, re.I)
            if os.environ.get("YTMUSICAPI_DEBUG"):
                traceback.print_exc()
            # Never pass ytmusicapi's internals (parser paths, raw responses) to the API.
            body = {"code": "not_found", "message": "Not found"} if missing else {"code": "provider_unavailable", "message": "ytmusicapi couldn't load this right now"}
            return self.reply(404 if missing else 502, {"error": body})


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    print(f"ytmusicapi helper listening on http://{HOST}:{PORT} (location={LOCATION}, language={LANGUAGE})", file=sys.stderr, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
