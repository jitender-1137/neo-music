import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaylistPage } from "@zuno/core";
import { ApiError } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import { PlaylistView } from "@/components/pages/CollectionViews";

type Props = { params: Promise<{ id: string }> };
async function load(id: string) {
  try { return await serverGet<PlaylistPage>(`/api/v1/playlists/${encodeURIComponent(id)}`, { revalidate: 900 }); }
  catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); return undefined; }
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).id);
  return p ? { title: p.playlist.title, openGraph: { images: p.playlist.artworkUrl ? [p.playlist.artworkUrl] : [] } } : { title: "Playlist" };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  return <PlaylistView id={id} initial={await load(id)} />;
}
