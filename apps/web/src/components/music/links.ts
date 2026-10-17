import type { Album, Artist, Playlist, Track } from "@zuno/core";
export const albumHref = (a: Pick<Album, "id">) => `/album/${encodeURIComponent(a.id)}`;
export const artistHref = (a: Pick<Artist, "id">) => `/artist/${encodeURIComponent(a.id)}`;
export const playlistHref = (p: Pick<Playlist, "id">) => `/playlist/${encodeURIComponent(p.id)}`;
export const trackHref = (t: Pick<Track, "id">) => `/song/${encodeURIComponent(t.id)}`;
export const userPlaylistHref = (id: string) => `/my/playlist/${encodeURIComponent(id)}`;
