import { YouTubeMusicProvider } from "../src/youtube";
const p = new YouTubeMusicProvider();
const h = await p.getHome(); console.log("home", h.shelves.length, !!h.continuation);
const h2 = await p.getHome({ continuation: h.continuation }); console.log("home2", h2.shelves.map((s) => s.title), !!h2.continuation);
const h3 = h2.continuation ? await p.getHome({ continuation: h2.continuation }) : null; console.log("home3", h3?.shelves.map((s) => s.title));
const s1 = await p.search("lofi", "song"); console.log("s1", s1.tracks.length, !!s1.continuation);
const s2 = await p.search("lofi", "song", s1.continuation); console.log("s2", s2.tracks.length, s2.tracks[0]?.title, !!s2.continuation);
const s3 = await p.search("lofi", "album"); const s4 = await p.search("lofi", "album", s3.continuation); console.log("albums", s3.albums.length, s4.albums.length);
const big = await p.getPlaylist("PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i"); console.log("pl", big.playlist.title, big.tracks.length, !!big.continuation);
if (big.continuation) { const n = await p.getPlaylist("x", big.continuation); console.log("pl2", n.tracks.length, n.tracks[0]?.title, !!n.continuation); }
process.exit(0);
