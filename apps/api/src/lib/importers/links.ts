/**
 * Recognise a pasted link and say what it points at. Pure — never fetches user-supplied URLs
 * (short links are resolved separately against an allow-list).
 */
export type LinkTarget =
  | { platform: "youtube"; kind: "playlist"; id: string }
  | { platform: "youtube"; kind: "album"; id: string }
  | { platform: "youtube"; kind: "track"; id: string }
  | { platform: "deezer"; kind: "playlist" | "album"; id: string }
  | { platform: "spotify"; kind: "playlist" | "album"; id: string }
  | { platform: "apple_music"; kind: "playlist" | "album"; id: string }
  | { platform: "short"; host: string; url: string };

export const SHORT_LINK_HOSTS = new Set(["deezer.page.link", "link.deezer.com", "spotify.link", "spoti.fi", "youtu.be"]);

export function parseImportLink(raw: string): LinkTarget | null {
  const text = raw.trim();
  const sp = /^spotify:(playlist|album):([A-Za-z0-9]{10,40})$/.exec(text);
  if (sp) return { platform: "spotify", kind: sp[1] as "playlist" | "album", id: sp[2]! };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const path = u.pathname;

  if (host === "youtube.com" || host === "youtu.be") {
    if (host === "youtu.be") {
      const id = path.slice(1).split("/")[0] ?? "";
      const list = u.searchParams.get("list");
      if (list) return { platform: "youtube", kind: "playlist", id: list };
      return /^[\w-]{11}$/.test(id) ? { platform: "youtube", kind: "track", id } : null;
    }
    const list = u.searchParams.get("list");
    if (list && /^[\w-]{10,64}$/.test(list)) return { platform: "youtube", kind: "playlist", id: list.replace(/^VL/, "") };
    const browse = /^\/browse\/((?:MPRE|VL)[\w-]+)/.exec(path);
    if (browse) return browse[1]!.startsWith("MPRE") ? { platform: "youtube", kind: "album", id: browse[1]! } : { platform: "youtube", kind: "playlist", id: browse[1]!.slice(2) };
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return { platform: "youtube", kind: "track", id: v };
    return null;
  }
  if (host === "deezer.com") {
    const m = /\/(playlist|album)\/(\d{1,20})/.exec(path);
    return m ? { platform: "deezer", kind: m[1] as "playlist" | "album", id: m[2]! } : null;
  }
  if (host === "open.spotify.com" || host === "play.spotify.com") {
    const m = /\/(playlist|album)\/([A-Za-z0-9]{10,40})/.exec(path);
    return m ? { platform: "spotify", kind: m[1] as "playlist" | "album", id: m[2]! } : null;
  }
  if (host === "apple.com" && u.hostname.startsWith("music.")) {
    const m = /\/(playlist|album)\/[^/]*\/((?:pl\.)?[\w.-]+)/.exec(path);
    return m ? { platform: "apple_music", kind: m[1] as "playlist" | "album", id: m[2]! } : null;
  }
  if (SHORT_LINK_HOSTS.has(u.hostname)) return { platform: "short", host: u.hostname, url: u.toString() };
  return null;
}
