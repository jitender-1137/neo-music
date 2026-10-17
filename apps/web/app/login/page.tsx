import type { Metadata } from "next";
import { AuthForm } from "@/components/pages/AuthForm";
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };
export default function Page() { return <AuthForm mode="login" />; }
