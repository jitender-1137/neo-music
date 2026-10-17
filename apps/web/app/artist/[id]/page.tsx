import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ArtistPage } from "@zuno/core";
import { ApiError } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import { ArtistView } from "@/components/pages/CollectionViews";

type Props = { params: Promise<{ id: string }> };
async function load(id: string) {
  try { return await serverGet<ArtistPage>(`/api/v1/artists/${encodeURIComponent(id)}`, { revalidate: 1800 }); }
  catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound(); return undefined; }
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await load((await params).id);
  return a ? { title: a.artist.name, openGraph: { images: a.artist.artworkUrl ? [a.artist.artworkUrl] : [] } } : { title: "Artist" };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  return <ArtistView id={id} initial={await load(id)} />;
}
