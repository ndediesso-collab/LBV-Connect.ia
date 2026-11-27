import type { Metadata } from "next";
import OriaTranscriptionClient from "@/components/oria-transcription/OriaTranscriptionClient";

export const metadata: Metadata = {
  title: "ORIA Transcription",
  description: "Transformez vos cours, réunions, discours et interviews enregistrés en documents structurés.",
};

export default function TranscriptionPage() {
  return <OriaTranscriptionClient />;
}
