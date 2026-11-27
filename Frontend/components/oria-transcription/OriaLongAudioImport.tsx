"use client";

import { useEffect, useRef, useState } from "react";
import { FileAudio, Loader2, RefreshCw, UploadCloud } from "lucide-react";
import type { Upload as TusUpload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";

type OriaLanguage = "fr" | "en";
type AudioImportRecord = {
  id: string;
  course_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: "uploading" | "queued" | "processing" | "completed" | "failed";
  phase: string;
  progress_percent: number;
  duration_ms: number | null;
  segment_count: number | null;
  error_code: string | null;
  created_at?: string;
  updated_at?: string;
};
type AudioImportResponse = {
  audio_import: AudioImportRecord;
  bucket: string;
  object_name: string;
  chunk_size_bytes: number;
};
type SavedAudioImport = {
  importId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  uploaded: boolean;
};
type Props = {
  courseId: string;
  userId: string | null;
  language: OriaLanguage;
  enabled: boolean;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => void;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "https://lbv-connect-api.onrender.com";
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const FALLBACK_CHUNK_BYTES = 6 * 1024 * 1024;
const SUPPORTED_AUDIO_MIME = new Set([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/mp3",
  "audio/wav", "audio/x-wav", "audio/aac", "audio/3gpp", "audio/x-m4a", "audio/m4a",
]);
const EXTENSION_MIME: Record<string, string> = {
  webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4",
  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", "3gp": "audio/3gpp",
};

const supabase = createClient();

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user || !session.access_token) throw new Error("Session expirée. Veuillez vous reconnecter.");
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

function storageKey(userId: string, courseId: string) {
  return `oria_long_audio_import_v1_${userId}_${courseId}`;
}

function normalizedFileMime(file: File): string {
  const supplied = (file.type || "").split(";")[0].trim().toLowerCase();
  if (SUPPORTED_AUDIO_MIME.has(supplied)) return supplied;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_MIME[extension] || supplied;
}

function readSavedImport(key: string): SavedAudioImport | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as Partial<SavedAudioImport> | null;
    if (!value || typeof value.importId !== "string" || typeof value.filename !== "string" ||
        typeof value.mimeType !== "string" || typeof value.sizeBytes !== "number") return null;
    return {
      importId: value.importId,
      filename: value.filename,
      mimeType: value.mimeType,
      sizeBytes: value.sizeBytes,
      lastModified: Number(value.lastModified || 0),
      uploaded: value.uploaded === true,
    };
  } catch {
    return null;
  }
}

function matchesFile(saved: SavedAudioImport | null, file: File, mimeType: string) {
  return Boolean(saved && saved.filename === file.name && saved.mimeType === mimeType &&
    saved.sizeBytes === file.size && (!saved.lastModified || saved.lastModified === file.lastModified));
}

function supabaseTusEndpoint(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL est absente de la configuration Frontend.");
  let hostname = "";
  try { hostname = new URL(configuredUrl).hostname; }
  catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL est invalide."); }
  if (!hostname.endsWith(".supabase.co")) {
    throw new Error("L'import TUS nécessite l'URL Supabase hébergée au format projet.supabase.co.");
  }
  const projectRef = hostname.slice(0, -".supabase.co".length);
  if (!projectRef || projectRef.includes(".")) throw new Error("Impossible d'identifier le projet Supabase pour l'upload TUS.");
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
}

function statusLabel(record: AudioImportRecord, en: boolean): string {
  const labels: Record<string, [string, string]> = {
    uploading: ["Téléversement source en attente ou interrompu", "Source upload waiting or interrupted"],
    queued: ["En attente de préparation", "Waiting for preparation"],
    downloading: ["Téléchargement du fichier source", "Downloading source file"],
    verifying: ["Vérification audio et durée", "Checking audio and duration"],
    splitting: ["Découpage automatique en segments", "Automatically splitting into segments"],
    uploading_segments: ["Enregistrement des segments audio", "Saving audio segments"],
    completed: ["Audio prêt : tu peux terminer l'envoi", "Audio ready: you can finish uploading"],
    failed: ["Préparation interrompue", "Preparation failed"],
  };
  const [fr, eng] = labels[record.status === "processing" ? record.phase : record.status] ||
    labels[record.status] || ["Préparation audio", "Audio preparation"];
  return en ? eng : fr;
}

function readableSize(bytes: number, en: boolean): string {
  const value = bytes / (1024 * 1024);
  return `${value.toLocaleString(en ? "en-US" : "fr-FR", { maximumFractionDigits: 1 })} MiB`;
}

export function OriaLongAudioImport({
  courseId, userId, language, enabled, disabled = false, onBusyChange, onComplete,
}: Props) {
  const en = language === "en";
  const tr = (fr: string, eng: string) => en ? eng : fr;
  const [record, setRecord] = useState<AudioImportRecord | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [transferring, setTransferring] = useState(false);
  const [transferPercent, setTransferPercent] = useState(0);
  const [sourceUploaded, setSourceUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<TusUpload | null>(null);
  const mountedRef = useRef(true);
  const onBusyChangeRef = useRef(onBusyChange);
  const onCompleteRef = useRef(onComplete);
  const currentCourseRef = useRef(courseId);
  const notifiedCompleteRef = useRef<string | null>(null);
  currentCourseRef.current = courseId;
  const fileSignatureKey = userId ? storageKey(userId, courseId) : null;

  onBusyChangeRef.current = onBusyChange;
  onCompleteRef.current = onComplete;

  function applyRecord(next: AudioImportRecord | null) {
    if (!mountedRef.current || currentCourseRef.current !== courseId) return;
    setRecord(next);
    if (next?.status === "completed" && notifiedCompleteRef.current !== next.id) {
      notifiedCompleteRef.current = next.id;
      onCompleteRef.current();
    }
  }

  async function loadLatest() {
    if (!enabled) {
      setChecking(false);
      applyRecord(null);
      return;
    }
    setChecking(true);
    try {
      const response = await apiFetch<{ audio_import: AudioImportRecord | null }>(
        `/courses/${encodeURIComponent(courseId)}/audio-imports/latest`,
      );
      applyRecord(response.audio_import || null);
      if (response.audio_import?.status === "uploading" && userId) {
        const saved = readSavedImport(storageKey(userId, courseId));
        if (saved && saved.importId === response.audio_import.id) setSourceUploaded(saved.uploaded);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : tr("Impossible de vérifier l'import audio.", "Could not check audio import."));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    setRecord(null);
    setSourceUploaded(false);
    setTransferPercent(0);
    setError(null);
    setNotice(null);
    void loadLatest();
    return () => {
      mountedRef.current = false;
      if (uploadRef.current) void uploadRef.current.abort();
    };
  }, [courseId, enabled, userId]);

  const blocked = checking || transferring || Boolean(record && record.status !== "completed");
  useEffect(() => {
    onBusyChangeRef.current(blocked);
  }, [blocked]);

  useEffect(() => {
    if (!enabled || !record || !["queued", "processing"].includes(record.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await apiFetch<{ audio_import: AudioImportRecord }>(
          `/courses/${encodeURIComponent(courseId)}/audio-imports/${encodeURIComponent(record.id)}`,
        );
        if (!cancelled) applyRecord(response.audio_import);
      } catch (pollError) {
        if (!cancelled && mountedRef.current) {
          setError(pollError instanceof Error ? pollError.message : tr("Impossible d'actualiser la préparation.", "Could not refresh preparation."));
        }
      }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 4000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [courseId, enabled, record?.id, record?.status]);

  useEffect(() => () => { onBusyChangeRef.current(false); }, []);

  async function finalizeImport(importId: string) {
    const response = await apiFetch<{ audio_import: AudioImportRecord; queued: boolean }>(
      `/courses/${encodeURIComponent(courseId)}/audio-imports/${encodeURIComponent(importId)}/complete`,
      { method: "POST" },
    );
    applyRecord(response.audio_import);
    setSourceUploaded(true);
    setNotice(tr("Fichier reçu. ORIA prépare maintenant les segments audio.", "File received. ORIA is now preparing the audio segments."));
  }

  async function uploadLongAudio(file: File) {
    if (!enabled || disabled || !userId) return;
    setError(null);
    setNotice(null);
    const mimeType = normalizedFileMime(file);
    if (!SUPPORTED_AUDIO_MIME.has(mimeType)) {
      setError(tr("Format audio non pris en charge. Utilise MP3, M4A, WAV, AAC, OGG ou WEBM.",
        "Unsupported audio format. Use MP3, M4A, WAV, AAC, OGG or WEBM."));
      return;
    }
    if (!file.size || file.size > MAX_AUDIO_BYTES) {
      setError(tr("Le fichier doit peser au maximum 512 Mio.", "The file must be no larger than 512 MiB."));
      return;
    }
    if (record && record.status !== "completed") {
      const same = record.filename === file.name && record.size_bytes === file.size && record.mime_type === mimeType;
      if (!same) {
        setError(tr("Un import est déjà en cours. Réselectionne exactement le même fichier pour le reprendre, ou termine d'abord sa préparation.",
          "An import is already in progress. Select the exact same file to resume it, or finish its preparation first."));
        return;
      }
      if (["queued", "processing", "failed"].includes(record.status)) {
        setNotice(tr("Le fichier est déjà transféré. Utilise l'action de reprise de préparation ci-dessous.",
          "The file has already been uploaded. Use the preparation retry action below."));
        return;
      }
    }

    const key = storageKey(userId, courseId);
    const saved = readSavedImport(key);
    const matchingSaved = matchesFile(saved, file, mimeType) ? saved : null;
    const importId = record && record.status === "uploading" && record.filename === file.name &&
      record.size_bytes === file.size && record.mime_type === mimeType
      ? record.id : matchingSaved?.importId || crypto.randomUUID();
    const savedState: SavedAudioImport = {
      importId, filename: file.name, mimeType, sizeBytes: file.size,
      lastModified: file.lastModified, uploaded: matchingSaved?.uploaded === true,
    };
    window.localStorage.setItem(key, JSON.stringify(savedState));
    setTransferring(true);
    setTransferPercent(0);
    setSourceUploaded(savedState.uploaded);

    try {
      const created = await apiFetch<AudioImportResponse>(`/courses/${encodeURIComponent(courseId)}/audio-imports`, {
        method: "POST",
        body: JSON.stringify({ import_id: importId, filename: file.name, mime_type: mimeType, size_bytes: file.size }),
      });
      applyRecord(created.audio_import);
      if (created.audio_import.status !== "uploading") {
        setNotice(tr("Cet import est déjà en cours de préparation.", "This import is already being prepared."));
        setTransferring(false);
        return;
      }

      // Après une fermeture juste après l'envoi, l'objet peut être complet même si
      // le navigateur n'a pas reçu la confirmation. La finalisation fait foi.
      if (savedState.uploaded) {
        try {
          await finalizeImport(importId);
          setTransferring(false);
          return;
        } catch {
          // L'objet n'était pas encore complet : reprendre ou relancer le TUS ci-dessous.
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(tr("Session Supabase expirée. Reconnecte-toi.", "Supabase session expired. Please sign in again."));
      const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!publicKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY est absente de la configuration Frontend.");
      const tus = await import("tus-js-client");
      const upload = new tus.Upload(file, {
        endpoint: supabaseTusEndpoint(),
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, apikey: publicKey },
        metadata: {
          bucketName: created.bucket,
          objectName: created.object_name,
          contentType: mimeType,
          cacheControl: "3600",
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        storeFingerprintForResuming: true,
        chunkSize: created.chunk_size_bytes || FALLBACK_CHUNK_BYTES,
        onProgress: (bytesUploaded, bytesTotal) => {
          if (mountedRef.current && bytesTotal > 0) setTransferPercent(Math.min(100, Math.round(bytesUploaded / bytesTotal * 100)));
        },
        onError: (uploadError) => {
          if (!mountedRef.current) return;
          // Un objet peut avoir été finalisé côté Storage même si la dernière
          // réponse TUS s'est perdue : tenter la mise en file avant d'afficher l'échec.
          void finalizeImport(importId).then(() => {
            if (mountedRef.current) setTransferPercent(100);
          }).catch(() => {
            if (mountedRef.current) setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
          }).finally(() => {
            if (mountedRef.current) setTransferring(false);
          });
        },
        onSuccess: () => {
          void (async () => {
            const uploadedState = { ...savedState, uploaded: true };
            window.localStorage.setItem(key, JSON.stringify(uploadedState));
            if (mountedRef.current) { setSourceUploaded(true); setTransferPercent(100); }
            await finalizeImport(importId);
          })().catch((finalizeError) => {
            if (mountedRef.current) setError(finalizeError instanceof Error ? finalizeError.message : tr("Le fichier est envoyé, mais sa mise en file a échoué. Réessaie la finalisation.", "The file uploaded, but queueing failed. Retry finalization."));
          }).finally(() => {
            if (mountedRef.current) setTransferring(false);
          });
        },
      });
      uploadRef.current = upload;
      await upload.findPreviousUploads().then((previousUploads) => {
        const previous = previousUploads.find((item) =>
          item.metadata?.bucketName === created.bucket && item.metadata?.objectName === created.object_name,
        );
        if (previous) upload.resumeFromPreviousUpload(previous);
        upload.start();
      });
      // tus.Upload est piloté par callbacks : le transfert continue après ce point.
      setNotice(tr("Transfert TUS lancé. Tu peux laisser ORIA reprendre automatiquement en cas de coupure.",
        "TUS transfer started. ORIA can resume automatically after a connection interruption."));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : tr("Le transfert audio a échoué.", "Audio transfer failed."));
      setTransferring(false);
    }
  }

  async function retryPreparation() {
    if (!record || record.status !== "failed") return;
    setError(null);
    setNotice(null);
    setChecking(true);
    try {
      const response = await apiFetch<{ audio_import: AudioImportRecord; queued: boolean }>(
        `/courses/${encodeURIComponent(courseId)}/audio-imports/${encodeURIComponent(record.id)}/retry`,
        { method: "POST" },
      );
      applyRecord(response.audio_import);
      setNotice(tr("La préparation a été remise en file.", "Preparation has been queued again."));
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : tr("Impossible de relancer la préparation.", "Could not retry preparation."));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }

  const canSelect = enabled && !disabled && !checking && !transferring &&
    (!record || record.status === "uploading");
  const statusText = record ? statusLabel(record, en) : "";

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-secondary p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileAudio size={17}/>{tr("Importer un fichier audio long", "Import a long audio file")}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {tr("Un seul fichier jusqu'à 4 heures et 512 Mio. ORIA le vérifie et le découpe automatiquement en segments. Le transfert est reprenable après une coupure.",
              "One file up to 4 hours and 512 MiB. ORIA verifies it and automatically splits it into segments. The transfer can resume after an interruption.")}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/aac,audio/3gpp,.webm,.ogg,.m4a,.mp3,.wav,.aac,.3gp"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0] || null;
            event.currentTarget.value = "";
            if (selected) void uploadLongAudio(selected);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canSelect}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
        >
          <UploadCloud size={15}/>{record?.status === "uploading"
            ? tr("Reprendre le fichier", "Resume file") : tr("Choisir un fichier", "Choose file")}
        </button>
      </div>

      {!enabled ? (
        <p className="mt-3 text-xs text-muted">
          {tr("L'import audio long sera disponible après activation du service sur le backend. L'import par petits segments reste accessible.",
            "Long-audio import will be available after the backend service is enabled. Manual short-segment uploads remain available.")}
        </p>
      ) : null}
      {checking ? <p className="mt-3 flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin"/>{tr("Vérification de l'import précédent…", "Checking previous import…")}</p> : null}

      {record ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-3" role="status">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-all text-xs font-semibold">{record.filename}</p>
              <p className="mt-1 text-[11px] text-muted">{readableSize(record.size_bytes, en)} · {statusText}</p>
            </div>
            <strong className="text-xs tabular-nums">{record.progress_percent || 0}%</strong>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, record.progress_percent || 0))}%` }}/>
          </div>
          {record.status === "failed" ? (
            <button type="button" onClick={() => void retryPreparation()} disabled={checking}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">
              <RefreshCw size={14}/>{tr("Relancer la préparation", "Retry preparation")}
            </button>
          ) : null}
          {record.status === "completed" ? (
            <p className="mt-2 text-xs text-muted">
              {tr(`${record.segment_count || 0} segments préparés. Vérifie la durée puis termine l'envoi audio.`,
                `${record.segment_count || 0} segments prepared. Check the duration, then finish uploading audio.`)}
            </p>
          ) : null}
          {record.status === "uploading" && !transferring ? (
            <p className="mt-2 text-xs text-muted">
              {tr("Sélectionne à nouveau le même fichier pour reprendre le transfert à son dernier point sauvegardé.",
                "Select the same file again to resume from the last saved upload position.")}
            </p>
          ) : null}
        </div>
      ) : null}

      {transferring ? (
        <div className="mt-3" role="status">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin"/>{tr("Transfert du fichier source", "Uploading source file")}</span>
            <strong className="tabular-nums">{transferPercent}%</strong>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${transferPercent}%` }}/>
          </div>
        </div>
      ) : null}
      {sourceUploaded && record?.status === "uploading" && !transferring ? (
        <button type="button" onClick={() => {
          void finalizeImport(record.id).catch((finalizeError) => setError(
            finalizeError instanceof Error ? finalizeError.message : tr("Impossible de finaliser la préparation.", "Could not finalize preparation."),
          ));
        }} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-semibold">
          {tr("Finaliser la préparation", "Finalize preparation")}
        </button>
      ) : null}
      {notice ? <p className="mt-2 text-xs text-muted">{notice}</p> : null}
      {error ? <p className="mt-2 whitespace-pre-wrap text-xs text-red-600">{error}</p> : null}
      {disabled ? <p className="mt-2 text-[11px] text-muted">{tr("Pour éviter de mélanger deux sources audio, l'import long n'est pas disponible sur cet enregistrement déjà segmenté ou occupé.",
        "To avoid mixing audio sources, long-audio import is unavailable while this recording already has segments or is busy.")}</p> : null}
    </div>
  );
}
