import type { BrowsePage } from "@zuno/core";
import { serverGet } from "@/lib/serverApi";
import { HomeView } from "@/components/pages/HomeView";

export const revalidate = 300;

/** The public home feed is server-rendered (fast LCP); personalization swaps in on the client. */
export default async function Page() {
  const initial = await serverGet<BrowsePage>("/api/v1/home", { revalidate: 300 }).catch(() => undefined);
  return <HomeView initial={initial} />;
}
