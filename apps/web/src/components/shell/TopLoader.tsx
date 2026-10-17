"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * YouTube-style loading line at the very top (below the iPhone status bar): starts the moment a
 * navigation begins — any in-app link click or router.push/replace — creeps towards 90% while the
 * next page loads, then completes and fades once the URL has changed. Never blocks input.
 */
export function TopLoader() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [progress, setProgress] = useState(0); // 0..1
  const [visible, setVisible] = useState(false);
  const loading = useRef(false);
  const trickle = useRef(0);
  const safety = useRef(0);
  const hideTimer = useRef(0);

  const finish = () => {
    if (!loading.current) return;
    loading.current = false;
    window.clearInterval(trickle.current);
    window.clearTimeout(safety.current);
    setProgress(1);
    hideTimer.current = window.setTimeout(() => { setVisible(false); setProgress(0); }, 320);
  };
  const startRef = useRef(() => {});
  startRef.current = () => {
    if (loading.current) return;
    loading.current = true;
    window.clearTimeout(hideTimer.current);
    setVisible(true);
    setProgress(0.12);
    // Ease towards 90%: fast at first, slower as it gets closer (never "finishes" on its own).
    trickle.current = window.setInterval(() => setProgress((p) => Math.min(0.9, p + (0.9 - p) * 0.12)), 220);
    safety.current = window.setTimeout(finish, 12_000);
  };

  // Every programmatic navigation goes through the shared App Router instance.
  useEffect(() => {
    const r = router as typeof router & { __topLoader?: boolean };
    if (r.__topLoader) return;
    r.__topLoader = true;
    const push = r.push.bind(r), replace = r.replace.bind(r);
    const sameUrl = (href: string) => { try { const u = new URL(href, location.href); return u.pathname === location.pathname && u.search === location.search; } catch { return false; } };
    r.push = (href, opts) => { if (!sameUrl(href)) startRef.current(); return push(href, opts); };
    r.replace = (href, opts) => { if (!sameUrl(href)) startRef.current(); return replace(href, opts); };
  }, [router]);

  // In-app link clicks (Next <Link>, plain <a> to our own pages).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      startRef.current();
    };
    // Capture phase: by the bubble phase the tapped element may already be replaced (e.g. the tab
    // bar swaps a tab's icon for its bold variant), and could no longer find its link.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The URL changed → the new page has rendered (or its loading skeleton has): complete the line.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { finish(); }, [pathname, search]);
  useEffect(() => () => { window.clearInterval(trickle.current); window.clearTimeout(safety.current); window.clearTimeout(hideTimer.current); }, []);

  return (
    <div aria-hidden data-top-loader={visible ? "on" : "off"}
      className="pointer-events-none fixed inset-x-0 top-[var(--safe-top)] z-[70] h-[3px] transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}>
      <div className="h-full origin-left bg-[var(--song-accent)] shadow-[0_0_10px_var(--song-accent)] transition-transform duration-200 ease-out"
        style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
