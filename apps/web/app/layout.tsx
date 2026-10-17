import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/shell/Providers";
import { AppShell } from "@/components/shell/AppShell";
import { THEME_BOOT_SCRIPT } from "@/lib/prefs";

export const metadata: Metadata = {
  title: { default: "Neo Music", template: "%s · Neo Music" },
  description: "Stream music, discover new favorites, and keep your library everywhere.",
  applicationName: "Neo Music",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Neo Music", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: { icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // App-like: no pinch / double-tap zoom (requested). iOS Safari ignores these two, see ZoomLock.
  maximumScale: 1,
  userScalable: false,
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0f0e17" }, { media: "(prefers-color-scheme: light)", color: "#f9f8fc" }],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className="theme-switching" suppressHydrationWarning>
      <head>
        {/* Runs synchronously before first paint: the saved theme is applied with no dark→light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
