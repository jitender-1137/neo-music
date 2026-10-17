import type { Metadata } from "next";
import { UserPlaylistView } from "@/components/pages/UserPlaylistView";
export const metadata: Metadata = { title: "Playlist", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <UserPlaylistView id={(await params).id} />;
}
