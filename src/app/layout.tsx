import type { Metadata } from "next";
import "./globals.css";

// Every page is behind a login and reads the session, so nothing is prerendered.
export const instant = false;

export const metadata: Metadata = { title: "Energy Central Client Portal", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
