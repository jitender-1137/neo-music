import type { Metadata } from "next";
import { ImportView } from "@/components/pages/ImportView";
export const metadata: Metadata = { title: "Import music", robots: { index: false } };
export default function Page() { return <ImportView />; }
