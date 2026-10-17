import type { Metadata } from "next";
import type { BrowsePage } from "@zuno/core";
import { serverGet } from "@/lib/serverApi";
import { ExploreView } from "@/components/pages/ExploreView";

export const metadata: Metadata = { title: "Explore" };
export const revalidate = 600;

export default async function Page() {
  const initial = await serverGet<BrowsePage>("/api/v1/explore", { revalidate: 600 }).catch(() => undefined);
  return <ExploreView initial={initial} />;
}
