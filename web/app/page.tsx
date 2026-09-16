import type { Metadata } from "next";
import { AirbusIntelligenceHubConsole } from "./airbus-intelligence-hub-console";

export const metadata: Metadata = {
  title: "Airbus Intelligence Hub · Decision Console",
  description: "Trace every retrieval, guardrail, tool call, and agent decision.",
};

export default function Home() {
  return <AirbusIntelligenceHubConsole />;
}
