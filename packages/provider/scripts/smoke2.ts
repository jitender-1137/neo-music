import { YouTubeMusicProvider } from "../src/youtube";
const p = new YouTubeMusicProvider();
const r = await p.search("coldplay", "all"); console.log(r.tracks.slice(0,3).map(t=>`${t.title} — ${t.artist} [${t.album}]`), r.top);
const s = await p.search("tum hi ho", "song"); const c = await p.search("tum hi ho", "song", s.continuation); console.log("cont", c.tracks.length, c.tracks[0]?.title, !!c.continuation);
const pl = await p.getPlaylist("RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs"); console.log("owner", pl.playlist.owner, pl.playlist.trackCountText);
const pl2 = await p.getPlaylist("PLqD7PHj-22mTEpOpByvfl114ixsCFPTyH"); console.log("pl2", pl2.playlist.title, pl2.playlist.owner, pl2.tracks.length, !!pl2.continuation);
if (pl2.continuation) { const n = await p.getPlaylist("x", pl2.continuation); console.log("pl2 cont", n.tracks.length); }
process.exit(0);
