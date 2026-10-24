"use client";

import { useParams } from "next/navigation";
import { SessionView } from "@/components/session/SessionView";
import type { Id } from "@/convex/_generated/dataModel";

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SessionView sessionId={sessionId as Id<"sessions">} />;
}
