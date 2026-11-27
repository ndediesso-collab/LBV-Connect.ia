"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen, Download, Loader2, Mic, Plus,
  RotateCcw, Square, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { OriaLongAudioImport } from "./OriaLongAudioImport";

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

type CourseCapabilities = {
  pack_active: boolean;
  writing_models: string[];
  document_formats: string[];
  maximum_duration_ms: number;
  maximum_segment_duration_ms: number;
  maximum_segment_bytes: number;
  maximum_segments: number;
  long_audio_import_enabled?: boolean;
};
type OriaCourseRecord = {
  id: string;
  title: string;
  document_format: string;
  document_type?: OriaDocumentType;
  status: string;
  submitted_duration_ms?: number | null;
  submitted_segment_count?: number | null;
};
type OriaCourseSegment = {
  index: number;
  duration_ms: number;
  size_bytes: number;
  mime_type: string;
};
type OriaCourseJob = {
  status: string;
  transcription_reservation_status?: string;
  document_reservation_status?: string;
  document_ready?: boolean;
  requires_manual_review?: boolean;
  awaiting_credits?: boolean;
  transcription_paid?: boolean;
  resume_available?: boolean;
  writing_reservation_required_credits?: number | null;
  next_action?: string;
};
type OriaCourseQuote = {
  estimated_total_credits: number;
  maximum_reserved_credits: number;
  transcription_reservation_credits: number;
  document_reservation_credits: number;
  duration_ms: number;
  segments: number;
  writing_model: string;
  document_format: string;
  requires_confirmation: boolean;
  note?: string;
};
type OriaCourseQuoteResponse = {
  quote: OriaCourseQuote;
  quote_token: string;
  expires_at: string;
};
type OriaCourseArtifact = {
  kind: "document" | "transcript";
  id: string;
  filename: string;
  extension: string;
  size_bytes: number;
};
type QueuedCourseSegment = { index: number; file: File };

const ORIA_COURSE_MAX_MS = 4 * 60 * 60 * 1000;
const ORIA_COURSE_SEGMENT_MS = 285_000; // 4 min 45 s : marge sous le maximum serveur de 5 min.
const ORIA_COURSE_MAX_BYTES = 20 * 1024 * 1024;
const ORIA_COURSE_FORMATS: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/aac": "aac", "audio/3gpp": "3gp",
  "audio/x-m4a": "m4a", "audio/m4a": "m4a",
};

function courseDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
}
function courseStorageKey(userId: string, documentType: OriaDocumentType) {
  // Le brouillon Cours historique garde sa clé ; les nouveaux services ont chacun leur brouillon.
  return documentType === "course"
    ? `oria_course_draft_v1_${userId}`
    : `oria_transcription_draft_v1_${documentType}_${userId}`;
}
function courseHistoryKey(userId: string) {
  return `oria_course_ids_v1_${userId}`;
}
function courseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Impossible de terminer cette opération.";
}

export function OriaTranscriptionWorkspace({ language, wallet, userId, documentType, onDocumentTypeChange, onWalletRefresh, onClose }: {
  language: OriaLanguage;
  wallet: WalletData | null;
  userId: string | null;
  documentType: OriaDocumentType;
  onDocumentTypeChange: (value: OriaDocumentType) => void;
  onWalletRefresh: () => void;
  onClose: () => void;
}) {
  const en = language === "en";
  const tr = (fr: string, eng: string) => en ? eng : fr;
  const service = TRANSCRIPTION_SERVICES[documentType];
  const [capabilities, setCapabilities] = useState<CourseCapabilities | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [course, setCourse] = useState<OriaCourseRecord | null>(null);
  const [job, setJob] = useState<OriaCourseJob | null>(null);
  const [segments, setSegments] = useState<OriaCourseSegment[]>([]);
  const writingModel = "luna"; // ORIA Transcription exclusivement, independamment du Chat general.
  const [quote, setQuote] = useState<OriaCourseQuoteResponse | null>(null);
  const [artifacts, setArtifacts] = useState<OriaCourseArtifact[]>([]);
  const [recentCourses, setRecentCourses] = useState<string[]>([]);
  const [playback, setPlayback] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState("");
  const [uploading, setUploading] = useState(false);
  const [longAudioImportBlocked, setLongAudioImportBlocked] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmationUncertain, setConfirmationUncertain] = useState(false);
  const [resumeUncertain, setResumeUncertain] = useState(false);
  const [readyToRecord, setReadyToRecord] = useState(false);
  const [loading, setLoading] = useState(true);
  const courseIdRef = useRef<string | null>(null);
  const nextIndexRef = useRef(0);
  const segmentQueueRef = useRef<QueuedCourseSegment[]>([]);
  const uploadLockRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const currentRecorderRef = useRef<MediaRecorder | null>(null);
  const courseStreamRef = useRef<MediaStream | null>(null);
  const currentRecorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderClockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderStartedAtRef = useRef(0);
  const recordedBeforeRef = useRef(0);
  const recordedMsRef = useRef(0);
  const mountedRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function stopCourseRecorder() {
    recordingActiveRef.current = false;
    if (currentRecorderTimerRef.current) clearTimeout(currentRecorderTimerRef.current);
    currentRecorderTimerRef.current = null;
    if (recorderClockRef.current) clearInterval(recorderClockRef.current);
    recorderClockRef.current = null;
    const active = currentRecorderRef.current;
    if (active && active.state === "recording") active.stop();
    else {
      courseStreamRef.current?.getTracks().forEach((track) => track.stop());
      courseStreamRef.current = null;
    }
    if (mountedRef.current) setRecording(false);
  }

  useEffect(() => {
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      if (recordingActiveRef.current || uploadLockRef.current || segmentQueueRef.current.length > 0) {
        event.preventDefault();
        event.returnValue = ""; // Le navigateur gère le message de confirmation.
      }
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    mountedRef.current = true;
    return () => {
      window.removeEventListener("beforeunload", warnBeforeExit);
      // Quitter le mode Cours arrête le microphone : ne jamais enregistrer en cachette.
      mountedRef.current = false;
      recordingActiveRef.current = false;
      if (currentRecorderTimerRef.current) clearTimeout(currentRecorderTimerRef.current);
      if (recorderClockRef.current) clearInterval(recorderClockRef.current);
      if (currentRecorderRef.current?.state === "recording") currentRecorderRef.current.stop();
      courseStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function refreshCourse(cid: string, refreshFiles = true) {
    const [courseResponse, segmentResponse] = await Promise.all([
      apiFetch<{ course: OriaCourseRecord; job: OriaCourseJob | null }>(`/courses/${encodeURIComponent(cid)}`),
      apiFetch<{ segments: OriaCourseSegment[] }>(`/courses/${encodeURIComponent(cid)}/segments`),
    ]);
    if (!mountedRef.current || courseIdRef.current !== cid) return;
    setCourse(courseResponse.course);
    if (courseResponse.course.status !== "uploading") setLongAudioImportBlocked(false);
    const storedType: OriaDocumentType = isOriaDocumentType(courseResponse.course.document_type)
      ? courseResponse.course.document_type : "course";
    onDocumentTypeChange(storedType);
    if (userId) window.localStorage.setItem(courseStorageKey(userId, storedType), cid);
    setTitle(courseResponse.course.title);
    setFormat(courseResponse.course.document_format === "docx" ? "docx" : "pdf");
    setJob(courseResponse.job);
    const ordered = [...segmentResponse.segments].sort((a, b) => a.index - b.index);
    setSegments(ordered);
    nextIndexRef.current = Math.max(nextIndexRef.current, ...ordered.map((row) => row.index + 1), 0);
    if (refreshFiles && courseResponse.job?.status === "completed") {
      const delivered = await apiFetch<{ ready: boolean; artifacts: OriaCourseArtifact[] }>(
        `/courses/${encodeURIComponent(cid)}/artifacts`,
      );
      if (mountedRef.current && courseIdRef.current === cid) setArtifacts(delivered.ready ? delivered.artifacts : []);
    }
  }

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    const bootstrap = async () => {
      try {
        const limits = await apiFetch<CourseCapabilities>("/courses/capabilities");
        if (cancelled) return;
        setCapabilities(limits);

        let history: string[] = [];
        try {
          const saved = JSON.parse(window.localStorage.getItem(courseHistoryKey(userId)) || "[]");
          if (Array.isArray(saved)) history = saved.filter((id): id is string =>
            typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)).slice(0, 25);
        } catch { /* Historique local illisible : ignorer. */ }
        setRecentCourses(history);
        const last = window.localStorage.getItem(courseStorageKey(userId, documentType));
        if (last && /^[a-f0-9-]{36}$/i.test(last)) {
          if (!history.includes(last)) setRecentCourses([last, ...history].slice(0, 25));
          courseIdRef.current = last;
          try { await refreshCourse(last); }
          catch (error) {
            // Ne jamais oublier un cours après un simple incident réseau.
            if (!cancelled) setLocalError(courseErrorMessage(error));
          }
        }
      } catch (error) {
        if (!cancelled) setLocalError(courseErrorMessage(error));
      } finally { if (!cancelled) setLoading(false); }
    };
    void bootstrap();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    const cid = course?.id;
    if (!cid || !["queued", "processing"].includes(job?.status || "") || confirmationUncertain) return;
    let cancelled = false;
    const poll = async () => {
      try { await refreshCourse(cid); }
      catch (error) { if (!cancelled) setLocalError(courseErrorMessage(error)); }
    };
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 7000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [course?.id, job?.status, confirmationUncertain]);

  function keepCourseId(cid: string) {
    courseIdRef.current = cid;
    if (userId) {
      window.localStorage.setItem(courseStorageKey(userId, documentType), cid);
      const recent = [cid, ...recentCourses.filter((id) => id !== cid)].slice(0, 25);
      setRecentCourses(recent);
      window.localStorage.setItem(courseHistoryKey(userId), JSON.stringify(recent));
    }
  }

  async function selectSavedCourse(cid: string) {
    if (recording || uploading || longAudioImportBlocked || busy || segmentQueueRef.current.length > 0) return;
    setBusy("open"); setLocalError(null);
    courseIdRef.current = cid;
    setQuote(null); setJob(null); setCourse(null); setArtifacts([]); setSegments([]);
    setLongAudioImportBlocked(true);
    setResumeUncertain(false); setConfirmationUncertain(false);
    nextIndexRef.current = 0;
    try {
      await refreshCourse(cid);
    } catch (error) { setLocalError(courseErrorMessage(error)); }
    finally { setBusy(""); }
  }

  async function createCourse() {
    if (!title.trim() || !capabilities?.pack_active || busy || recording || uploading) return;
    setBusy("create"); setLocalError(null); setInfo(null);
    try {
      const courseUuid = crypto.randomUUID();
      const result = await apiFetch<{ course: OriaCourseRecord }>("/courses", {
        method: "POST", body: JSON.stringify({ course_id: courseUuid, title: title.trim(), document_format: format, document_type: documentType }),
      });
      keepCourseId(result.course.id);
      nextIndexRef.current = 0; recordedMsRef.current = 0;
      setCourse(result.course); setSegments([]); setJob(null); setQuote(null); setArtifacts([]);
      setLongAudioImportBlocked(true);
      setResumeUncertain(false); setConfirmationUncertain(false);
      setConfirmationUncertain(false);
    } catch (error) { setLocalError(courseErrorMessage(error)); }
    finally { setBusy(""); }
  }

  async function uploadQueue() {
    if (uploadLockRef.current || !courseIdRef.current) return;
    uploadLockRef.current = true; setUploading(true);
    try {
      while (segmentQueueRef.current.length > 0) {
        const cid = courseIdRef.current;
        const item = segmentQueueRef.current[0];
        const form = new FormData();
        form.append("file", item.file, item.file.name);
        const data = await apiFetch<{ segment: OriaCourseSegment }>(
          `/courses/${encodeURIComponent(cid)}/segments/${item.index}`, { method: "PUT", body: form },
        );
        segmentQueueRef.current.shift();
        if (mountedRef.current) {
          setSegments((previous) => [...previous.filter((s) => s.index !== data.segment.index), data.segment]
            .sort((a, b) => a.index - b.index));
          setQuote(null); setInfo(null);
        }
      }
    } catch (error) {
      if (mountedRef.current) setLocalError(
        `${courseErrorMessage(error)} ${tr("Envoi arrêté : réessaie le segment conservé avant de soumettre l’enregistrement.",
          "Upload stopped: retry the retained segment before submitting.")}`,
      );
      stopCourseRecorder();
    } finally { uploadLockRef.current = false; if (mountedRef.current) setUploading(false); }
  }

  async function removeRejectedSegment() {
    if (uploadLockRef.current || recordingActiveRef.current || !courseIdRef.current) return;
    const pending = segmentQueueRef.current[0];
    if (!pending) return;
    setBusy("check-segment"); setLocalError(null);
    try {
      // Un timeout peut survenir APRÈS la persistance SQL. Vérifier le serveur
      // avant de retirer ou renuméroter un fragment : jamais perdre l'ordre.
      const response = await apiFetch<{ segments: OriaCourseSegment[] }>(
        `/courses/${encodeURIComponent(courseIdRef.current)}/segments`,
      );
      if (response.segments.some((item) => item.index === pending.index)) {
        segmentQueueRef.current.shift();
        setSegments(response.segments.slice().sort((a, b) => a.index - b.index));
        setInfo(tr("Le serveur avait déjà enregistré ce segment : reprise possible.",
          "The server already stored this segment: upload can resume."));
      } else {
        segmentQueueRef.current.shift();
        segmentQueueRef.current.forEach((item) => { if (item.index > pending.index) item.index--; });
        nextIndexRef.current = Math.max(0, nextIndexRef.current - 1);
        setInfo(tr("Segment rejeté retiré. Vous pouvez ajouter un fichier plus court.",
          "Rejected segment removed. You can upload a shorter file."));
      }
    } catch (error) { setLocalError(courseErrorMessage(error)); }
    finally { setBusy(""); }
  }

  function queueSegment(file: File) {
    if (!courseIdRef.current) throw new Error(tr("Créez d’abord un enregistrement.", "Create a recording first."));
    const mime = file.type.split(";")[0].toLowerCase();
    if (!(mime in ORIA_COURSE_FORMATS)) throw new Error(tr("Format audio non accepté.", "Unsupported audio format."));
    if (!file.size || file.size > Math.min(ORIA_COURSE_MAX_BYTES, capabilities?.maximum_segment_bytes || ORIA_COURSE_MAX_BYTES)) {
      throw new Error(tr("Chaque segment doit faire moins de 20 Mio.", "Each segment must be under 20 MiB."));
    }
    if (nextIndexRef.current >= (capabilities?.maximum_segments || 120)) throw new Error(tr("Nombre maximal de segments atteint.", "Maximum number of segments reached."));
    const index = nextIndexRef.current++;
    segmentQueueRef.current.push({ index, file });
    setQuote(null);
    void uploadQueue();
  }

  async function uploadSelectedFiles(files: FileList | null) {
    if (!files || !course || course.status !== "uploading" || recording || uploading || longAudioImportBlocked || segmentQueueRef.current.length) return;
    setLocalError(null);
    try {
      const selected = Array.from(files);
      if (selected.length + nextIndexRef.current > (capabilities?.maximum_segments || 120)) {
        throw new Error(tr("Trop de segments audio.", "Too many audio segments."));
      }
      // Le navigateur ne découpe pas artificiellement un grand audio : chaque fichier
      // doit être autonome et durer au plus 5 min, ce que ffprobe vérifie côté serveur.
      for (const file of selected) queueSegment(file);
    } catch (error) { setLocalError(courseErrorMessage(error)); }
  }

  function beginRecordingSegment(stream: MediaStream, mimeType: string) {
    if (!recordingActiveRef.current) return;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
    currentRecorderRef.current = recorder;
    const parts: BlobPart[] = [];
    const started = Date.now();
    recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    recorder.onerror = () => { setLocalError(tr("Erreur du microphone.", "Microphone error.")); stopCourseRecorder(); };
    recorder.onstop = () => {
      if (currentRecorderTimerRef.current) clearTimeout(currentRecorderTimerRef.current);
      recordedMsRef.current += Math.max(0, Date.now() - started);
      // Continuer d'enregistrer immédiatement, sans attendre l'upload réseau.
      const continueRecording = recordingActiveRef.current && recordedMsRef.current < ORIA_COURSE_MAX_MS &&
        nextIndexRef.current < (capabilities?.maximum_segments || 120) && stream.active;
      if (continueRecording) {
        try { beginRecordingSegment(stream, mimeType); }
        catch (error) { setLocalError(courseErrorMessage(error)); stopCourseRecorder(); }
      } else {
        recordingActiveRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        courseStreamRef.current = null;
        if (mountedRef.current) setRecording(false);
      }
      const mime = (recorder.mimeType || mimeType || "audio/webm").split(";")[0].toLowerCase();
      const bytes = new Blob(parts, { type: mime });
      if (bytes.size) {
        const suffix = ORIA_COURSE_FORMATS[mime] || "webm";
        try { queueSegment(new File([bytes], `oria-cours-${nextIndexRef.current}.${suffix}`, { type: mime })); }
        catch (error) { setLocalError(courseErrorMessage(error)); stopCourseRecorder(); }
      }
    };
    recorder.start();
    currentRecorderTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, Math.min(ORIA_COURSE_SEGMENT_MS, Math.max(1000, ORIA_COURSE_MAX_MS - recordedMsRef.current)));
  }

  async function startCourseRecording() {
    if (!course || course.status !== "uploading" || recording || recordingActiveRef.current || uploading || longAudioImportBlocked || segmentQueueRef.current.length) return;
    setLocalError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error(tr("Ce navigateur ne permet pas l'enregistrement audio.", "Audio recording is unavailable in this browser."));
      }
      const existingDuration = segments.reduce((sum, seg) => sum + seg.duration_ms, 0);
      if (existingDuration >= ORIA_COURSE_MAX_MS) throw new Error(tr("Durée maximale de quatre heures atteinte.", "Four-hour limit reached."));
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
        .find((item) => MediaRecorder.isTypeSupported(item));
      if (!mime) throw new Error(tr("Aucun format d'enregistrement compatible n'est disponible.",
        "This browser has no supported recording format."));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      courseStreamRef.current = stream;
      recordedMsRef.current = existingDuration;
      recordedBeforeRef.current = existingDuration;
      recorderStartedAtRef.current = Date.now();
      recordingActiveRef.current = true;
      setElapsed(0); setRecording(true); setReadyToRecord(false);
      beginRecordingSegment(stream, mime);
      recorderClockRef.current = setInterval(() => {
        if (mountedRef.current) setElapsed(Math.floor((Date.now() - recorderStartedAtRef.current) / 1000));
      }, 1000);
    } catch (error) { setLocalError(courseErrorMessage(error)); stopCourseRecorder(); }
  }

  async function submitCourse() {
    if (!course || course.status !== "uploading" || recording || uploading || longAudioImportBlocked || segmentQueueRef.current.length || !segments.length || busy) return;
    setBusy("submit"); setLocalError(null);
    try {
      const response = await apiFetch<{ course: OriaCourseRecord }>(`/courses/${course.id}/submit`, { method: "POST" });
      setCourse(response.course); setQuote(null); setInfo(tr("Audio soumis. Demandez maintenant un devis.", "Audio submitted. Request a quote."));
    } catch (error) { setLocalError(courseErrorMessage(error)); }
    finally { setBusy(""); }
  }

  async function requestQuote() {
    if (!course || course.status !== "queued" || !writingModel || busy) return;
    setBusy("quote"); setLocalError(null); setQuote(null);
    try {
      const result = await apiFetch<OriaCourseQuoteResponse>(`/courses/${course.id}/quote`, {
        method: "POST", body: JSON.stringify({ writing_model: writingModel }),
      });
      setQuote(result);
    } catch (error) { setLocalError(courseErrorMessage(error)); }
    finally { setBusy(""); }
  }

  async function confirmQuote() {
    if (!course || !quote || busy || confirmationUncertain || !wallet?.is_pack_active ||
      wallet.balance < (quote.quote.transcription_reservation_credits ?? quote.quote.maximum_reserved_credits)) return;
    if (Date.parse(quote.expires_at) <= Date.now()) {
      setQuote(null); setLocalError(tr("Devis expiré : demandez-en un nouveau.", "Quote expired: request a new one.")); return;
    }
    setBusy("confirm"); setLocalError(null);
    try {
      const outcome = await apiFetch<{ status: string; queued: boolean; message: string }>(`/courses/${course.id}/confirm`, {
        method: "POST", body: JSON.stringify({ quote_token: quote.quote_token, approved: true }),
      });
      setInfo(outcome.message || tr("Enregistrement placé dans la file.", "Recording queued."));
      setQuote(null);
      await refreshCourse(course.id);
      onWalletRefresh();
    } catch (error) {
      // Après un timeout réseau, la réservation peut avoir été écrite : jamais
      // réessayer automatiquement la confirmation ou effacer le cours.
      setConfirmationUncertain(true);
      setLocalError(`${courseErrorMessage(error)} ${tr("Vérifiez l’état de l’enregistrement avant toute nouvelle confirmation.",
        "Check the recording status before confirming again.")}`);
    } finally { setBusy(""); }
  }

  async function resumeCourse() {
    if (!course || !job || job.status !== "awaiting_credits" ||
        !job.resume_available || busy || resumeUncertain || !wallet?.is_pack_active) return;
    const amount = job.writing_reservation_required_credits;
    const alreadyReserved = job.document_reservation_status === "reserved";
    if (!alreadyReserved && (typeof amount !== "number" || amount <= 0 || wallet.balance < amount)) return;
    const amountText = typeof amount === "number" ? amount.toLocaleString(en ? "en-US" : "fr-FR") : "—";
    if (!window.confirm(tr(
      `Reprendre la rédaction avec GPT-6 Luna ? Jusqu'à ${amountText} crédits seront réservés pour cette étape uniquement. La transcription déjà réglée ne sera pas refacturée.`,
      `Resume writing with GPT-6 Luna? Up to ${amountText} credits will be reserved for this step only. The paid transcription will not be charged again.`
    ))) return;
    setBusy("resume"); setLocalError(null);
    try {
      const result = await apiFetch<{ status: string; message?: string }>(
        `/courses/${encodeURIComponent(course.id)}/resume`,
        { method: "POST", body: JSON.stringify({ approved: true }) },
      );
      setInfo(result.message || tr("Reprise de la rédaction enregistrée.", "Document writing resume submitted."));
      await refreshCourse(course.id);
      onWalletRefresh();
    } catch (error) {
      // Réponse incertaine : ne jamais répéter une réservation financière sans lire le serveur.
      setResumeUncertain(true);
      setLocalError(`${courseErrorMessage(error)} ${tr(
        "Actualisez le statut avant toute nouvelle tentative de reprise.",
        "Refresh status before attempting to resume again.")}`);
    } finally { setBusy(""); }
  }

  async function retryCourseStatus() {
    if (!course || busy) return;
    setBusy("refresh"); setLocalError(null);
    try {
      await refreshCourse(course.id);
      setConfirmationUncertain(false);
      setResumeUncertain(false);
      onWalletRefresh();
    } catch (error) { setLocalError(courseErrorMessage(error)); }
    finally { setBusy(""); }
  }

  async function openPlayback(index: number) {
    if (!course) return;
    try {
      const result = await apiFetch<{ playback_url: string }>(`/courses/${course.id}/segments/${index}/playback`);
      if (!/^https:\/\//i.test(result.playback_url)) throw new Error("URL privée invalide.");
      setPlayback((current) => ({ ...current, [index]: result.playback_url }));
    } catch (error) { setLocalError(courseErrorMessage(error)); }
  }

  async function handleLongAudioImportComplete() {
    const cid = courseIdRef.current;
    if (!cid || !mountedRef.current) return;
    try {
      await refreshCourse(cid, false);
      setInfo(tr("Le fichier long a été découpé. Vérifiez la durée puis terminez l'envoi audio.",
        "The long file was split. Check the duration, then finish uploading audio."));
    } catch (error) { setLocalError(courseErrorMessage(error)); }
  }

  async function downloadCourseArtifact(item: OriaCourseArtifact) {
    setLocalError(null);
    try {
      const response = await apiFetch<{ artifact: Record<string, unknown> }>(`/ai/artifacts/${encodeURIComponent(item.id)}`);
      const artifact = normalizeTranscriptionArtifact(response.artifact);
      if (!artifact?.downloadUrl || !/^https:\/\//i.test(artifact.downloadUrl)) throw new Error("Lien privé indisponible.");
      const binary = await fetch(artifact.downloadUrl);
      if (!binary.ok) throw new Error(tr("Téléchargement impossible.", "Download failed."));
      const url = URL.createObjectURL(await binary.blob());
      const element = document.createElement("a");
      element.href = url; element.download = item.filename; document.body.appendChild(element); element.click(); element.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { setLocalError(courseErrorMessage(error)); }
  }

  const totalMs = segments.reduce((sum, item) => sum + item.duration_ms, 0);
  const canChangeDraft = !recording && !uploading && !longAudioImportBlocked && segmentQueueRef.current.length === 0 && !busy;
  // Ne pas démonter le panneau tant qu'un audio ou une opération critique est actif.
  // Les cours déjà enregistrés sont retrouvés à la réouverture par leur ID local.
  const canReturnToChat = !loading && (!course || !longAudioImportBlocked) && !recording && !recordingActiveRef.current && !uploading &&
    !uploadLockRef.current && segmentQueueRef.current.length === 0 && !busy;
  const hasValidQuote = quote && Date.parse(quote.expires_at) > Date.now();
  const status = job?.status || course?.status || "uploading";
  const isCourseComplete = job?.status === "completed";
  const working = ["processing", "queued"].includes(job?.status || "");
  const awaitingCredits = job?.status === "awaiting_credits";
  const resumeNeeded = job?.writing_reservation_required_credits;
  const resumeFunded = job?.document_reservation_status === "reserved" ||
    (typeof resumeNeeded === "number" && resumeNeeded > 0 &&
      (wallet?.balance ?? 0) >= resumeNeeded);
  const initialReservation = quote?.quote.transcription_reservation_credits ?? quote?.quote.maximum_reserved_credits ?? 0;

  return (
    <section className="mx-auto mt-4 w-full max-w-3xl space-y-4" aria-label="ORIA Transcription">
      <div className="rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><BookOpen size={21}/><h2 className="text-lg font-semibold">ORIA Transcription</h2></div>
            <p className="mt-1 text-sm text-muted">{service.description[language]}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span className="rounded-xl bg-surface-secondary px-2.5 py-1.5 text-[11px] font-medium">{tr("4 h max", "4 h max")}</span>
            <button type="button" onClick={onClose} disabled={!canReturnToChat}
              title={!canReturnToChat ? tr("Terminez l'enregistrement ou le transfert avant de revenir aux services.",
                "Finish the recording or upload before returning to services.") : undefined}
              aria-label={tr("Retour aux services", "Back to services")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40">
              <X size={15} aria-hidden="true" />
              <span>{tr("Changer de service", "Choose another service")}</span>
            </button>
          </div>
        </div>
        {loading ? <p role="status" className="mt-4 text-sm text-muted">{tr("Chargement…", "Loading…")}</p> : null}
        {recentCourses.length > 0 ? (
          <div className="mt-4 flex max-w-full items-center gap-2 overflow-x-auto pb-1" aria-label={tr("Enregistrements récents", "Recent recordings")}>
            <span className="shrink-0 text-[11px] text-muted">{tr("Récents", "Recent")} :</span>
            {recentCourses.map((id) => <button key={id} type="button" disabled={recording || uploading || longAudioImportBlocked || !!busy || !!segmentQueueRef.current.length}
              onClick={() => void selectSavedCourse(id)} title={id}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${course?.id === id ? "border-border-strong bg-surface-tertiary" : "border-border"}`}>
              {tr("Audio", "Audio")} {id.slice(0, 8)}
            </button>)}
          </div>
        ) : null}
        {localError ? <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{localError}</p> : null}
        {info ? <p role="status" className="mt-3 rounded-xl border border-border bg-surface-secondary p-3 text-sm">{info}</p> : null}
        {capabilities && !capabilities.pack_active ? (
          <p className="mt-4 rounded-xl border border-border p-3 text-sm">{tr("Activez un pack ORIA pour préparer une transcription. Aucun traitement IA payant ne démarre avant l’acceptation du devis.",
            "Activate an ORIA pack to prepare a transcription. No paid AI processing starts before you accept a quote.")}</p>
        ) : null}
        {!course ? (
          <div className="mt-5 space-y-3">
            <label className="block text-xs font-medium">{tr("Nom de l’enregistrement", "Recording title")}
              <input type="text" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)}
                placeholder={service.placeholder[language]}
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-[16px] outline-none focus:border-border-strong"/>
            </label>
            <label className="block text-xs font-medium">{tr("Format du document", "Document format")}
              <select value={format} onChange={(event) => setFormat(event.target.value as "pdf" | "docx")}
                className="mt-1.5 block w-full rounded-xl border border-border bg-background px-4 py-3 text-[16px]">
                <option value="pdf">PDF</option><option value="docx">Word (.docx)</option>
              </select>
            </label>
            <button type="button" onClick={() => void createCourse()}
              disabled={!title.trim() || !capabilities?.pack_active || !!busy || loading}
              className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40">
              {busy === "create" ? tr("Création…", "Creating…") : tr("Créer l’enregistrement", "Create recording")}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3">
              <div><p className="font-medium">{course.title}</p>
                <p className="mt-1 text-xs text-muted">{course.document_format.toUpperCase()} · {tr("État", "Status")}: {status}</p></div>
              <button type="button" onClick={() => {
                if (!canChangeDraft) return;
                courseIdRef.current = null;
                if (userId) window.localStorage.removeItem(courseStorageKey(userId, documentType));
                setCourse(null); setSegments([]); setQuote(null); setJob(null); setArtifacts([]); setPlayback({});
                setTitle(""); setConfirmationUncertain(false); nextIndexRef.current = 0;
              }} disabled={!canChangeDraft} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">
                {tr("Nouvel enregistrement", "New recording")}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-border p-3"><p className="text-[11px] text-muted">{tr("Durée envoyée", "Uploaded duration")}</p><p className="mt-1 text-sm font-semibold tabular-nums">{courseDuration(totalMs)}</p></div>
              <div className="rounded-xl border border-border p-3"><p className="text-[11px] text-muted">{tr("Segments", "Segments")}</p><p className="mt-1 text-sm font-semibold tabular-nums">{segments.length}/{capabilities?.maximum_segments || 120}</p></div>
              <div className="col-span-2 rounded-xl border border-border p-3 sm:col-span-1"><p className="text-[11px] text-muted">{tr("Crédits disponibles", "Available credits")}</p><p className="mt-1 text-sm font-semibold tabular-nums">{(wallet?.balance ?? 0).toLocaleString(en ? "en-US" : "fr-FR")}</p></div>
            </div>
            {course.status === "uploading" ? (
              <>
                <div className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-semibold">{tr("Audio de l’enregistrement", "Recording audio")}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{tr("En mode manuel, chaque segment audio doit durer au plus 5 min et peser 20 Mio. La durée totale est limitée à 4 h. Pour un fichier unique plus long, utilisez le module audio long ci-dessus.",
                    "For manual uploads, each segment must be no longer than 5 min and no larger than 20 MiB. Total audio is limited to 4 h. For one larger file, use the long-audio module above.")}</p>
                  <OriaLongAudioImport
                    key={course.id}
                    courseId={course.id}
                    userId={userId}
                    language={language}
                    enabled={capabilities?.long_audio_import_enabled === true}
                    disabled={recording || uploading || !!busy || segments.length > 0}
                    onBusyChange={setLongAudioImportBlocked}
                    onComplete={handleLongAudioImportComplete}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input ref={fileInputRef} className="hidden" type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/aac,audio/3gpp,.webm,.ogg,.m4a,.mp3,.wav" multiple
                      onChange={(event) => { void uploadSelectedFiles(event.currentTarget.files); event.currentTarget.value = ""; }}/>
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      disabled={recording || uploading || longAudioImportBlocked || !!busy || segmentQueueRef.current.length > 0}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">
                      <Plus size={15}/>{tr("Importer des segments", "Upload segments")}
                    </button>
                    {!recording ? (
                      <button type="button" disabled={uploading || longAudioImportBlocked || !!busy || segmentQueueRef.current.length > 0}
                        onClick={() => setReadyToRecord((value) => !value)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-40">
                        <Mic size={15}/>{tr("Enregistrer avec le micro", "Record with microphone")}
                      </button>
                    ) : (
                      <button type="button" onClick={stopCourseRecorder}
                        className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white">
                        <Square size={14}/>{tr("Arrêter", "Stop")} · {courseDuration(elapsed * 1000)}
                      </button>
                    )}
                  </div>
                  {readyToRecord && !recording ? (
                    <div className="mt-3 rounded-xl bg-surface-secondary p-3 text-xs leading-5">
                      <p>{tr("Le micro reste actif pendant l'enregistrement. Les séquences sont envoyées automatiquement et de façon privée, sans transcription ni dépense de crédits avant la confirmation du devis. Quitter ce mode arrête l'enregistrement.",
                        "Your microphone stays active while recording. Segments upload privately without transcription or credit charges before quote confirmation. Leaving this view stops recording.")}</p>
                      <button type="button" onClick={() => void startCourseRecording()} disabled={longAudioImportBlocked}
                        className="mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">{tr("Autoriser et commencer", "Allow and start")}</button>
                    </div>
                  ) : null}
                  {(uploading || segmentQueueRef.current.length > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" role="status">
                      {uploading ? <Loader2 size={16} className="animate-spin"/> : null}
                      {tr("Segments en attente", "Pending segments")}: {segmentQueueRef.current.length}
                      {!uploading && segmentQueueRef.current.length > 0 ? (
                        <>
                          <button type="button" onClick={() => { setLocalError(null); void uploadQueue(); }} disabled={!!busy}
                            className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40">{tr("Réessayer l'envoi", "Retry upload")}</button>
                          <button type="button" onClick={() => void removeRejectedSegment()} disabled={!!busy}
                            className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40">{tr("Retirer le segment bloqué", "Remove blocked segment")}</button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
                {segments.length > 0 && (
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
                    {segments.map((item) => <div key={item.index} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>#{item.index + 1} · {courseDuration(item.duration_ms)} · {(item.size_bytes / 1024 / 1024).toFixed(1)} Mio</span>
                      <button type="button" className="rounded-lg border border-border px-2 py-1" onClick={() => void openPlayback(item.index)}>{tr("Réécouter", "Play")}</button>
                      {playback[item.index] ? <audio controls preload="none" className="h-8 w-full" src={playback[item.index]}/> : null}
                    </div>)}
                  </div>
                )}
                <button type="button" onClick={() => void submitCourse()}
                  disabled={!canChangeDraft || segments.length === 0 || totalMs > ORIA_COURSE_MAX_MS || !!busy}
                  className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40">
                  {busy === "submit" ? tr("Validation…", "Submitting…") : tr("Terminer l'envoi audio", "Finish uploading audio")}
                </button>
              </>
            ) : null}
            {course.status === "queued" && !job?.status ? (
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">{tr("Préparer le document", "Prepare document")}</h3>
                <div className="mt-3 rounded-xl border border-border bg-surface-secondary px-4 py-3">
                  <p className="text-xs font-semibold">{tr("Modèle de rédaction pédagogique", "Pedagogical writing model")}</p>
                  <p className="mt-1 text-sm font-semibold">GPT-6 Luna</p>
                  <p className="mt-1 text-xs text-muted">{tr("ORIA Transcription est disponible avec les packs actifs. Pour approfondir un point, importez le document dans le Chat général avec un modèle autorisé par votre pack.", "ORIA Transcription is available with active plans. For deeper explanations, upload the document in general Chat using a model allowed by your plan.")}</p>
                </div>
                <button type="button" onClick={() => void requestQuote()} disabled={!capabilities?.pack_active || !capabilities.writing_models.includes(writingModel) || !!busy}
                  className="mt-3 w-full rounded-xl border border-border px-4 py-3 text-sm font-semibold disabled:opacity-40">
                  {busy === "quote" ? tr("Calcul du devis…", "Estimating…") : tr("Calculer les crédits nécessaires", "Estimate required credits")}
                </button>
                {quote ? (
                  <div className="mt-3 rounded-xl bg-surface-secondary p-4 text-sm">
                    <div className="flex justify-between gap-3"><span>{tr("Crédits estimés", "Estimated credits")}</span>
                      <strong>{quote.quote.estimated_total_credits.toLocaleString(en ? "en-US" : "fr-FR")}</strong></div>
                    <div className="mt-2 flex justify-between gap-3"><span>{tr("Réservation initiale · transcription", "Initial reservation · transcription")}</span>
                      <strong>{initialReservation.toLocaleString(en ? "en-US" : "fr-FR")}</strong></div>
                    <div className="mt-2 flex justify-between gap-3"><span>{tr("Réservation suivante · Luna", "Later reservation · Luna")}</span>
                      <strong>{(quote.quote.document_reservation_credits ?? 0).toLocaleString(en ? "en-US" : "fr-FR")}</strong></div>
                    <p className="mt-2 text-xs text-muted">{tr("Les deux sommes ne sont pas réservées simultanément. L'audio est réglé avant la réservation Luna ; si les crédits manquent, la transcription est conservée. Les crédits réellement consommés sont facturés.",
                      "These amounts are not reserved together. Audio is settled before Luna is reserved; if credits are insufficient, the transcript is kept. Actual usage is charged.")}</p>
                    <p className="mt-1 text-xs text-muted">{tr("Expiration", "Expires")}: {new Date(quote.expires_at).toLocaleTimeString(en ? "en-US" : "fr-FR")}</p>
                    {!hasValidQuote ? <p className="mt-2 text-xs text-red-600">{tr("Devis expiré : recalcul nécessaire.", "Quote expired: request another.")}</p> : null}
                    {wallet && wallet.balance < initialReservation ? <p className="mt-2 text-xs text-red-600">{tr("Crédits insuffisants pour la réservation initiale. Rechargez votre solde.",
                      "Not enough credits for initial reservation. Top up your balance.")}</p> : null}
                    <button type="button" disabled={!hasValidQuote || !!busy || confirmationUncertain || !wallet?.is_pack_active || (wallet.balance < initialReservation)}
                      onClick={() => void confirmQuote()}
                      className="mt-3 w-full rounded-xl bg-accent px-4 py-3 font-semibold text-accent-foreground disabled:opacity-40">
                      {busy === "confirm" ? tr("Confirmation…", "Confirming…") : tr("J'accepte le devis et autorise le traitement", "Accept quote and authorize processing")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {awaitingCredits && (
              <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-4" role="status">
                <h3 className="text-sm font-semibold">{tr("Rédaction en attente de crédits", "Document writing awaiting credits")}</h3>
                <p className="text-xs text-muted">{tr(
                  "Votre transcription a déjà été traitée et réglée. Elle est conservée : il ne faut ni réenregistrer ni repayer l'audio. La rédaction du PDF/Word se fera uniquement avec GPT-6 Luna.",
                  "Your transcription has already been completed and paid. It is kept: no need to record or pay for audio again. PDF/Word writing uses only GPT-6 Luna.")}</p>
                {typeof resumeNeeded === "number" && resumeNeeded > 0 && (
                  <p className="text-sm">{tr("Provision nécessaire pour Luna", "Required Luna reservation")}: <strong>{resumeNeeded.toLocaleString(en ? "en-US" : "fr-FR")} {tr("crédits", "credits")}</strong></p>
                )}
                <p className="text-xs text-muted">{tr("Solde disponible", "Available balance")}: {(wallet?.balance ?? 0).toLocaleString(en ? "en-US" : "fr-FR")}</p>
                {!resumeFunded && <p className="text-xs text-muted">{tr(
                  "Rechargez les crédits manquants, puis revenez sur ce cours pour reprendre. Le montant affiché est une réservation, pas une facture définitive.",
                  "Add the missing credits, then return to this course to resume. The amount shown is a reservation, not the final charge.")}</p>}
                <div className="flex flex-wrap gap-2">
                  <Link href="/credits" className="rounded-xl border border-border px-4 py-2 text-xs font-semibold">{tr("Voir mes crédits / Recharger", "Credits / Top up")}</Link>
                  <button type="button" onClick={() => void retryCourseStatus()} disabled={!!busy}
                    className="rounded-xl border border-border px-4 py-2 text-xs font-semibold disabled:opacity-40">{tr("Actualiser le solde et le statut", "Refresh balance and status")}</button>
                </div>
                {resumeUncertain && <p className="text-xs text-red-600">{tr(
                  "Reprise non confirmée : actualisez le statut avant de réessayer.",
                  "Resume not confirmed: refresh status before retrying.")}</p>}
                <button type="button" onClick={() => void resumeCourse()}
                  disabled={!!busy || resumeUncertain || !job?.resume_available || !wallet?.is_pack_active || !resumeFunded}
                  className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40">
                  {busy === "resume" ? tr("Reprise en cours…", "Resuming…") : tr("Reprendre la rédaction avec Luna", "Resume writing with Luna")}
                </button>
              </div>
            )}
            {(working || isCourseComplete || job?.requires_manual_review || confirmationUncertain) && (
              <div className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{isCourseComplete ? tr("Transcription terminée", "Transcription completed") :
                    job?.requires_manual_review ? tr("Vérification manuelle nécessaire", "Manual review required") :
                    tr("Traitement de la transcription", "Transcription processing")}</h3>
                  <button type="button" onClick={() => void retryCourseStatus()} disabled={!!busy}
                    className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><RotateCcw size={13} className="mr-1 inline"/>{tr("Actualiser", "Refresh")}</button>
                </div>
                <p className="mt-2 text-xs text-muted">{tr("Transcription", "Transcription")}: {job?.transcription_reservation_status || "—"} · {tr("Document", "Document")}: {job?.document_reservation_status || "—"}</p>
                {working ? <p role="status" className="mt-2 text-xs text-muted">{tr("Suivi automatique toutes les 7 secondes pendant que cette page est ouverte.",
                  "Automatic status refresh every 7 seconds while this page is open.")}</p> : null}
                {job?.requires_manual_review ? <p className="mt-2 text-xs text-red-600">{tr("Ne soumettez pas une deuxième fois le même enregistrement : une opération peut déjà avoir été facturée.",
                  "Do not submit the same recording again: a provider call may already have been charged.")}</p> : null}
                {confirmationUncertain ? <p className="mt-2 text-xs text-red-600">{tr("Confirmation incertaine. Consultez le statut avant toute nouvelle opération.",
                  "Confirmation uncertain. Check the status before continuing.")}</p> : null}
              </div>
            )}
            {isCourseComplete && (
              <div className="space-y-2 rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">{tr("Vos fichiers privés", "Your private files")}</h3>
                {artifacts.length === 0 ? <button type="button" onClick={() => void retryCourseStatus()} className="text-xs underline">{tr("Charger les fichiers", "Load files")}</button> : null}
                {artifacts.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{item.filename}</p>
                    <p className="text-xs text-muted">{item.kind === "transcript" ? tr("Transcription originale", "Original transcript") : tr("Document structuré", "Structured document")} · {(item.size_bytes / 1024).toFixed(1)} Ko</p></div>
                  <button type="button" onClick={() => void downloadCourseArtifact(item)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold"><Download size={15}/>{tr("Télécharger", "Download")}</button>
                </div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}


