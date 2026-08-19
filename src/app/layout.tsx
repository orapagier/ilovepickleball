import type { Metadata, Viewport } from "next";
/* Fraunces is loaded with every axis — the display face is set soft and wonky
   at headline sizes and plain at small ones, which the wght-only build can't
   do. Manrope carries the whole interface, numerals included. */
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/manrope";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Smash Zone Pickleball Tagum — Book a Court",
  description: "Reserve a pickleball court online at Smash Zone Pickleball Tagum.",
};

/* Installed to the home screen this behaves like an app, so the status bar
   takes the page's own colour and the layout runs into the safe areas. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#221824" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <SiteHeader />
        {/* The tab bar is fixed, so the page pays for its own clearance. */}
        <main className="flex flex-1 flex-col pb-tabbar md:pb-0">{children}</main>
      </body>
    </html>
  );
}
