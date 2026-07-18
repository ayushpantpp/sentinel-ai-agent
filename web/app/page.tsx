import type { Metadata } from "next";
import { SentinelConsole } from "./sentinel-console";

export const metadata: Metadata = {
  title: "Sentinel AI · Decision Console",
  description: "Trace every retrieval, guardrail, tool call, and agent decision.",
};

export default function Home() {
  return <SentinelConsole />;
}
