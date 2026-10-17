import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LibraryView } from "@/components/pages/LibraryView";
import { LIBRARY_TABS, type LibraryTab } from "@/lib/libraryTabs";

type Props = { params: Promise<{ tab: string }> };
export const metadata: Metadata = { title: "Library", robots: { index: false } };
export default async function Page({ params }: Props) {
  const { tab } = await params;
  if (!LIBRARY_TABS.some((t) => t.id === tab)) notFound();
  return <Suspense><LibraryView tab={tab as LibraryTab} /></Suspense>;
}
