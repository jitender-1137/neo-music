"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AudioQuality } from "@zuno/core";
import { api } from "./api";
import { migrateGuestData } from "./library";
import { setPlayerSignedIn } from "./player";

export interface User { id: string; email: string; displayName: string; createdAt: string }
export interface ServerPrefs { audioQuality: AudioQuality; hideExplicit: boolean; seedArtists: { id: string; name: string }[] }
type Me = { user: User | null; preferences: ServerPrefs | null };

interface AuthCtx {
  user: User | null;
  preferences: ServerPrefs | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => api.get<Me>("/api/v1/auth/me", { signal }), staleTime: 5 * 60_000, retry: 1 });
  const user = me.data?.user ?? null;
  useEffect(() => { setPlayerSignedIn(!!user); }, [user]);

  async function afterSignIn(u: User) {
    qc.setQueryData<Me>(["me"], (old) => ({ user: u, preferences: old?.preferences ?? null }));
    setPlayerSignedIn(true);
    try {
      const imported = await migrateGuestData(u.id);
      if (imported) {
        const n = imported.likes + imported.albums + imported.artists + imported.playlists + imported.savedPlaylists;
        if (n > 0) toast.success(`Moved ${n} saved item${n === 1 ? "" : "s"} from this device to your account`);
      }
    } catch {
      toast.error("Couldn't move this device's library to your account yet — it's kept safe here and we'll retry.");
    }
    await qc.invalidateQueries();
  }

  const loginM = useMutation({
    mutationFn: (v: { email: string; password: string }) => api.post<{ user: User }>("/api/v1/auth/login", v),
    onSuccess: (r) => afterSignIn(r.user),
  });
  const registerM = useMutation({
    mutationFn: (v: { email: string; password: string; displayName: string }) => api.post<{ user: User }>("/api/v1/auth/register", v),
    onSuccess: (r) => afterSignIn(r.user),
  });

  const value: AuthCtx = {
    user,
    preferences: me.data?.preferences ?? null,
    loading: me.isPending,
    login: async (email, password) => { await loginM.mutateAsync({ email, password }); },
    register: async (email, password, displayName) => { await registerM.mutateAsync({ email, password, displayName }); },
    logout: async () => {
      await api.post("/api/v1/auth/logout");
      setPlayerSignedIn(false);
      qc.setQueryData<Me>(["me"], { user: null, preferences: null });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      toast("Signed out");
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
