export const metadata = { title: "Offline" };
export default function Page() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">You're offline</h1>
      <p className="max-w-sm text-muted">Neo Music needs a connection to stream. Your library and queue are safe — reconnect and pick up where you left off.</p>
    </div>
  );
}
