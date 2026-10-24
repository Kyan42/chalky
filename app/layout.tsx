import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chalky",
  description: "Ask out loud; Chalky teaches it back on a whiteboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
