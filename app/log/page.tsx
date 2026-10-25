import type { Metadata } from "next";
import LiveLog from "./LiveLog";

export const metadata: Metadata = { title: "Chalky · live log" };

/** Every lesson's transcript, live while it runs: from Convex when configured, else from the saved files. */
export default function LogPage() {
  return <LiveLog />;
}
