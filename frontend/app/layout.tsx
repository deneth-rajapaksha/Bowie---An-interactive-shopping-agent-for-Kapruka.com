import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BowieAgent | Kapruka Shopping Chat",
  description: "Full-screen conversational shopping frontend for Kapruka."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
