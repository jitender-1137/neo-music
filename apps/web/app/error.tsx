"use client";
import { useEffect } from "react";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="flex flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-sm text-muted">This page hit an unexpected error. Playback isn't affected.</p>
      <button onClick={reset} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background">Try again</button>
    </div>
  );
}
