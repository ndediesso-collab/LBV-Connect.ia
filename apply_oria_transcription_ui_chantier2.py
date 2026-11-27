#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Applique la Phase 2 ORIA Transcription sur le frontend existant.

- Extrait le parcours ORIA Cours existant vers un composant dédié.
- Crée la page Next.js /transcription avec les quatre services.
- Conserve les mêmes routes API, l'enregistrement MediaRecorder, l'upload par
  segments, les devis, les confirmations et le suivi des jobs.
- Le type est transmis via document_type à la création.
- Remplace le point d'entrée « Cours » du Chat par une navigation vers /transcription.

Aucune installation, aucun appel réseau, aucune modification du backend.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "Frontend"
CHAT_PATH = FRONTEND / "app" / "chat" / "page.tsx"
COMPONENT_DIR = FRONTEND / "components" / "oria-transcription"
COMPONENT_PATH = COMPONENT_DIR / "OriaTranscriptionClient.tsx"
ROUTE_DIR = FRONTEND / "app" / "transcription"
ROUTE_PATH = ROUTE_DIR / "page.tsx"


def fail(message: str) -> None:
    raise RuntimeError(message)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        fail(f"Ancre '{label}' attendue une fois, trouvée {count} fois. Aucun changement n'a été écrit.")
    return source.replace(old, new, 1)


def main() -> int:
    if not CHAT_PATH.is_file():
        fail(f"Fichier introuvable : {CHAT_PATH}")
    if COMPONENT_PATH.exists() or ROUTE_PATH.exists():
        fail("La page/composant ORIA Transcription existe déjà. Arrêt pour éviter tout écrasement.")

    chat = CHAT_PATH.read_text(encoding="utf-8")
    start_marker = "type CourseCapabilities = {"
    end_marker = "/** Horodatage des discussions affiché en heure de Libreville. */"
    start = chat.find(start_marker)
    end = chat.find(end_marker, start + 1)
    if start < 0 or end < 0 or end <= start:
        fail("Impossible de localiser le parcours ORIA Cours à extraire du Chat.")
    legacy_block = chat[start:end]
    if "function OriaCoursesPanel(" not in legacy_block or "async function createCourse()" not in legacy_block:
        fail("Le bloc extrait ne contient pas le parcours attendu. Aucun changement écrit.")

    # --------- Transforme l'ancien panneau en workspace Transcription ---------
    block = legacy_block
    block = replace_once(
        block,
        "type OriaCourseRecord = {\n  id: string;\n  title: string;\n  document_format: string;\n  status: string;",
        "type OriaCourseRecord = {\n  id: string;\n  title: string;\n  document_format: string;\n  document_type?: OriaDocumentType;\n  status: string;",
        "OriaCourseRecord.document_type",
    )
    block = replace_once(
        block,
        "function courseStorageKey(userId: string) {\n  return `oria_course_draft_v1_${userId}`;\n}",
        "function courseStorageKey(userId: string, documentType: OriaDocumentType) {\n  // Le brouillon Cours historique garde sa clé ; les nouveaux services ont chacun leur brouillon.\n  return documentType === \"course\"\n    ? `oria_course_draft_v1_${userId}`\n    : `oria_transcription_draft_v1_${documentType}_${userId}`;\n}",
        "brouillon séparé par service",
    )
    block = replace_once(
        block,
        "window.localStorage.getItem(courseStorageKey(userId))",
        "window.localStorage.getItem(courseStorageKey(userId, documentType))",
        "lecture du brouillon du service sélectionné",
    )
    block = replace_once(
        block,
        "window.localStorage.setItem(courseStorageKey(userId), cid);\n      const recent =",
        "window.localStorage.setItem(courseStorageKey(userId, documentType), cid);\n      const recent =",
        "sauvegarde du brouillon par service",
    )
    block = replace_once(
        block,
        "      if (userId) window.localStorage.setItem(courseStorageKey(userId), cid);\n      await refreshCourse(cid);",
        "      await refreshCourse(cid);",
        "ne pas classer un historique avant lecture de son type réel",
    )
    block = replace_once(
        block,
        "function OriaCoursesPanel({ language, wallet, userId, onWalletRefresh, onClose }: {\n  language: OriaLanguage;\n  wallet: WalletData | null;\n  userId: string | null;\n  onWalletRefresh: () => void;\n  onClose: () => void;\n}) {\n  const en = language === \"en\";\n  const tr = (fr: string, eng: string) => en ? eng : fr;",
        "export function OriaTranscriptionWorkspace({ language, wallet, userId, documentType, onDocumentTypeChange, onWalletRefresh, onClose }: {\n  language: OriaLanguage;\n  wallet: WalletData | null;\n  userId: string | null;\n  documentType: OriaDocumentType;\n  onDocumentTypeChange: (value: OriaDocumentType) => void;\n  onWalletRefresh: () => void;\n  onClose: () => void;\n}) {\n  const en = language === \"en\";\n  const tr = (fr: string, eng: string) => en ? eng : fr;\n  const service = TRANSCRIPTION_SERVICES[documentType];",
        "signature workspace Transcription",
    )
    block = replace_once(
        block,
        "    setCourse(courseResponse.course);\n    setTitle(courseResponse.course.title);",
        "    setCourse(courseResponse.course);\n    const storedType: OriaDocumentType = isOriaDocumentType(courseResponse.course.document_type)\n      ? courseResponse.course.document_type : \"course\";\n    onDocumentTypeChange(storedType);\n    if (userId) window.localStorage.setItem(courseStorageKey(userId, storedType), cid);\n    setTitle(courseResponse.course.title);",
        "restauration du type du brouillon",
    )
    block = replace_once(
        block,
        "body: JSON.stringify({ course_id: courseUuid, title: title.trim(), document_format: format }),",
        "body: JSON.stringify({ course_id: courseUuid, title: title.trim(), document_format: format, document_type: documentType }),",
        "envoi document_type à la création",
    )
    block = block.replace("UI[language].loading", "tr(\"Chargement…\", \"Loading…\")")
    block = block.replace('normalizeGeneratedArtifact(response.artifact)', 'normalizeTranscriptionArtifact(response.artifact)')

    # Libellés majeurs : le parcours devient générique et expose le service choisi.
    block = block.replace('aria-label="ORIA Cours"', 'aria-label="ORIA Transcription"')
    block = block.replace('<div className="flex items-center gap-2"><BookOpen size={21}/><h2 className="text-lg font-semibold">ORIA Cours</h2></div>', '<div className="flex items-center gap-2"><BookOpen size={21}/><h2 className="text-lg font-semibold">ORIA Transcription</h2></div>')
    block = block.replace(
        '            <p className="mt-1 text-sm text-muted">{tr("Enregistrez un cours, obtenez une transcription et un document pédagogique en PDF ou Word.",\n              "Record a lecture and receive a transcript and a structured PDF or Word document.")}</p>',
        '            <p className="mt-1 text-sm text-muted">{service.description[language]}</p>',
    )
    block = block.replace('aria-label={tr("Cours récents", "Recent courses")}', 'aria-label={tr("Enregistrements récents", "Recent recordings")}')
    block = block.replace('{tr("Cours", "Course")} {id.slice(0, 8)}', '{tr("Audio", "Audio")} {id.slice(0, 8)}')
    block = block.replace('{tr("Titre du cours", "Course title")}', '{tr("Nom de l’enregistrement", "Recording title")}')
    block = block.replace('placeholder={tr("Ex. Thermodynamique — transformations", "E.g. Thermodynamics — transformations")}', 'placeholder={service.placeholder[language]}')
    block = block.replace('{busy === "create" ? tr("Création...", "Creating...") : tr("Créer ce cours", "Create course")}', '{busy === "create" ? tr("Création…", "Creating…") : tr("Créer l’enregistrement", "Create recording")}')
    block = block.replace('{tr("Activez un pack ORIA pour créer des cours. Aucun traitement IA payant ne démarre avant l\'acceptation du devis.",\n            "Activate an ORIA pack to create courses. No paid AI processing starts before you accept a quote.")}', '{tr("Activez un pack ORIA pour préparer une transcription. Aucun traitement IA payant ne démarre avant l’acceptation du devis.",\n            "Activate an ORIA pack to prepare a transcription. No paid AI processing starts before you accept a quote.")}')
    block = block.replace('title={!canReturnToChat ? tr("Terminez l\'enregistrement ou le transfert avant de revenir au Chat.",\n                "Finish the recording or upload before returning to Chat.") : undefined}', 'title={!canReturnToChat ? tr("Terminez l\'enregistrement ou le transfert avant de revenir aux services.",\n                "Finish the recording or upload before returning to services.") : undefined}')
    block = block.replace('aria-label={tr("Retour au Chat", "Back to Chat")}', 'aria-label={tr("Retour aux services", "Back to services")}')
    block = block.replace('{tr("Retour au Chat", "Back to Chat")}', '{tr("Changer de service", "Choose another service")}')
    block = block.replace('tr("Cours en attente de crédits", "Course waiting for credits")', 'tr("Rédaction en attente de crédits", "Document writing awaiting credits")')
    block = block.replace('tr("Cours terminé", "Course completed")', 'tr("Transcription terminée", "Transcription completed")')
    block = block.replace('tr("Nouveau cours", "New course")', 'tr("Nouvel enregistrement", "New recording")')
    block = block.replace('tr("Audio du cours", "Course audio")', 'tr("Audio de l’enregistrement", "Recording audio")')
    block = block.replace('tr("Inclus dans ORIA Cours pour tous les packs actifs. Pour approfondir un point, importez le document dans le Chat général avec un modèle autorisé par votre pack.", "Available for ORIA Cours on every active pack. For more detailed explanations, upload the document in general Chat using a model allowed by your pack.")', 'tr("ORIA Transcription est disponible avec les packs actifs. Pour approfondir un point, importez le document dans le Chat général avec un modèle autorisé par votre pack.", "ORIA Transcription is available with active plans. For deeper explanations, upload the document in general Chat using a model allowed by your plan.")')
    block = block.replace('tr("N\'envoyez pas une deuxième fois le même cours : une opération peut déjà avoir été facturée.",\n                  "Do not submit the course again: a provider call may already have been charged.")', 'tr("Ne soumettez pas une deuxième fois le même enregistrement : une opération peut déjà avoir été facturée.",\n                  "Do not submit the same recording again: a provider call may already have been charged.")')
    block = block.replace('tr("Traitement du cours", "Course processing")', 'tr("Traitement de la transcription", "Transcription processing")')
    block = block.replace('tr("Cours", "Course")', 'tr("Audio", "Audio")')
    block = block.replace('tr("Cours sans titre", "Untitled course")', 'tr("Enregistrement sans titre", "Untitled recording")')
    block = block.replace('tr("Créez d\'abord un cours.", "Create a course first.")', 'tr("Créez d’abord un enregistrement.", "Create a recording first.")')
    block = block.replace('tr("soumettre le cours",\n          "submit the course")', 'tr("soumettre l’enregistrement",\n          "submit the recording")')
    block = block.replace('tr("Cours pédagogique", "Structured course")', 'tr("Document structuré", "Structured document")')
    block = block.replace('tr("Envoi arrêté : réessaie le segment conservé avant de soumettre le cours.",\n          "Upload stopped: retry the retained segment before submitting the course.")', 'tr("Envoi arrêté : réessaie le segment conservé avant de soumettre l’enregistrement.",\n          "Upload stopped: retry the retained segment before submitting the recording.")')
    block = block.replace('tr("Créez d\'abord un cours.", "Create a course first.")', 'tr("Créez d’abord un enregistrement.", "Create a recording first.")')
    block = block.replace('tr("Cours placé dans la file.", "Course queued.")', 'tr("Enregistrement placé dans la file.", "Recording queued.")')
    block = block.replace('tr("Reprise du cours enregistrée.", "Course resume submitted.")', 'tr("Reprise de la rédaction enregistrée.", "Document writing resume submitted.")')
    block = block.replace('tr("Cours en attente de crédits", "Course waiting for credits")', 'tr("Rédaction en attente de crédits", "Document writing awaiting credits")')
    block = block.replace('tr("Traitement du cours", "Course processing")', 'tr("Traitement de la transcription", "Transcription processing")')
    block = block.replace('tr("Cours pédagogique", "Structured course")', 'tr("Document final", "Final document")')
    # Filet de sécurité sur tous les libellés encore historiques dans le panneau extrait.
    for old, new in (
        ("ORIA Cours", "ORIA Transcription"),
        ("Enregistrez un cours, obtenez une transcription et un document pédagogique en PDF ou Word.", "Enregistrez ou importez un audio pour obtenir une transcription et un document structuré."),
        ("Record a lecture and receive a transcript and a structured PDF or Word document.", "Record or upload audio to receive a transcript and a structured document."),
        ("Cours récents", "Enregistrements récents"),
        ("Recent courses", "Recent recordings"),
        ("Titre du cours", "Nom de l’enregistrement"),
        ("Course title", "Recording title"),
        ("Créer ce cours", "Créer l’enregistrement"),
        ("Create course", "Create recording"),
        ("Nouveau cours", "Nouvel enregistrement"),
        ("New course", "New recording"),
        ("Audio du cours", "Audio de l’enregistrement"),
        ("Course audio", "Recording audio"),
        ("Cours en attente de crédits", "Rédaction en attente de crédits"),
        ("Course waiting for credits", "Document writing awaiting credits"),
        ("Cours terminé", "Transcription terminée"),
        ("Course completed", "Transcription completed"),
        ("Traitement du cours", "Traitement de la transcription"),
        ("Course processing", "Transcription processing"),
        ("Cours pédagogique", "Document final"),
        ("Structured course", "Final document"),
        ("Cours placé dans la file.", "Enregistrement placé dans la file."),
        ("Course queued.", "Recording queued."),
        ("Reprise du cours enregistrée.", "Reprise de la rédaction enregistrée."),
        ("Course resume submitted.", "Document writing resume submitted."),
        ("Créez d'abord un cours.", "Créez d’abord un enregistrement."),
        ("Create a course first.", "Create a recording first."),
        ("soumettre le cours", "soumettre l’enregistrement"),
        ("submit the course", "submit the recording"),
        ("Vérifiez l'état du cours avant toute nouvelle confirmation.", "Vérifiez l’état de l’enregistrement avant toute nouvelle confirmation."),
        ("Check the course status before confirming again.", "Check the recording status before confirming again."),
        ("N'envoyez pas une deuxième fois le même cours", "Ne soumettez pas une deuxième fois le même enregistrement"),
        ("Do not submit the course again", "Do not submit the same recording again"),
        ("Activez un pack ORIA pour créer des cours.", "Activez un pack ORIA pour préparer une transcription."),
        ("Activate an ORIA pack to create courses.", "Activate an ORIA pack to prepare a transcription."),
    ):
        block = block.replace(old, new)
    block = block.replace('tr("Cours", "Course")', 'tr("Enregistrement", "Recording")')

    # Les nouveaux documents doivent garder le bon profil lorsqu'un brouillon est repris.
    if "document_type: documentType" not in block:
        fail("Le paramètre document_type n'a pas été transmis au backend.")
    if "onDocumentTypeChange(storedType)" not in block:
        fail("La reprise d'un brouillon ne restaure pas son service.")

    component_header = r'''"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen, Download, Loader2, Mic, Plus,
  RotateCcw, Square, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";

type OriaLanguage = "fr" | "en";
type OriaDocumentType = "course" | "meeting" | "speech" | "interview";
type WalletData = {
  balance: number;
  initial_credits: number;
  pack_id: string | null;
  pack_activated_at: string | null;
  pack_expires_at: string | null;
  is_pack_active: boolean;
};

const TRANSCRIPTION_SERVICES: Record<OriaDocumentType, {
  label: Record<OriaLanguage, string>;
  description: Record<OriaLanguage, string>;
  placeholder: Record<OriaLanguage, string>;
}> = {
  course: {
    label: { fr: "Cours", en: "Course" },
    description: { fr: "Transformez vos cours enregistrés en supports pédagogiques clairs, détaillés et organisés.", en: "Turn recorded lessons into clear, detailed and structured learning materials." },
    placeholder: { fr: "Ex. Microéconomie — chapitre 2", en: "E.g. Microeconomics — chapter 2" },
  },
  meeting: {
    label: { fr: "Réunion", en: "Meeting" },
    description: { fr: "Transformez vos réunions en comptes rendus structurés : sujets, échanges, décisions et actions à suivre.", en: "Turn recorded meetings into structured minutes with topics, discussions, decisions and follow-up actions." },
    placeholder: { fr: "Ex. Réunion d'équipe — 27 novembre", en: "E.g. Team meeting — November 27" },
  },
  speech: {
    label: { fr: "Discours", en: "Speech" },
    description: { fr: "Transformez vos discours et interventions en documents propres, fidèles et structurés.", en: "Turn speeches and oral presentations into clean, faithful and structured documents." },
    placeholder: { fr: "Ex. Allocution d'ouverture", en: "E.g. Opening address" },
  },
  interview: {
    label: { fr: "Interview", en: "Interview" },
    description: { fr: "Organisez vos interviews autour des questions, réponses et thèmes abordés.", en: "Organize interviews around their questions, answers and main topics." },
    placeholder: { fr: "Ex. Entretien avec un partenaire", en: "E.g. Interview with a partner" },
  },
};

function isOriaDocumentType(value: unknown): value is OriaDocumentType {
  return value === "course" || value === "meeting" || value === "speech" || value === "interview";
}

const supabase = createClient();

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user || !session.access_token) throw new Error("Utilisateur non authentifié.");
  const headers = new Headers(options?.headers);
  if (options?.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  headers.set("user-id", session.user.id);
  headers.set("authorization", `Bearer ${session.access_token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (response.status === 401) throw new Error("Session expirée. Veuillez vous reconnecter.");
    throw new Error(error?.detail || "Une erreur est survenue avec le serveur.");
  }
  return response.json();
}

function normalizeTranscriptionArtifact(raw: Record<string, unknown>): { downloadUrl: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const downloadUrl = typeof raw.download_url === "string" ? raw.download_url :
    typeof raw.downloadUrl === "string" ? raw.downloadUrl :
    typeof raw.url === "string" ? raw.url : null;
  return { downloadUrl };
}

const UI = { fr: { loading: "Chargement…" }, en: { loading: "Loading…" } } as const;

'''

    component_content = component_header + block
    # --------- Page de sélection des quatre services et authentification ---------
    page_content = r'''"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, FileAudio, MessageSquareText, Mic2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { OriaTranscriptionWorkspace } from "@/components/oria-transcription/OriaTranscriptionClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";
type OriaLanguage = "fr" | "en";
type OriaDocumentType = "course" | "meeting" | "speech" | "interview";
type WalletData = {
  balance: number; initial_credits: number; pack_id: string | null;
  pack_activated_at: string | null; pack_expires_at: string | null; is_pack_active: boolean;
};

const supabase = createClient();

async function apiFetch<T>(path: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user || !session.access_token) throw new Error("Utilisateur non authentifié.");
  const response = await fetch(`${API_URL}${path}`, { headers: {
    "user-id": session.user.id, authorization: `Bearer ${session.access_token}`,
  } });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (response.status === 401) throw new Error("Session expirée. Veuillez vous reconnecter.");
    throw new Error(error?.detail || "Impossible de charger les informations ORIA.");
  }
  return response.json();
}

const SERVICES: Array<{
  id: OriaDocumentType;
  icon: typeof BookOpen;
  title: Record<OriaLanguage, string>;
  description: Record<OriaLanguage, string>;
}> = [
  { id: "course", icon: BookOpen,
    title: { fr: "Cours", en: "Course" },
    description: { fr: "Transformez vos cours enregistrés en supports pédagogiques clairs, détaillés et organisés.", en: "Turn recorded lessons into clear, detailed and structured learning materials." } },
  { id: "meeting", icon: Users,
    title: { fr: "Réunion", en: "Meeting" },
    description: { fr: "Obtenez un compte rendu avec les sujets abordés, les décisions et les actions à suivre.", en: "Get meeting minutes with topics, decisions and follow-up actions." } },
  { id: "speech", icon: Mic2,
    title: { fr: "Discours", en: "Speech" },
    description: { fr: "Structurez vos conférences, allocutions et interventions sans déformer les propos.", en: "Structure conferences, addresses and speeches without distorting the speaker's words." } },
  { id: "interview", icon: MessageSquareText,
    title: { fr: "Interview", en: "Interview" },
    description: { fr: "Organisez vos échanges autour des questions, réponses et thèmes essentiels.", en: "Organize conversations around questions, answers and essential themes." } },
];

function getLanguage(): OriaLanguage {
  if (typeof window === "undefined") return "fr";
  const saved = window.localStorage.getItem("oria_language");
  if (saved === "fr" || saved === "en") return saved;
  return window.navigator.language.toLowerCase().startsWith("en") ? "en" : "fr";
}

export default function OriaTranscriptionClient() {
  const router = useRouter();
  const [language, setLanguage] = useState<OriaLanguage>("fr");
  const [userId, setUserId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [selectedType, setSelectedType] = useState<OriaDocumentType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshWallet = useCallback(async () => {
    try {
      const data = await apiFetch<{ success: boolean; wallet: WalletData }>("/credits/me");
      setWallet(data.wallet || null);
    } catch (cause) {
      setWallet(null);
      setError(cause instanceof Error ? cause.message : "Impossible de charger le solde ORIA.");
    }
  }, []);

  useEffect(() => {
    const syncLanguage = () => setLanguage(getLanguage());
    syncLanguage();
    window.addEventListener("storage", syncLanguage);
    window.addEventListener("oria-language-change", syncLanguage);
    return () => {
      window.removeEventListener("storage", syncLanguage);
      window.removeEventListener("oria-language-change", syncLanguage);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const boot = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id || !session.access_token) {
          router.replace("/login");
          return;
        }
        if (!live) return;
        setUserId(session.user.id);
        const data = await apiFetch<{ success: boolean; wallet: WalletData }>("/credits/me");
        if (live) setWallet(data.wallet || null);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Initialisation ORIA impossible.");
      } finally {
        if (live) setLoading(false);
      }
    };
    void boot();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user?.id) router.replace("/login");
      else setUserId(session.user.id);
    });
    return () => { live = false; subscription.unsubscribe(); };
  }, [router]);

  const en = language === "en";
  const tr = (fr: string, eng: string) => en ? eng : fr;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface shadow-sm">
            <FileAudio size={21} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">ORIA</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Transcription</h1>
          </div>
        </div>
        <Link href="/chat" className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium transition hover:bg-surface-secondary">
          <ArrowLeft size={16} />{tr("Retour au Chat", "Back to Chat")}
        </Link>
      </header>

      {loading ? (
        <div role="status" className="rounded-3xl border border-border bg-surface p-6 text-sm text-muted">{tr("Chargement de votre espace…", "Loading your workspace…")}</div>
      ) : !userId ? (
        <div role="alert" className="rounded-3xl border border-border bg-surface p-6 text-sm">{error || tr("Redirection vers la connexion…", "Redirecting to sign in…")}</div>
      ) : selectedType ? (
        <OriaTranscriptionWorkspace
          language={language}
          wallet={wallet}
          userId={userId}
          documentType={selectedType}
          onDocumentTypeChange={setSelectedType}
          onWalletRefresh={() => { void refreshWallet(); }}
          onClose={() => { setError(null); setSelectedType(null); }}
        />
      ) : (
        <section className="space-y-6">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-muted">{tr("VOTRE ESPACE AUDIO", "YOUR AUDIO WORKSPACE")}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{tr("Que souhaitez-vous transcrire ?", "What would you like to transcribe?")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted sm:text-base">
              {tr("Choisissez un service. ORIA utilise le même moteur audio et adapte le document final à votre besoin.", "Choose a service. ORIA uses the same audio engine and adapts the final document to your needs.")}
            </p>
          </div>

          {wallet?.pack_id === "discovery_pack" ? (
            <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
              {tr("ORIA Transcription n’est pas inclus dans le pack Découverte. Choisissez un pack classique pour continuer.", "ORIA Transcription is not included in the Discovery plan. Choose a classic plan to continue.")}
              <Link href="/credits" className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">{tr("Voir les packs", "View plans")}<ArrowRight size={14}/></Link>
            </div>
          ) : !wallet?.is_pack_active ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
              <p className="text-sm">{tr("Un pack ORIA actif est nécessaire pour lancer un traitement. Aucun crédit n’est prélevé pendant la préparation de l’audio.", "An active ORIA pack is required to process audio. Credits are not charged while preparing the audio.")}</p>
              <Link href="/credits" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold">{tr("Voir les packs", "View plans")}<ArrowRight size={15}/></Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
              <span className="text-muted">{tr("Solde disponible", "Available balance")}</span>
              <strong className="tabular-nums">{wallet.balance.toLocaleString(en ? "en-US" : "fr-FR")} {tr("crédits", "credits")}</strong>
            </div>
          )}

          {error ? <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{error}</p> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SERVICES.map((service) => {
              const Icon = service.icon;
              return (
                <button key={service.id} type="button" disabled={!wallet?.is_pack_active || wallet.pack_id === "discovery_pack"}
                  onClick={() => { setError(null); setSelectedType(service.id); }}
                  className="group flex min-h-44 flex-col rounded-3xl border border-border bg-surface p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 sm:p-6">
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-tertiary"><Icon size={21}/></span>
                    <ArrowRight size={17} className="text-muted transition group-hover:translate-x-1 group-hover:text-foreground"/>
                  </div>
                  <span className="mt-5 text-lg font-semibold">{service.title[language]}</span>
                  <span className="mt-1.5 text-sm leading-6 text-muted">{service.description[language]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            {tr("Enregistrement direct disponible. L’import d’un fichier unique de longue durée sera ajouté dans le chantier d’import audio.", "Direct recording is available. Single long-file import will be added in the audio-import phase.")}
          </p>
        </section>
      )}
    </main>
  );
}
'''

    route_content = '''import type { Metadata } from "next";\nimport OriaTranscriptionClient from "@/components/oria-transcription/OriaTranscriptionClient";\n\nexport const metadata: Metadata = {\n  title: "ORIA Transcription",\n  description: "Transformez vos cours, réunions, discours et interviews enregistrés en documents structurés.",\n};\n\nexport default function TranscriptionPage() {\n  return <OriaTranscriptionClient />;\n}\n'''

    # --------- Retire le panneau du Chat et redirige le raccourci ---------
    new_chat = chat[:start] + chat[end:]
    new_chat = replace_once(
        new_chat,
        '    label: "Cours",\n    icon: BookOpen,',
        '    label: "Transcription",\n    icon: BookOpen,',
        "libellé du raccourci Chat",
    )
    new_chat = replace_once(
        new_chat,
        '      if (label === "Cours") return;',
        '      if (label === "Transcription") return;',
        "restriction du compte gratuit",
    )
    old_handler = '''    if (label === "Cours") {
      if (discoveryWallet) {
        setDiscoveryNotice(language === "fr"
          ? "La création de cours audio n'est pas disponible avec Découverte. Choisissez un pack classique."
          : "Audio course generation is not included in Discovery Pass. Choose a classic plan.");
        return;
      }
      setActiveCapability((current) => current === "Cours" ? null : "Cours");
      setError(null);
      return;
    }'''
    new_handler = '''    if (label === "Transcription") {
      if (discoveryWallet) {
        setDiscoveryNotice(language === "fr"
          ? "ORIA Transcription nécessite un pack classique. Choisissez un pack pour continuer."
          : "ORIA Transcription requires a classic plan. Choose a plan to continue.");
        return;
      }
      setError(null);
      window.location.assign("/transcription");
      return;
    }'''
    new_chat = replace_once(new_chat, old_handler, new_handler, "navigation vers /transcription")

    # L'ancien panneau n'est plus embarqué dans le Chat.
    panel = '''            {activeCapability === "Cours" ? (
              <OriaCoursesPanel language={language} wallet={wallet} userId={currentUserId}
                onWalletRefresh={() => { void loadWallet(); }}
                onClose={() => setActiveCapability(null)} />
            ) : null}

'''
    new_chat = replace_once(new_chat, panel, "", "suppression du panneau Cours dans Chat")

    # Les quelques gardes visuelles restées dans le Chat sont alignées sur le nouveau libellé.
    new_chat = new_chat.replace('localCache.activeCapability === "Création" ? null : localCache.activeCapability', '(localCache.activeCapability === "Création" || localCache.activeCapability === "Cours") ? null : localCache.activeCapability')
    new_chat = new_chat.replace('activeCapability === "Cours"', 'activeCapability === "Transcription"')
    new_chat = new_chat.replace('activeCapability !== "Cours"', 'activeCapability !== "Transcription"')
    new_chat = new_chat.replace('label === "Cours"', 'label === "Transcription"')
    new_chat = new_chat.replace('Cours: "Courses"', 'Transcription: "Transcription"')

    # Aucun ancien composant ne doit rester appelé dans la page du Chat.
    if "OriaCoursesPanel" in new_chat or 'label: "Cours"' in new_chat:
        fail("Une référence résiduelle au panneau ORIA Cours subsiste dans le Chat.")
    if 'window.location.assign("/transcription")' not in new_chat:
        fail("Le raccourci du Chat ne redirige pas vers /transcription.")

    # Vérifie les sorties avant d'écrire quoi que ce soit.
    if "document_type: documentType" not in component_content:
        fail("Le composant dédié ne transmet pas document_type.")
    if "ORIA Transcription" not in component_content or "function OriaTranscriptionClient" not in page_content:
        fail("Le nouveau parcours Transcription est incomplet.")
    if "createClient" not in component_content or "authorization" not in component_content:
        fail("Le composant ne conserve pas l'authentification Supabase.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = CHAT_PATH.with_name(f"page.tsx.bak-oria-transcription-ui-{stamp}")
    shutil.copy2(CHAT_PATH, backup_path)
    COMPONENT_DIR.mkdir(parents=True, exist_ok=True)
    ROUTE_DIR.mkdir(parents=True, exist_ok=True)

    CHAT_PATH.write_text(new_chat, encoding="utf-8", newline="\n")
    COMPONENT_PATH.write_text(component_content, encoding="utf-8", newline="\n")
    ROUTE_PATH.write_text(route_content, encoding="utf-8", newline="\n")

    print("OK : Phase 2 ORIA Transcription appliquée.")
    print("Fichiers créés :")
    print(" - Frontend/app/transcription/page.tsx")
    print(" - Frontend/components/oria-transcription/OriaTranscriptionClient.tsx")
    print("Fichier modifié :")
    print(" - Frontend/app/chat/page.tsx")
    print("Sauvegarde créée :")
    print(f" - {backup_path.relative_to(ROOT)}")
    print("Fonctions réutilisées sans réécriture :")
    print(" - Enregistrement MediaRecorder et segmentation de 4 min 45")
    print(" - Upload authentifié des segments vers /courses")
    print(" - Soumission, devis, confirmation explicite et reprise de rédaction")
    print(" - Suivi du worker, accès aux artefacts et téléchargement privé")
    print("Nouveau comportement : le raccourci Transcription du Chat ouvre /transcription.")
    print("Le frontend envoie document_type lors de la création et restaure le type des brouillons repris.")
    print("Aucun import d'audio monolithique de 4 h n'a été ajouté dans cette phase.")
    print("Prochaine vérification : cd Frontend ; npm run build")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
