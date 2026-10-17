import { describe, expect, it } from "vitest";
import { parseAppleTxt, parseAppleXml, parseCsv, parseImportFile, parseJson, parseM3u, parsePls, parseText, splitLine, youtubeIdFrom } from "./importParsers";

describe("line helpers", () => {
  it("splits common formats", () => {
    expect(splitLine("The Beatles - Hey Jude")).toEqual({ artist: "The Beatles", title: "Hey Jude" });
    expect(splitLine("12. Daft Punk – One More Time")).toEqual({ artist: "Daft Punk", title: "One More Time" });
    expect(splitLine("Blinding Lights by The Weeknd")).toEqual({ title: "Blinding Lights", artist: "The Weeknd" });
    expect(splitLine("  ")).toBeNull();
    expect(youtubeIdFrom("https://www.youtube.com/watch?v=fsiPzT50ZiM&t=3")).toBe("fsiPzT50ZiM");
    expect(youtubeIdFrom("https://youtu.be/fsiPzT50ZiM")).toBe("fsiPzT50ZiM");
  });
});

describe("CSV", () => {
  it("Exportify (Spotify)", () => {
    const csv = `"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)","ISRC"\n"spotify:track:1","Hey Jude - Remastered 2015","The Beatles","1","429000","GBAYE0601690"\n"spotify:track:2","One Kiss (with Dua Lipa)","Calvin Harris, Dua Lipa","One Kiss","214000","GBARL1800368"`;
    const r = parseCsv(csv, "Liked_Songs.csv");
    expect(r.collections[0]).toMatchObject({ name: "Liked Songs", kind: "liked", source: "csv" });
    expect(r.collections[0]!.items[1]).toMatchObject({ title: "One Kiss (with Dua Lipa)", artist: "Calvin Harris, Dua Lipa", durationSec: 214, isrc: "GBARL1800368" });
  });
  it("TuneMyMusic with several playlists in one file", () => {
    const csv = "Track name,Artist name,Album,Playlist name,Type,ISRC\nHello,Adele,25,Chill,Playlist,\nYellow,Coldplay,Parachutes,Road,Playlist,\nClocks,Coldplay,A Rush,Road,Playlist,";
    const r = parseCsv(csv, "export.csv");
    expect(r.collections.map((c) => [c.name, c.items.length])).toEqual([["Chill", 1], ["Road", 2]]);
  });
  it("Google Takeout (YouTube Music)", () => {
    const csv = "Video ID,Playlist Video Creation Timestamp\nfsiPzT50ZiM,2024-01-01T00:00:00+00:00\nnotAnId,x";
    const r = parseCsv(csv, "Road trip-videos.csv");
    expect(r.collections[0]).toMatchObject({ name: "Road trip", source: "takeout" });
    expect(r.collections[0]!.items).toEqual([{ title: "fsiPzT50ZiM", artist: "", album: undefined, catalogId: "fsiPzT50ZiM" }]);
  });
  it("explains unusable CSVs", () => {
    expect(parseCsv("foo,bar\n1,2", "x.csv").warnings[0]).toMatch(/Title/);
  });
});

describe("Apple Music", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Major Version</key><integer>1</integer>
  <key>Tracks</key><dict>
    <key>101</key><dict><key>Track ID</key><integer>101</integer><key>Name</key><string>Yellow</string><key>Artist</key><string>Coldplay</string><key>Album</key><string>Parachutes</string><key>Total Time</key><integer>266000</integer></dict>
    <key>102</key><dict><key>Track ID</key><integer>102</integer><key>Name</key><string>Hello &amp; Goodbye</string><key>Artist</key><string>Adele</string></dict>
  </dict>
  <key>Playlists</key><array>
    <dict><key>Name</key><string>Evening</string><key>Playlist Items</key><array>
      <dict><key>Track ID</key><integer>102</integer></dict><dict><key>Track ID</key><integer>101</integer></dict>
    </array></dict>
  </array>
</dict></plist>`;
  it("reads the XML export in playlist order", () => {
    const r = parseAppleXml(xml, "Evening.xml");
    expect(r.collections[0]!.name).toBe("Evening");
    expect(r.collections[0]!.items).toEqual([
      { title: "Hello & Goodbye", artist: "Adele", album: undefined, durationSec: undefined },
      { title: "Yellow", artist: "Coldplay", album: "Parachutes", durationSec: 266 },
    ]);
  });
  it("reads the plain-text export", () => {
    const txt = "Name\tArtist\tComposer\tAlbum\tGrouping\tTime\nYellow\tColdplay\t\tParachutes\t\t266\n";
    expect(parseAppleTxt(txt, "Mix.txt").collections[0]!.items[0]).toMatchObject({ title: "Yellow", artist: "Coldplay", durationSec: 266 });
    expect(parseImportFile(txt, "Mix.txt").collections[0]!.source).toBe("apple_music");
  });
});

describe("M3U / PLS / text / JSON", () => {
  it("M3U with EXTINF, paths and YouTube links", () => {
    const m3u = "#EXTM3U\n#PLAYLIST:Gym\n#EXTINF:215,Daft Punk - One More Time\nmusic/one.mp3\nmusic/Coldplay/Parachutes/03 - Yellow.flac\nhttps://youtu.be/fsiPzT50ZiM\n";
    const r = parseM3u(m3u, "x.m3u");
    expect(r.collections[0]!.name).toBe("Gym");
    expect(r.collections[0]!.items.map((i) => [i.artist, i.title, i.catalogId])).toEqual([["Daft Punk", "One More Time", undefined], ["", "Yellow", undefined], ["", "fsiPzT50ZiM", "fsiPzT50ZiM"]]);
  });
  it("PLS", () => {
    const pls = "[playlist]\nFile1=a.mp3\nTitle1=Adele - Hello\nLength1=295\nNumberOfEntries=1";
    expect(parsePls(pls, "p.pls").collections[0]!.items[0]).toMatchObject({ title: "Hello", artist: "Adele", durationSec: 295 });
  });
  it("pasted text", () => {
    expect(parseText("Adele - Hello\n\nYellow by Coldplay\n").collections[0]!.items).toHaveLength(2);
  });
  it("Neo Music export JSON", () => {
    const json = JSON.stringify({ playlists: [{ title: "Mine", tracks: [{ trackId: "abc" }] }], likes: [{ itemId: "xyz" }] });
    const r = parseJson(json, "neo.json");
    expect(r.collections.map((c) => [c.name, c.kind, c.items[0]!.catalogId])).toEqual([["Liked music", "liked", "xyz"], ["Mine", "playlist", "abc"]]);
  });
});
