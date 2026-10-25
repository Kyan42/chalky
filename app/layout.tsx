import type { Metadata, Viewport } from "next";
import { ThemeAttribute } from "@/components/ThemeAttribute";
import { envTheme } from "@/lib/board/theme";
import "./globals.css";
import "./mobile.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Chalky",
  description: "Ask out loud; Chalky teaches it back on a whiteboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={envTheme().id}>
      <body>
        <ThemeAttribute />
        {children}
      </body>
    </html>
  );
}
