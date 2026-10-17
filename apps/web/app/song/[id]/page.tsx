import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { TrackDetail } from "@zuno/core";
import { ApiError } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import { SongView } from "@/components/pages/CollectionViews";

type Props = { params: Promise<{ id: string }> };
async function load(id: string) {
  try { return await serverGet<TrackDetail>(`/api/v1/tracks/${encodeURIComponent(id)}`, { revalidate: 3600 }); }
  catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); return undefined; }
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await load((await params).id);
  return t ? { title: `${t.track.title} – ${t.track.artist}`, openGraph: { images: t.track.artworkUrl ? [t.track.artworkUrl] : [] } } : { title: "Song" };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  return <SongView id={id} initial={await load(id)} />;
}
