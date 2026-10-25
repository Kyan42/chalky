"use client";

/**
 * Puts the theme in force on <html data-theme>, so the page around the board (app/globals.css)
 * follows the same theme the board draws with (lib/board/theme.ts): the build's
 * NEXT_PUBLIC_CHALKY_THEME, overridden by ?theme= on the page.
 */
import { useEffect } from "react";
import { currentTheme } from "@/lib/board/theme";

export function ThemeAttribute() {
  useEffect(() => {
    document.documentElement.dataset.theme = currentTheme().id;
  }, []);
  return null;
}
