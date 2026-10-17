import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchView } from "@/components/pages/SearchView";

type Props = { searchParams: Promise<{ q?: string }> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `${q} – Search` : "Search", robots: { index: false } };
}
export default function Page() {
  return <Suspense><SearchView /></Suspense>;
}
