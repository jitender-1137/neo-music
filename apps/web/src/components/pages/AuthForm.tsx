"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "../ui/Button";
import { Logo } from "../shell/Logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { login, register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (signup) await register(email, password, name.trim() || email.split("@")[0]!);
      else await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const field = "h-12 w-full rounded-lg glass px-4 outline-none ring-1 ring-transparent focus:ring-focus";
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-10">
      <Logo className="self-center" />
      <div className="text-center">
        <h1 className="text-2xl font-bold">{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted">{signup ? "Sync your library, playlists and history across devices." : "Sign in to your Neo Music account."}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {signup && <label className="flex flex-col gap-1 text-sm">Name<input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} /></label>}
        <label className="flex flex-col gap-1 text-sm">Email<input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required inputMode="email" /></label>
        <label className="flex flex-col gap-1 text-sm">Password
          <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : 1} maxLength={200} aria-describedby={signup ? "pw-hint" : undefined} />
          {signup && <span id="pw-hint" className="text-xs text-muted">At least 10 characters.</span>}
        </label>
        {error && <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-2">{signup ? "Create account" : "Sign in"}</Button>
      </form>
      <p className="text-center text-sm text-muted">
        {signup ? <>Already have an account? <Link className="text-foreground underline" href="/login">Sign in</Link></> : <>New to Neo Music? <Link className="text-foreground underline" href="/signup">Create an account</Link></>}
      </p>
      <p className="text-center text-xs text-subtle">Anything you saved as a guest on this device moves into your account when you sign in.</p>
    </div>
  );
}
