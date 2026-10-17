"use client";
import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ApiError } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LibraryProvider } from "@/lib/library";
import { PlayerProvider } from "@/lib/player";
import { applyTheme, usePrefs } from "@/lib/prefs";

function ThemeController() {
  const { theme } = usePrefs();
  // Colour transitions stay off until the app has hydrated (no fade-in of the theme on load).
  useEffect(() => { requestAnimationFrame(() => document.documentElement.classList.remove("theme-switching")); }, []);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
  return null;
}

function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // Production HTTPS (or localhost) only. Cache budget (MB) is configurable per deployment.
    const budget = process.env.NEXT_PUBLIC_CACHE_BUDGET_MB ?? "250";
    navigator.serviceWorker.register(`/sw.js?budget=${encodeURIComponent(budget)}`, { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

function LibraryGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <LibraryProvider signedIn={!!user}>{children}</LibraryProvider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // Bounded retries; never retry client errors (4xx) — they won't fix themselves.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
      },
    },
  }));
  return (
    <QueryClientProvider client={qc}>
      <Tooltip.Provider delayDuration={400}>
        <ThemeController />
        <ServiceWorker />
        <AuthProvider>
          <LibraryGate>
            <PlayerProvider>{children}</PlayerProvider>
          </LibraryGate>
        </AuthProvider>
        <Toaster position="bottom-center" offset={96} mobileOffset={{ bottom: "calc(var(--m-mini-bottom) + var(--m-mini-h) + 0.5rem)" }} toastOptions={{ className: "!glass-panel !text-foreground !border-0 !rounded-2xl" }} />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
