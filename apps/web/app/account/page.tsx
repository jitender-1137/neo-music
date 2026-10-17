import type { Metadata } from "next";
import { AccountView } from "@/components/pages/SettingsView";
export const metadata: Metadata = { title: "Account", robots: { index: false } };
export default function Page() { return <AccountView />; }
