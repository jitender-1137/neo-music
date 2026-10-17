"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { addSearch, db, newestFirst } from "@/lib/guestDb";
import { track } from "@/lib/events";

/** Signed in → server search history; guest → this device only. */
export function useRecentSearches() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["recent-searches", user?.id ?? "guest"];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => user
      ? (await api.get<{ queries: string[] }>("/api/v1/search/history")).queries
      : (await newestFirst("searches", 20).catch(() => [])).map((s) => s.q),
    staleTime: 60_000,
  });
  return {
    recent: q.data ?? [],
    async record(query: string) {
      const v = query.trim().slice(0, 200);
      if (!v) return;
      if (user) void track({ type: "search", context: { query: v } });
      else await addSearch(v).catch(() => undefined);
      qc.setQueryData<string[]>(key, (old) => [v, ...(old ?? []).filter((x) => x !== v)].slice(0, 20));
    },
    async remove(query?: string) {
      if (user) await api.del(`/api/v1/search/history${query ? `?q=${encodeURIComponent(query)}` : ""}`).catch(() => undefined);
      else {
        const d = await db();
        if (query) await d.delete("searches", query); else await d.clear("searches");
      }
      qc.setQueryData<string[]>(key, (old) => (query ? (old ?? []).filter((x) => x !== query) : []));
    },
  };
}
