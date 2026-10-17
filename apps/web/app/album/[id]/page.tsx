import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { AlbumPage } from "@zuno/core";
import { ApiError } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import { AlbumView } from "@/components/pages/CollectionViews";

type Props = { params: Promise<{ id: string }> };
async function load(id: string) {
  try { return await serverGet<AlbumPage>(`/api/v1/albums/${encodeURIComponent(id)}`, { revalidate: 3600 }); }
  catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); return undefined; }
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await load((await params).id);
  return a ? { title: `${a.album.title} – ${a.album.artist}`, openGraph: { images: a.album.artworkUrl ? [a.album.artworkUrl] : [] } } : { title: "Album" };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  return <AlbumView id={id} initial={await load(id)} />;
}
