#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Installe le frontend TUS pour ORIA Transcription — Chantier 3B.

Modifie uniquement le workspace ORIA Transcription et Frontend/package.json,
crée un composant dédié à l'import audio long et sauvegarde les originaux.
Aucune écriture GitHub, aucun changement backend ou Supabase.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "Frontend"
WORKSPACE = FRONTEND / "components" / "oria-transcription" / "OriaTranscriptionWorkspace.tsx"
PACKAGE = FRONTEND / "package.json"
COMPONENT = FRONTEND / "components" / "oria-transcription" / "OriaLongAudioImport.tsx"
CHILD_SOURCE = '"use client";\n\nimport { useEffect, useRef, useState } from "react";\nimport { FileAudio, Loader2, RefreshCw, UploadCloud } from "lucide-react";\nimport type { Upload as TusUpload } from "tus-js-client";\nimport { createClient } from "@/lib/supabase/client";\n\ntype OriaLanguage = "fr" | "en";\ntype AudioImportRecord = {\n  id: string;\n  course_id: string;\n  filename: string;\n  mime_type: string;\n  size_bytes: number;\n  status: "uploading" | "queued" | "processing" | "completed" | "failed";\n  phase: string;\n  progress_percent: number;\n  duration_ms: number | null;\n  segment_count: number | null;\n  error_code: string | null;\n  created_at?: string;\n  updated_at?: string;\n};\ntype AudioImportResponse = {\n  audio_import: AudioImportRecord;\n  bucket: string;\n  object_name: string;\n  chunk_size_bytes: number;\n};\ntype SavedAudioImport = {\n  importId: string;\n  filename: string;\n  mimeType: string;\n  sizeBytes: number;\n  lastModified: number;\n  uploaded: boolean;\n};\ntype Props = {\n  courseId: string;\n  userId: string | null;\n  language: OriaLanguage;\n  enabled: boolean;\n  disabled?: boolean;\n  onBusyChange: (busy: boolean) => void;\n  onComplete: () => void;\n};\n\nconst API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\\/$/, "") ||\n  "https://lbv-connect-api.onrender.com";\nconst MAX_AUDIO_BYTES = 512 * 1024 * 1024;\nconst FALLBACK_CHUNK_BYTES = 6 * 1024 * 1024;\nconst SUPPORTED_AUDIO_MIME = new Set([\n  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/mp3",\n  "audio/wav", "audio/x-wav", "audio/aac", "audio/3gpp", "audio/x-m4a", "audio/m4a",\n]);\nconst EXTENSION_MIME: Record<string, string> = {\n  webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4",\n  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", "3gp": "audio/3gpp",\n};\n\nconst supabase = createClient();\n\nasync function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {\n  const { data: { session } } = await supabase.auth.getSession();\n  if (!session?.user || !session.access_token) throw new Error("Session expirée. Veuillez vous reconnecter.");\n  const headers = new Headers(options?.headers);\n  if (options?.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");\n  headers.set("user-id", session.user.id);\n  headers.set("authorization", `Bearer ${session.access_token}`);\n  const response = await fetch(`${API_URL}${path}`, { ...options, headers });\n  if (!response.ok) {\n    const error = await response.json().catch(() => null);\n    if (response.status === 401) throw new Error("Session expirée. Veuillez vous reconnecter.");\n    throw new Error(error?.detail || "Une erreur est survenue avec le serveur.");\n  }\n  return response.json();\n}\n\nfunction storageKey(userId: string, courseId: string) {\n  return `oria_long_audio_import_v1_${userId}_${courseId}`;\n}\n\nfunction normalizedFileMime(file: File): string {\n  const supplied = (file.type || "").split(";")[0].trim().toLowerCase();\n  if (SUPPORTED_AUDIO_MIME.has(supplied)) return supplied;\n  const extension = file.name.split(".").pop()?.toLowerCase() || "";\n  return EXTENSION_MIME[extension] || supplied;\n}\n\nfunction readSavedImport(key: string): SavedAudioImport | null {\n  try {\n    const value = JSON.parse(window.localStorage.getItem(key) || "null") as Partial<SavedAudioImport> | null;\n    if (!value || typeof value.importId !== "string" || typeof value.filename !== "string" ||\n        typeof value.mimeType !== "string" || typeof value.sizeBytes !== "number") return null;\n    return {\n      importId: value.importId,\n      filename: value.filename,\n      mimeType: value.mimeType,\n      sizeBytes: value.sizeBytes,\n      lastModified: Number(value.lastModified || 0),\n      uploaded: value.uploaded === true,\n    };\n  } catch {\n    return null;\n  }\n}\n\nfunction matchesFile(saved: SavedAudioImport | null, file: File, mimeType: string) {\n  return Boolean(saved && saved.filename === file.name && saved.mimeType === mimeType &&\n    saved.sizeBytes === file.size && (!saved.lastModified || saved.lastModified === file.lastModified));\n}\n\nfunction supabaseTusEndpoint(): string {\n  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;\n  if (!configuredUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL est absente de la configuration Frontend.");\n  let hostname = "";\n  try { hostname = new URL(configuredUrl).hostname; }\n  catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL est invalide."); }\n  if (!hostname.endsWith(".supabase.co")) {\n    throw new Error("L\'import TUS nécessite l\'URL Supabase hébergée au format projet.supabase.co.");\n  }\n  const projectRef = hostname.slice(0, -".supabase.co".length);\n  if (!projectRef || projectRef.includes(".")) throw new Error("Impossible d\'identifier le projet Supabase pour l\'upload TUS.");\n  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;\n}\n\nfunction statusLabel(record: AudioImportRecord, en: boolean): string {\n  const labels: Record<string, [string, string]> = {\n    uploading: ["Téléversement source en attente ou interrompu", "Source upload waiting or interrupted"],\n    queued: ["En attente de préparation", "Waiting for preparation"],\n    downloading: ["Téléchargement du fichier source", "Downloading source file"],\n    verifying: ["Vérification audio et durée", "Checking audio and duration"],\n    splitting: ["Découpage automatique en segments", "Automatically splitting into segments"],\n    uploading_segments: ["Enregistrement des segments audio", "Saving audio segments"],\n    completed: ["Audio prêt : tu peux terminer l\'envoi", "Audio ready: you can finish uploading"],\n    failed: ["Préparation interrompue", "Preparation failed"],\n  };\n  const [fr, eng] = labels[record.status === "processing" ? record.phase : record.status] ||\n    labels[record.status] || ["Préparation audio", "Audio preparation"];\n  return en ? eng : fr;\n}\n\nfunction readableSize(bytes: number, en: boolean): string {\n  const value = bytes / (1024 * 1024);\n  return `${value.toLocaleString(en ? "en-US" : "fr-FR", { maximumFractionDigits: 1 })} MiB`;\n}\n\nexport function OriaLongAudioImport({\n  courseId, userId, language, enabled, disabled = false, onBusyChange, onComplete,\n}: Props) {\n  const en = language === "en";\n  const tr = (fr: string, eng: string) => en ? eng : fr;\n  const [record, setRecord] = useState<AudioImportRecord | null>(null);\n  const [checking, setChecking] = useState(enabled);\n  const [transferring, setTransferring] = useState(false);\n  const [transferPercent, setTransferPercent] = useState(0);\n  const [sourceUploaded, setSourceUploaded] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n  const [notice, setNotice] = useState<string | null>(null);\n  const inputRef = useRef<HTMLInputElement>(null);\n  const uploadRef = useRef<TusUpload | null>(null);\n  const mountedRef = useRef(true);\n  const onBusyChangeRef = useRef(onBusyChange);\n  const onCompleteRef = useRef(onComplete);\n  const currentCourseRef = useRef(courseId);\n  const notifiedCompleteRef = useRef<string | null>(null);\n  currentCourseRef.current = courseId;\n  const fileSignatureKey = userId ? storageKey(userId, courseId) : null;\n\n  onBusyChangeRef.current = onBusyChange;\n  onCompleteRef.current = onComplete;\n\n  function applyRecord(next: AudioImportRecord | null) {\n    if (!mountedRef.current || currentCourseRef.current !== courseId) return;\n    setRecord(next);\n    if (next?.status === "completed" && notifiedCompleteRef.current !== next.id) {\n      notifiedCompleteRef.current = next.id;\n      onCompleteRef.current();\n    }\n  }\n\n  async function loadLatest() {\n    if (!enabled) {\n      setChecking(false);\n      applyRecord(null);\n      return;\n    }\n    setChecking(true);\n    try {\n      const response = await apiFetch<{ audio_import: AudioImportRecord | null }>(\n        `/courses/${encodeURIComponent(courseId)}/audio-imports/latest`,\n      );\n      applyRecord(response.audio_import || null);\n      if (response.audio_import?.status === "uploading" && userId) {\n        const saved = readSavedImport(storageKey(userId, courseId));\n        if (saved && saved.importId === response.audio_import.id) setSourceUploaded(saved.uploaded);\n      }\n    } catch (loadError) {\n      setError(loadError instanceof Error ? loadError.message : tr("Impossible de vérifier l\'import audio.", "Could not check audio import."));\n    } finally {\n      if (mountedRef.current) setChecking(false);\n    }\n  }\n\n  useEffect(() => {\n    mountedRef.current = true;\n    setRecord(null);\n    setSourceUploaded(false);\n    setTransferPercent(0);\n    setError(null);\n    setNotice(null);\n    void loadLatest();\n    return () => {\n      mountedRef.current = false;\n      if (uploadRef.current) void uploadRef.current.abort();\n    };\n  }, [courseId, enabled, userId]);\n\n  const blocked = checking || transferring || Boolean(record && record.status !== "completed");\n  useEffect(() => {\n    onBusyChangeRef.current(blocked);\n  }, [blocked]);\n\n  useEffect(() => {\n    if (!enabled || !record || !["queued", "processing"].includes(record.status)) return;\n    let cancelled = false;\n    const poll = async () => {\n      try {\n        const response = await apiFetch<{ audio_import: AudioImportRecord }>(\n          `/courses/${encodeURIComponent(courseId)}/audio-imports/${encodeURIComponent(record.id)}`,\n        );\n        if (!cancelled) applyRecord(response.audio_import);\n      } catch (pollError) {\n        if (!cancelled && mountedRef.current) {\n          setError(pollError instanceof Error ? pollError.message : tr("Impossible d\'actualiser la préparation.", "Could not refresh preparation."));\n        }\n      }\n    };\n    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 4000);\n    void poll();\n    return () => { cancelled = true; window.clearInterval(timer); };\n  }, [courseId, enabled, record?.id, record?.status]);\n\n  useEffect(() => () => { onBusyChangeRef.current(false); }, []);\n\n  async function finalizeImport(importId: string) {\n    const response = await apiFetch<{ audio_import: AudioImportRecord; queued: boolean }>(\n      `/courses/${encodeURIComponent(courseId)}/audio-imports/${encodeURIComponent(importId)}/complete`,\n      { method: "POST" },\n    );\n    applyRecord(response.audio_import);\n    setSourceUploaded(true);\n    setNotice(tr("Fichier reçu. ORIA prépare maintenant les segments audio.", "File received. ORIA is now preparing the audio segments."));\n  }\n\n  async function uploadLongAudio(file: File) {\n    if (!enabled || disabled || !userId) return;\n    setError(null);\n    setNotice(null);\n    const mimeType = normalizedFileMime(file);\n    if (!SUPPORTED_AUDIO_MIME.has(mimeType)) {\n      setError(tr("Format audio non pris en charge. Utilise MP3, M4A, WAV, AAC, OGG ou WEBM.",\n        "Unsupported audio format. Use MP3, M4A, WAV, AAC, OGG or WEBM."));\n      return;\n    }\n    if (!file.size || file.size > MAX_AUDIO_BYTES) {\n      setError(tr("Le fichier doit peser au maximum 512 Mio.", "The file must be no larger than 512 MiB."));\n      return;\n    }\n    if (record && record.status !== "completed") {\n      const same = record.filename === file.name && record.size_bytes === file.size && record.mime_type === mimeType;\n      if (!same) {\n        setError(tr("Un import est déjà en cours. Réselectionne exactement le même fichier pour le reprendre, ou termine d\'abord sa préparation.",\n          "An import is already in progress. Select the exact same file to resume it, or finish its preparation first."));\n        return;\n      }\n      if (["queued", "processing", "failed"].includes(record.status)) {\n        setNotice(tr("Le fichier est déjà transféré. Utilise l\'action de reprise de préparation ci-dessous.",\n          "The file has already been uploaded. Use the preparation retry action below."));\n        return;\n      }\n    }\n\n    const key = storageKey(userId, courseId);\n    const saved = readSavedImport(key);\n    const matchingSaved = matchesFile(saved, file, mimeType) ? saved : null;\n    const importId = record && record.status === "uploading" && record.filename === file.name &&\n      record.size_bytes === file.size && record.mime_type === mimeType\n      ? record.id : matchingSaved?.importId || crypto.randomUUID();\n    const savedState: SavedAudioImport = {\n      importId, filename: file.name, mimeType, sizeBytes: file.size,\n      lastModified: file.lastModified, uploaded: matchingSaved?.uploaded === true,\n    };\n    window.localStorage.setItem(key, JSON.stringify(savedState));\n    setTransferring(true);\n    setTransferPercent(0);\n    setSourceUploaded(savedState.uploaded);\n\n    try {\n      const created = await apiFetch<AudioImportResponse>(`/courses/${encodeURIComponent(courseId)}/audio-imports`, {\n        method: "POST",\n        body: JSON.stringify({ import_id: importId, filename: file.name, mime_type: mimeType, size_bytes: file.size }),\n      });\n      applyRecord(created.audio_import);\n      if (created.audio_import.status !== "uploading") {\n        setNotice(tr("Cet import est déjà en cours de préparation.", "This import is already being prepared."));\n        return;\n      }\n\n      // Après une fermeture juste après l\'envoi, l\'objet peut être complet même si\n      // le navigateur n\'a pas reçu la confirmation. La finalisation fait foi.\n      if (savedState.uploaded) {\n        try {\n          await finalizeImport(importId);\n          return;\n        } catch {\n          // L\'objet n\'était pas encore complet : reprendre ou relancer le TUS ci-dessous.\n        }\n      }\n\n      const { data: { session } } = await supabase.auth.getSession();\n      if (!session?.access_token) throw new Error(tr("Session Supabase expirée. Reconnecte-toi.", "Supabase session expired. Please sign in again."));\n      const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;\n      if (!publicKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY est absente de la configuration Frontend.");\n      const tus = await import("tus-js-client");\n      const upload = new tus.Upload(file, {\n        endpoint: supabaseTusEndpoint(),\n        retryDelays: [0, 3000, 5000, 10000, 20000],\n        headers: { authorization: `Bearer ${session.access_token}`, apikey: publicKey },\n        metadata: {\n          bucketName: created.bucket,\n          objectName: created.object_name,\n          contentType: mimeType,\n          cacheControl: "3600",\n        },\n        uploadDataDuringCreation: true,\n        removeFingerprintOnSuccess: true,\n        storeFingerprintForResuming: true,\n        chunkSize: created.chunk_size_bytes || FALLBACK_CHUNK_BYTES,\n        onProgress: (bytesUploaded, bytesTotal) => {\n          if (mountedRef.current && bytesTotal > 0) setTransferPercent(Math.min(100, Math.round(bytesUploaded / bytesTotal * 100)));\n        },\n        onError: (uploadError) => {\n          if (!mountedRef.current) return;\n          // Un objet peut avoir été finalisé côté Storage même si la dernière\n          // réponse TUS s\'est perdue : tenter la mise en file avant d\'afficher l\'échec.\n          void finalizeImport(importId).then(() => {\n            if (mountedRef.current) setTransferPercent(100);\n          }).catch(() => {\n            if (mountedRef.current) setError(uploadError instanceof Error ? uploadError.message : String(uploadError));\n          }).finally(() => {\n            if (mountedRef.current) setTransferring(false);\n          });\n        },\n        onSuccess: () => {\n          void (async () => {\n            const uploadedState = { ...savedState, uploaded: true };\n            window.localStorage.setItem(key, JSON.stringify(uploadedState));\n            if (mountedRef.current) { setSourceUploaded(true); setTransferPercent(100); }\n            await finalizeImport(importId);\n          })().catch((finalizeError) => {\n            if (mountedRef.current) setError(finalizeError instanceof Error ? finalizeError.message : tr("Le fichier est envoyé, mais sa mise en file a échoué. Réessaie la finalisation.", "The file uploaded, but queueing failed. Retry finalization."));\n          }).finally(() => {\n            if (mountedRef.current) setTransferring(false);\n          });\n        },\n      });\n      uploadRef.current = upload;\n      await upload.findPreviousUploads().then((previousUploads) => {\n        const previous = previousUploads.find((item) =>\n          item.metadata?.bucketName === created.bucket && item.metadata?.objectName === created.object_name,\n        );\n        if (previous) upload.resumeFromPreviousUpload(previous);\n        upload.start();\n      });\n      // tus.Upload est piloté par callbacks : le transfert continue après ce point.\n      setNotice(tr("Transfert TUS lancé. Tu peux laisser ORIA reprendre automatiquement en cas de coupure.",\n        "TUS transfer started. ORIA can resume automatically after a connection interruption."));\n    } catch (uploadError) {\n      setError(uploadError instanceof Error ? uploadError.message : tr("Le transfert audio a échoué.", "Audio transfer failed."));\n      setTransferring(false);\n    }\n  }\n\n  async function retryPreparation() {\n    if (!record || record.status !== "failed") return;\n    setError(null);\n    setNotice(null);\n    setChecking(true);\n    try {\n      const response = await apiFetch<{ audio_import: AudioImportRecord; queued: boolean }>(\n        `/courses/${encodeURIComponent(courseId)}/audio-imports/${encodeURIComponent(record.id)}/retry`,\n        { method: "POST" },\n      );\n      applyRecord(response.audio_import);\n      setNotice(tr("La préparation a été remise en file.", "Preparation has been queued again."));\n    } catch (retryError) {\n      setError(retryError instanceof Error ? retryError.message : tr("Impossible de relancer la préparation.", "Could not retry preparation."));\n    } finally {\n      if (mountedRef.current) setChecking(false);\n    }\n  }\n\n  const canSelect = enabled && !disabled && !checking && !transferring &&\n    (!record || record.status === "uploading");\n  const statusText = record ? statusLabel(record, en) : "";\n\n  return (\n    <div className="mt-3 rounded-xl border border-border bg-surface-secondary p-3 sm:p-4">\n      <div className="flex flex-wrap items-start justify-between gap-3">\n        <div className="min-w-0 flex-1">\n          <div className="flex items-center gap-2 text-sm font-semibold">\n            <FileAudio size={17}/>{tr("Importer un fichier audio long", "Import a long audio file")}\n          </div>\n          <p className="mt-1 text-xs leading-5 text-muted">\n            {tr("Un seul fichier jusqu\'à 4 heures et 512 Mio. ORIA le vérifie et le découpe automatiquement en segments. Le transfert est reprenable après une coupure.",\n              "One file up to 4 hours and 512 MiB. ORIA verifies it and automatically splits it into segments. The transfer can resume after an interruption.")}\n          </p>\n        </div>\n        <input\n          ref={inputRef}\n          type="file"\n          className="hidden"\n          accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/aac,audio/3gpp,.webm,.ogg,.m4a,.mp3,.wav,.aac,.3gp"\n          onChange={(event) => {\n            const selected = event.currentTarget.files?.[0] || null;\n            event.currentTarget.value = "";\n            if (selected) void uploadLongAudio(selected);\n          }}\n        />\n        <button\n          type="button"\n          onClick={() => inputRef.current?.click()}\n          disabled={!canSelect}\n          className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"\n        >\n          <UploadCloud size={15}/>{record?.status === "uploading"\n            ? tr("Reprendre le fichier", "Resume file") : tr("Choisir un fichier", "Choose file")}\n        </button>\n      </div>\n\n      {!enabled ? (\n        <p className="mt-3 text-xs text-muted">\n          {tr("L\'import audio long sera disponible après activation du service sur le backend. L\'import par petits segments reste accessible.",\n            "Long-audio import will be available after the backend service is enabled. Manual short-segment uploads remain available.")}\n        </p>\n      ) : null}\n      {checking ? <p className="mt-3 flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin"/>{tr("Vérification de l\'import précédent…", "Checking previous import…")}</p> : null}\n\n      {record ? (\n        <div className="mt-3 rounded-lg border border-border bg-background p-3" role="status">\n          <div className="flex flex-wrap items-start justify-between gap-2">\n            <div className="min-w-0">\n              <p className="break-all text-xs font-semibold">{record.filename}</p>\n              <p className="mt-1 text-[11px] text-muted">{readableSize(record.size_bytes, en)} · {statusText}</p>\n            </div>\n            <strong className="text-xs tabular-nums">{record.progress_percent || 0}%</strong>\n          </div>\n          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary">\n            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, record.progress_percent || 0))}%` }}/>\n          </div>\n          {record.status === "failed" ? (\n            <button type="button" onClick={() => void retryPreparation()} disabled={checking}\n              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">\n              <RefreshCw size={14}/>{tr("Relancer la préparation", "Retry preparation")}\n            </button>\n          ) : null}\n          {record.status === "completed" ? (\n            <p className="mt-2 text-xs text-muted">\n              {tr(`${record.segment_count || 0} segments préparés. Vérifie la durée puis termine l\'envoi audio.`,\n                `${record.segment_count || 0} segments prepared. Check the duration, then finish uploading audio.`)}\n            </p>\n          ) : null}\n          {record.status === "uploading" && !transferring ? (\n            <p className="mt-2 text-xs text-muted">\n              {tr("Sélectionne à nouveau le même fichier pour reprendre le transfert à son dernier point sauvegardé.",\n                "Select the same file again to resume from the last saved upload position.")}\n            </p>\n          ) : null}\n        </div>\n      ) : null}\n\n      {transferring ? (\n        <div className="mt-3" role="status">\n          <div className="flex items-center justify-between gap-2 text-xs">\n            <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin"/>{tr("Transfert du fichier source", "Uploading source file")}</span>\n            <strong className="tabular-nums">{transferPercent}%</strong>\n          </div>\n          <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">\n            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${transferPercent}%` }}/>\n          </div>\n        </div>\n      ) : null}\n      {sourceUploaded && record?.status === "uploading" && !transferring ? (\n        <button type="button" onClick={() => {\n          void finalizeImport(record.id).catch((finalizeError) => setError(\n            finalizeError instanceof Error ? finalizeError.message : tr("Impossible de finaliser la préparation.", "Could not finalize preparation."),\n          ));\n        }} className="mt-3 rounded-lg border border-border px-3 py-2 text-xs font-semibold">\n          {tr("Finaliser la préparation", "Finalize preparation")}\n        </button>\n      ) : null}\n      {notice ? <p className="mt-2 text-xs text-muted">{notice}</p> : null}\n      {error ? <p className="mt-2 whitespace-pre-wrap text-xs text-red-600">{error}</p> : null}\n      {disabled ? <p className="mt-2 text-[11px] text-muted">{tr("Pour éviter de mélanger deux sources audio, l\'import long n\'est pas disponible sur cet enregistrement déjà segmenté ou occupé.",\n        "To avoid mixing audio sources, long-audio import is unavailable while this recording already has segments or is busy.")}</p> : null}\n    </div>\n  );\n}\n'


def fail(message: str) -> None:
    raise RuntimeError(message)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        fail(f"Ancre '{label}' attendue une seule fois, trouvée {count}. Aucun fichier écrit.")
    return source.replace(old, new, 1)


def main() -> int:
    for path in (WORKSPACE, PACKAGE):
        if not path.is_file():
            fail(f"Fichier requis introuvable : {path.relative_to(ROOT)}")
    if COMPONENT.exists():
        fail("OriaLongAudioImport.tsx existe déjà. Aucun écrasement : vérifie le chantier 3B.")

    workspace_text = WORKSPACE.read_text(encoding="utf-8")
    package_text = PACKAGE.read_text(encoding="utf-8")
    try:
        package_data = json.loads(package_text)
    except json.JSONDecodeError as exc:
        fail(f"Frontend/package.json n'est pas un JSON valide : {exc}")

    if 'from "./OriaLongAudioImport"' in workspace_text or "OriaLongAudioImport" in workspace_text:
        fail("Le workspace contient déjà une référence à OriaLongAudioImport. Aucun changement appliqué.")
    if "tus-js-client" in package_data.get("dependencies", {}):
        fail("tus-js-client est déjà déclaré dans package.json. Vérifie sa version avant application.")
    if 'longAudioImportBlocked' in workspace_text:
        fail("Le verrou d'import audio long est déjà présent dans le workspace.")

    updated = workspace_text
    updated = replace_once(
        updated,
        'import { createClient } from "@/lib/supabase/client";\n',
        'import { createClient } from "@/lib/supabase/client";\nimport { OriaLongAudioImport } from "./OriaLongAudioImport";\n',
        "import du composant d'import long",
    )
    updated = replace_once(
        updated,
        '  maximum_segments: number;\n};',
        '  maximum_segments: number;\n  long_audio_import_enabled?: boolean;\n};',
        "capacité serveur long-audio",
    )
    updated = replace_once(
        updated,
        '  const [uploading, setUploading] = useState(false);\n',
        '  const [uploading, setUploading] = useState(false);\n  const [longAudioImportBlocked, setLongAudioImportBlocked] = useState(true);\n',
        "état de blocage pendant un import long",
    )
    updated = replace_once(
        updated,
        '    setQuote(null); setJob(null); setCourse(null); setArtifacts([]); setSegments([]);\n',
        '    setQuote(null); setJob(null); setCourse(null); setArtifacts([]); setSegments([]);\n    setLongAudioImportBlocked(true);\n',
        "verrou pendant ouverture d'un enregistrement",
    )
    updated = replace_once(
        updated,
        '      setCourse(result.course); setSegments([]); setJob(null); setQuote(null); setArtifacts([]);\n',
        '      setCourse(result.course); setSegments([]); setJob(null); setQuote(null); setArtifacts([]);\n      setLongAudioImportBlocked(true);\n',
        "réinitialisation import long à la création",
    )
    updated = replace_once(
        updated,
        '  async function downloadCourseArtifact(item: OriaCourseArtifact) {\n',
        '  async function handleLongAudioImportComplete() {\n'
        '    const cid = courseIdRef.current;\n'
        '    if (!cid || !mountedRef.current) return;\n'
        '    try {\n'
        '      await refreshCourse(cid, false);\n'
        '      setInfo(tr("Le fichier long a été découpé. Vérifiez la durée puis terminez l\'envoi audio.",\n'
        '        "The long file was split. Check the duration, then finish uploading audio."));\n'
        '    } catch (error) { setLocalError(courseErrorMessage(error)); }\n'
        '  }\n\n'
        '  async function downloadCourseArtifact(item: OriaCourseArtifact) {\n',
        "rafraîchissement après préparation audio",
    )
    updated = replace_once(
        updated,
        '    setCourse(courseResponse.course);\n',
        '    setCourse(courseResponse.course);\n    if (courseResponse.course.status !== "uploading") setLongAudioImportBlocked(false);\n',
        "réinitialisation du verrou pour un enregistrement déjà soumis",
    )
    updated = replace_once(
        updated,
        '    if (!course || course.status !== "uploading" || recording || uploading || segmentQueueRef.current.length || !segments.length || busy) return;\n',
        '    if (!course || course.status !== "uploading" || recording || uploading || longAudioImportBlocked || segmentQueueRef.current.length || !segments.length || busy) return;\n',
        "blocage submit pendant import long",
    )
    updated = replace_once(
        updated,
        '    if (!files || !course || course.status !== "uploading" || recording || uploading || segmentQueueRef.current.length) return;\n',
        '    if (!files || !course || course.status !== "uploading" || recording || uploading || longAudioImportBlocked || segmentQueueRef.current.length) return;\n',
        "blocage des segments manuels pendant import long",
    )
    updated = replace_once(
        updated,
        '    if (recording || uploading || busy || segmentQueueRef.current.length > 0) return;\n',
        '    if (recording || uploading || longAudioImportBlocked || busy || segmentQueueRef.current.length > 0) return;\n',
        "protection contre le changement d'enregistrement pendant import long",
    )
    updated = replace_once(
        updated,
        '            {recentCourses.map((id) => <button key={id} type="button" disabled={recording || uploading || !!busy || !!segmentQueueRef.current.length}\n',
        '            {recentCourses.map((id) => <button key={id} type="button" disabled={recording || uploading || longAudioImportBlocked || !!busy || !!segmentQueueRef.current.length}\n',
        "désactivation de l'historique pendant import long",
    )
    updated = replace_once(
        updated,
        """                  <p className="mt-1 text-xs leading-5 text-muted">{tr("Chaque segment est un fichier audio autonome de 5 min maximum, 20 Mio. Jusqu'à 4 h au total. Un grand fichier doit être découpé avant import.",
                    "Each segment must be a standalone audio file: 5 min / 20 MiB maximum, 4 h total. Split large files before import.")}</p>
""",
        """                  <p className="mt-1 text-xs leading-5 text-muted">{tr("En mode manuel, chaque segment audio doit durer au plus 5 min et peser 20 Mio. La durée totale est limitée à 4 h. Pour un fichier unique plus long, utilisez le module audio long ci-dessus.",
                    "For manual uploads, each segment must be no longer than 5 min and no larger than 20 MiB. Total audio is limited to 4 h. For one larger file, use the long-audio module above.")}</p>
""",
        "clarification des deux modes d'import audio",
    )
    updated = replace_once(
        updated,
        '    if (!course || course.status !== "uploading" || recording || recordingActiveRef.current || uploading || segmentQueueRef.current.length) return;\n',
        '    if (!course || course.status !== "uploading" || recording || recordingActiveRef.current || uploading || longAudioImportBlocked || segmentQueueRef.current.length) return;\n',
        "blocage micro pendant import long",
    )
    updated = replace_once(
        updated,
        '  const canChangeDraft = !recording && !uploading && segmentQueueRef.current.length === 0 && !busy;\n',
        '  const canChangeDraft = !recording && !uploading && !longAudioImportBlocked && segmentQueueRef.current.length === 0 && !busy;\n',
        "verrou changement de brouillon",
    )
    updated = replace_once(
        updated,
        '  const canReturnToChat = !recording && !recordingActiveRef.current && !uploading &&\n    !uploadLockRef.current && segmentQueueRef.current.length === 0 && !busy;\n',
        '  const canReturnToChat = !loading && (!course || !longAudioImportBlocked) && !recording && !recordingActiveRef.current && !uploading &&\n    !uploadLockRef.current && segmentQueueRef.current.length === 0 && !busy;\n',
        "verrou sortie pendant import long",
    )
    updated = replace_once(
        updated,
        '                  <div className="mt-3 flex flex-wrap gap-2">\n',
        '                  <OriaLongAudioImport\n'
        '                    key={course.id}\n'
        '                    courseId={course.id}\n'
        '                    userId={userId}\n'
        '                    language={language}\n'
        '                    enabled={capabilities?.long_audio_import_enabled === true}\n'
        '                    disabled={recording || uploading || !!busy || segments.length > 0}\n'
        '                    onBusyChange={setLongAudioImportBlocked}\n'
        '                    onComplete={handleLongAudioImportComplete}\n'
        '                  />\n'
        '                  <div className="mt-3 flex flex-wrap gap-2">\n',
        "insertion interface import long",
    )
    updated = replace_once(
        updated,
        '                      disabled={recording || uploading || !!busy || segmentQueueRef.current.length > 0}\n',
        '                      disabled={recording || uploading || longAudioImportBlocked || !!busy || segmentQueueRef.current.length > 0}\n',
        "désactivation import manuel pendant import long",
    )
    updated = replace_once(
        updated,
        '                      <button type="button" disabled={uploading || !!busy || segmentQueueRef.current.length > 0}\n',
        '                      <button type="button" disabled={uploading || longAudioImportBlocked || !!busy || segmentQueueRef.current.length > 0}\n',
        "désactivation enregistrement micro pendant import long",
    )
    updated = replace_once(
        updated,
        '                      <button type="button" onClick={() => void startCourseRecording()}\n',
        '                      <button type="button" onClick={() => void startCourseRecording()} disabled={longAudioImportBlocked}\n',
        "verrou autorisation micro pendant import long",
    )

    dependencies = package_data.setdefault("dependencies", {})
    dependencies["tus-js-client"] = "^4.3.1"
    # Préserver l'ordre des dépendances, en insérant à côté des autres paquets t*.
    package_data["dependencies"] = dict(sorted(dependencies.items(), key=lambda item: item[0].lower()))
    updated_package = json.dumps(package_data, ensure_ascii=False, indent=2) + "\n"

    # Contrôles de cohérence avant la moindre écriture.
    if updated == workspace_text:
        fail("Aucune modification du workspace n'a été produite.")
    if 'new tus.Upload' not in CHILD_SOURCE or 'audio-imports/latest' not in CHILD_SOURCE or 'chunkSize:' not in CHILD_SOURCE:
        fail("Le composant TUS intégré ne passe pas les contrôles statiques.")
    if "longAudioImportBlocked" not in updated or "OriaLongAudioImport" not in updated:
        fail("Le branchement du composant TUS est incomplet.")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    workspace_backup = WORKSPACE.with_name(WORKSPACE.name + f".bak-oria-audio-import-3b-{stamp}")
    package_backup = PACKAGE.with_name(PACKAGE.name + f".bak-oria-audio-import-3b-{stamp}")
    shutil.copy2(WORKSPACE, workspace_backup)
    shutil.copy2(PACKAGE, package_backup)
    COMPONENT.write_text(CHILD_SOURCE, encoding="utf-8", newline="\n")
    WORKSPACE.write_text(updated, encoding="utf-8", newline="\n")
    PACKAGE.write_text(updated_package, encoding="utf-8", newline="\n")

    print("OK : interface frontend ORIA Transcription — chantier 3B installée.")
    print("Fichier créé :")
    print(" - Frontend/components/oria-transcription/OriaLongAudioImport.tsx")
    print("Fichiers modifiés :")
    print(" - Frontend/components/oria-transcription/OriaTranscriptionWorkspace.tsx")
    print(" - Frontend/package.json")
    print("Sauvegardes :")
    print(" - " + str(workspace_backup.relative_to(ROOT)))
    print(" - " + str(package_backup.relative_to(ROOT)))
    print("Dépendance ajoutée : tus-js-client ^4.3.1")
    print("Aucun changement backend, Supabase ou GitHub.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        raise SystemExit(1)
