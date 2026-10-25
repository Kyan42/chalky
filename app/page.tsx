import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Chalky | For the joy of figuring it out",
  description: "Meet Chalky, your personal AI tutor. Talk it through, draw it out, and make the tricky stuff click with voice conversations and a visual whiteboard.",
};

export default function Home() {
  return <LandingPage />;
}
