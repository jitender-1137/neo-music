"use client";
import { useInfiniteQuery, useQuery, keepPreviousData } from "@tanstack/react-query";
import type { AlbumPage, ArtistPage, BrowsePage, Lyrics, PlaylistPage, SearchFilter, SearchResults, Shelf, ShelfItem, TrackDetail } from "@zuno/core";
import { api, qs } from "./api";

const enc = encodeURIComponent;
export const qk = {
  home: (seeds: string) => ["home", seeds] as const,
  explore: ["explore"] as const,
  browse: (id: string, params?: string) => ["browse", id, params ?? ""] as const,
  search: (q: string, f: SearchFilter) => ["search", q, f] as const,
  suggest: (q: string) => ["suggest", q] as const,
  album: (id: string) => ["album", id] as const,
  artist: (id: string) => ["artist", id] as const,
  playlist: (id: string) => ["playlist", id] as const,
  track: (id: string) => ["track", id] as const,
  related: (id: string) => ["related", id] as const,
  lyrics: (id: string) => ["lyrics", id] as const,
};

export type HomePage = BrowsePage & { personalized: boolean; configVersion: string };

export function useHome(seeds: string[], enabled = true) {
  const key = seeds.join(",");
  return useQuery({
    queryKey: qk.home(key),
    queryFn: ({ signal }) => api.get<HomePage>(`/api/v1/recommendations/home${qs({ seeds: key })}`, { signal }),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useHomeChip(chip: string | null) {
  return useQuery({
    queryKey: ["home-chip", chip],
    queryFn: ({ signal }) => api.get<BrowsePage>(`/api/v1/home${qs({ chip })}`, { signal }),
    enabled: !!chip,
    staleTime: 10 * 60_000,
  });
}

export function useHomeMore(continuation: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["home-more", continuation],
    initialPageParam: continuation,
    queryFn: ({ pageParam, signal }) => api.get<BrowsePage>(`/api/v1/home${qs({ continuation: pageParam })}`, { signal }),
    getNextPageParam: (last) => last.continuation,
    enabled: false,
  });
}

export const useExplore = (initial?: BrowsePage) => useQuery({ queryKey: qk.explore, queryFn: ({ signal }) => api.get<BrowsePage>("/api/v1/explore", { signal }), initialData: initial, staleTime: 10 * 60_000 });

export const useBrowse = (id: string, params?: string, initial?: BrowsePage) => useQuery({
  queryKey: qk.browse(id, params),
  queryFn: ({ signal }) => api.get<BrowsePage>(`/api/v1/browse/${enc(id)}${qs({ params })}`, { signal }),
  initialData: initial, staleTime: 30 * 60_000,
});

export function useSearch(q: string, filter: SearchFilter) {
  return useInfiniteQuery({
    queryKey: qk.search(q, filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.get<SearchResults>(`/api/v1/search${qs({ q, filter, continuation: pageParam })}`, { signal }),
    getNextPageParam: (last) => last.continuation,
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSuggestions(q: string) {
  return useQuery({
    queryKey: qk.suggest(q),
    queryFn: ({ signal }) => api.get<{ queries: string[]; items: ShelfItem[] }>(`/api/v1/search/suggestions${qs({ q })}`, { signal }),
    enabled: q.trim().length > 0,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export const useAlbum = (id: string, initial?: AlbumPage) => useQuery({ queryKey: qk.album(id), queryFn: ({ signal }) => api.get<AlbumPage>(`/api/v1/albums/${enc(id)}`, { signal }), initialData: initial, staleTime: 60 * 60_000 });
export const useArtist = (id: string, initial?: ArtistPage) => useQuery({ queryKey: qk.artist(id), queryFn: ({ signal }) => api.get<ArtistPage>(`/api/v1/artists/${enc(id)}`, { signal }), initialData: initial, staleTime: 30 * 60_000 });
export const useTrackDetail = (id: string, initial?: TrackDetail) => useQuery({ queryKey: qk.track(id), queryFn: ({ signal }) => api.get<TrackDetail>(`/api/v1/tracks/${enc(id)}`, { signal }), initialData: initial, staleTime: 60 * 60_000 });
export const useRelated = (id: string | undefined) => useQuery({ queryKey: qk.related(id ?? ""), queryFn: ({ signal }) => api.get<{ shelves: Shelf[] }>(`/api/v1/tracks/${enc(id!)}/related`, { signal }), enabled: !!id, staleTime: 60 * 60_000 });
export const useLyrics = (id: string | undefined) => useQuery({ queryKey: qk.lyrics(id ?? ""), queryFn: ({ signal }) => api.get<{ lyrics: Lyrics | null }>(`/api/v1/tracks/${enc(id!)}/lyrics`, { signal }), enabled: !!id, staleTime: 24 * 60 * 60_000, retry: 1 });

export function usePlaylist(id: string, initial?: PlaylistPage) {
  return useInfiniteQuery({
    queryKey: qk.playlist(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api.get<PlaylistPage>(`/api/v1/playlists/${enc(id)}${qs({ continuation: pageParam })}`, { signal }),
    getNextPageParam: (last) => last.continuation,
    initialData: initial ? { pages: [initial], pageParams: [undefined] } : undefined,
    staleTime: 10 * 60_000,
  });
}
