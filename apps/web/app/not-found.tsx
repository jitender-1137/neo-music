import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-muted">That page doesn't exist or isn't available.</p>
      <Link href="/" className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background">Go home</Link>
    </div>
  );
}
