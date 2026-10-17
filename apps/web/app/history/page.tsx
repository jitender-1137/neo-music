import type { Metadata } from "next";
import { HistoryView } from "@/components/pages/LibraryView";
export const metadata: Metadata = { title: "History", robots: { index: false } };
export default function Page() { return <HistoryView />; }
