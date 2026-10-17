import type { Metadata } from "next";
import { AuthForm } from "@/components/pages/AuthForm";
export const metadata: Metadata = { title: "Create account", robots: { index: false } };
export default function Page() { return <AuthForm mode="signup" />; }
