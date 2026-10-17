import type { Metadata } from "next";
import type { BrowsePage } from "@zuno/core";
import { serverGet } from "@/lib/serverApi";
import { BrowseView } from "@/components/pages/ExploreView";

type Props = { params: Promise<{ browseId: string }>; searchParams: Promise<{ params?: string; title?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { title } = await searchParams;
  return { title: title ?? "Explore" };
}

export default async function Page({ params, searchParams }: Props) {
  const { browseId } = await params;
  const sp = await searchParams;
  const qs = sp.params ? `?params=${encodeURIComponent(sp.params)}` : "";
  const initial = await serverGet<BrowsePage>(`/api/v1/browse/${encodeURIComponent(browseId)}${qs}`, { revalidate: 1800 }).catch(() => undefined);
  return <BrowseView browseId={browseId} params={sp.params} title={sp.title} initial={initial} />;
}
