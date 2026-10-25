import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Chalky | Learn it your way",
  description: "Chalky turns what you’re studying into a lesson you can talk through, see on the board, and practice at your own pace.",
};

export default function Home() {
  return <LandingPage />;
}
