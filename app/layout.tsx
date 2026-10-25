import type { Metadata } from "next";
import { ThemeAttribute } from "@/components/ThemeAttribute";
import { envTheme } from "@/lib/board/theme";
import "./globals.css";

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
