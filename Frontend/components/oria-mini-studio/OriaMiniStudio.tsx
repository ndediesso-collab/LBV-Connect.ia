"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, ChevronDown, Download, Image as ImageIcon,
  Images, Loader2, RefreshCw, Sparkles, Upload, Video, Wallet, X,
  AlertCircle, ShieldCheck, Clapperboard,
} from "lucide-react";
import Link from "next/link";
import OriaVideoProjectsWeb from "./OriaVideoProjects_Web";
import { createClient } from "@/lib/supabase/client";

type Language = "fr" | "en";
type Kind = "image" | "video";
type ImageMode = "text_to_image" | "image_edit" | "multi_reference" | "advanced_edit";
type VideoMode = "text_to_video" | "image_to_video" | "multi_scene" | "extend_video" | "first_last_frame" | "edit_video";
type Mode = ImageMode | VideoMode;
type Screen = Kind | "gallery";

type Wallet = { balance: number; pack_id: string | null; is_pack_active: boolean };
type ImageModel = { model: string; resolutions: string[]; max_references_supported_now: number };
type Capabilities = {
  success: boolean;
  provider: "google" | "openrouter";
  pack_id: string;
  pack_active: boolean;
  generation_available: boolean;
  quote_available: boolean;
  images: {
    models: ImageModel[];
    resolutions: string[];
    allowed_modes: ImageMode[];
    max_reference_images_in_pack: number;
    available_now_modes: ImageMode[];
    max_reference_images_per_call_now: number;
    max_images_per_call_now: number;
  };
  video: {
    model: string;
    models?: {model: string; durations: number[]; supports_audio: boolean}[];
    allowed_modes: VideoMode[];
    available_now_modes: VideoMode[];
    duration_choices_seconds: number[];
    max_project_seconds: number;
    max_project_scenes: number;
    billable_resolutions: string[];
    provider_per_call_seconds: { min: number; max: number };
    short_clip_actions_available_now: string[];
    long_projects_generation_available: boolean;
    supports_audio?: boolean;
  };
};
type Quote = {
  success: boolean;
  pack_id: string;
  media_type: Kind;
  model: string;
  mode: string;
  estimated_credits: number;
  reservation_credits: number;
  credits_available: number;
  credits_sufficient: boolean;
  generation_available: boolean;
  generate_audio?: boolean;
  provider_price_known?: boolean;
  pricing_reference_date?: string;
  notice?: string;
};
type Media = {
  id: string;
  media_type: Kind;
  url: string;
  model: string;
  prompt: string;
  mime_type: string;
  created_at: string | null;
  action?: string;
  credits_cost?: number | null;
};
type Generation = {
  success: boolean;
  type: Kind;
  model: string;
  action: string;
  cost: number;
  credits_remaining: number;
  mime_type: string;
  media_id: string | null;
  url?: string | null;
  media_url?: string | null;
  public_url?: string | null;
  data?: string | null;
  request_id?: string;
  status?: string;
  timed_out?: boolean;
  error_message?: string | null;
};

type Props = {
  language: Language;
  onClose: () => void;
  onWalletRefresh?: () => void;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "https://lbv-connect-api.onrender.com";
// Configuration publique de routage uniquement : aucun secret dans Next.js.
// Activer openrouter seulement APRES mise en place des tables SQL, du backend
// et de la grille maximale de réservation côté Render.
const MEDIA_PROVIDER: "google" | "openrouter" =
  process.env.NEXT_PUBLIC_ORIA_MEDIA_PROVIDER === "openrouter" ? "openrouter" : "google";
const MEDIA_API = `/ai/${MEDIA_PROVIDER}-media`;

const supabase = createClient();
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const IMAGE_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"] as const;
const VIDEO_RATIOS = ["16:9", "9:16"] as const;
const LABEL_PACK: Record<string, string> = {
  light_pack: "Léger", intermediate_pack: "Intermédiaire", pro_pack: "Pro", business_pack: "Business",
};
// Les actions sont les identifiants historiques du backend ORIA.
// Ce mapping n'accorde AUCUN droit : /capabilities et les RPC le vérifient toujours.
const IMAGE_OFFERS: Record<string, { action: string; label: string; maxResolution: string }[]> = {
  light_pack: [
    { action: "image_480", label: "Image Essentielle", maxResolution: "1K" },
    { action: "image_720", label: "Image Plus", maxResolution: "1K" },
  ],
  intermediate_pack: [
    { action: "image_480", label: "Image Essentielle", maxResolution: "1K" },
    { action: "image_720", label: "Image Plus", maxResolution: "2K" },
  ],
  pro_pack: [
    { action: "image_pro", label: "Image Pro", maxResolution: "1K" },
    { action: "image_pro_standard", label: "Image Pro HD", maxResolution: "2K" },
    { action: "image_pro_ultra", label: "Image Pro Ultra", maxResolution: "4K" },
  ],
  business_pack: [
    { action: "image_business", label: "Image Business", maxResolution: "2K" },
    { action: "image_business_hd", label: "Image Business HD", maxResolution: "4K" },
    { action: "image_business_ultra", label: "Image Business Ultra", maxResolution: "4K" },
  ],
};
const VIDEO_OFFERS: Record<string, { action: string; label: string; seconds: number }[]> = {
  light_pack: [
    { action: "video_4s", label: "Vidéo 4 s", seconds: 4 },
    { action: "video_8s", label: "Vidéo 8 s", seconds: 8 },
  ],
  intermediate_pack: [{ action: "video_lite", label: "Vidéo Lite", seconds: 4 }],
  pro_pack: [
    { action: "video_pro_fast", label: "Vidéo Pro Fast", seconds: 4 },
    { action: "video_pro_standard", label: "Vidéo Pro Standard", seconds: 8 },
  ],
  business_pack: [
    { action: "video_business_fast", label: "Vidéo Business Fast", seconds: 4 },
    { action: "video_business_standard", label: "Vidéo Business Standard", seconds: 8 },
  ],
};
const IMAGE_MODES: { id: ImageMode; fr: string; en: string }[] = [
  { id: "text_to_image", fr: "Créer une image", en: "Generate an image" },
  { id: "image_edit", fr: "Retoucher une photo", en: "Edit a photo" },
  { id: "multi_reference", fr: "Plusieurs photos", en: "Multiple references" },
  { id: "advanced_edit", fr: "Retouche avancée", en: "Advanced editing" },
];
const VIDEO_MODES: { id: VideoMode; fr: string; en: string }[] = [
  { id: "text_to_video", fr: "Texte vers vidéo", en: "Text to video" },
  { id: "image_to_video", fr: "Animer une photo", en: "Animate a photo" },
  { id: "multi_scene", fr: "Film multi-scènes", en: "Multi-scene film" },
  { id: "extend_video", fr: "Prolonger une vidéo", en: "Extend video" },
  { id: "first_last_frame", fr: "Images début et fin", en: "First / last frame" },
  { id: "edit_video", fr: "Modifier une vidéo", en: "Edit video" },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !session.user?.id) throw new Error("Session expirée. Reconnectez-vous.");
  const headers = new Headers(options.headers);
  headers.set("user-id", session.user.id);
  headers.set("authorization", `Bearer ${session.access_token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : null;
    const text = typeof detail === "string" ? detail : "Le serveur ORIA n'a pas confirmé l'opération.";
    throw new Error(`${text}${response.status === 502 || response.status === 504 ? " Vérifiez votre historique avant de réessayer pour éviter un double coût." : ""}`);
  }
  return body as T;
}

function formatted(value: number, language: Language) {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US").format(value);
}
function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture de l'image impossible."));
    reader.onload = () => {
      const data = reader.result;
      if (typeof data !== "string" || !data.includes(",")) return reject(new Error("Fichier de référence invalide."));
      resolve(data.slice(data.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
function resolutionRank(value: string) { return ({ "1K": 1, "2K": 2, "4K": 4 } as Record<string, number>)[value] ?? 0; }
function asMedia(raw: unknown): Media | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const type = m.media_type === "video" || m.type === "video" ? "video" : "image";
  const id = String(m.id || "");
  const url = String(m.media_url || m.public_url || m.url || "");
  if (!id || !/^https:\/\//i.test(url)) return null;
  return {
    id, media_type: type, url, model: String(m.model || ""),
    prompt: String(m.prompt || ""), mime_type: String(m.mime_type || (type === "image" ? "image/png" : "video/mp4")),
    action: String(m.action || ""), created_at: typeof m.created_at === "string" ? m.created_at : null,
    credits_cost: typeof m.credits_cost === "number" ? m.credits_cost : null,
  };
}

export default function OriaMiniStudio({ language, onClose, onWalletRefresh }: Props) {
  const [screen, setScreen] = useState<Screen>("image");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [modeImage, setModeImage] = useState<ImageMode>("text_to_image");
  const [modeVideo, setModeVideo] = useState<VideoMode>("text_to_video");
  const [imageModel, setImageModel] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [ratioImage, setRatioImage] = useState("1:1");
  const [ratioVideo, setRatioVideo] = useState("16:9");
  const [videoAudio, setVideoAudio] = useState(false);
  const [videoModel, setVideoModel] = useState("");
  const [imageAction, setImageAction] = useState("");
  const [videoAction, setVideoAction] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [gallery, setGallery] = useState<Media[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [lastResult, setLastResult] = useState<Media | null>(null);
  const [lastBlobUrl, setLastBlobUrl] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allowCloseRef = useRef(true);
  const isFrench = language === "fr";
  const tr = (fr: string, en: string) => isFrench ? fr : en;
  const imageOffers = useMemo(() => IMAGE_OFFERS[wallet?.pack_id || ""] || [], [wallet?.pack_id]);
  const videoOffers = useMemo(() => VIDEO_OFFERS[wallet?.pack_id || ""] || [], [wallet?.pack_id]);
  const selectedImageOffer = imageOffers.find(o => o.action === imageAction) || imageOffers[0];
  const selectedVideoOffer = videoOffers.find(o => o.action === videoAction) || videoOffers[0];
  const activeKind: Kind = screen === "video" ? "video" : "image";
  const mode: Mode = activeKind === "image" ? modeImage : modeVideo;
  const needsReference = mode === "image_edit" || mode === "image_to_video";
  // Devis accessibles même quand la génération est coupée côté serveur.
  // Les modes longs/non implémentés restent exclus.
  const technicallyQuoted = screen === "image"
    ? (modeImage === "text_to_image" || modeImage === "image_edit")
    : (modeVideo === "text_to_video" || modeVideo === "image_to_video");
  const modeAvailableNow = technicallyQuoted && (screen === "image"
    ? caps?.images.allowed_modes.includes(modeImage) === true
    : caps?.video.allowed_modes.includes(modeVideo) === true);
  const quoteReady = Boolean(quote && quote.success && quote.media_type === activeKind && quote.pack_id === wallet?.pack_id);
  const generationReady = Boolean(caps?.generation_available && wallet?.is_pack_active && modeAvailableNow);

  function invalidateQuote() { setQuote(null); setAccepted(false); setNotice(null); }
  function changeScreen(next: Screen) { if (busy) return; setScreen(next); invalidateQuote(); setError(null); }

  async function loadCapabilities() {
    setLoading(true);
    setError(null);
    setCaps(null);
    try {
      const walletResponse = await api<{ success: boolean; wallet: Wallet }>("/credits/me");
      const current = walletResponse.wallet;
      setWallet(current);
      if (!current?.is_pack_active) { setError(tr("Un pack actif est nécessaire pour créer.", "An active plan is required to create.")); return; }
      const remote = await api<Capabilities>(`${MEDIA_API}/capabilities`);
      if (!remote.success || remote.provider !== MEDIA_PROVIDER || remote.pack_id !== current.pack_id || !remote.pack_active) {
        throw new Error("Les droits de création ne correspondent pas au pack actif.");
      }
      setCaps(remote);
      setVideoModel(remote.video.model || "");
      if (MEDIA_PROVIDER === "openrouter") {
        try {
          const previous = await api<{ jobs: Generation[] }>(`${MEDIA_API}/jobs`);
          const active = previous.jobs?.find(item =>
            !["completed", "failed", "refunded"].includes(item.status || ""));
          if (active?.request_id) setPendingRequestId(active.request_id);
        } catch { /* La galerie reste accessible si la table de jobs est indisponible. */ }
      }
      const firstModel = remote.images.models[0];
      if (firstModel) setImageModel(firstModel.model);
      if (remote.images.resolutions.length) setResolution(remote.images.resolutions[0]);
      setImageAction(IMAGE_OFFERS[remote.pack_id]?.[0]?.action || "");
      setVideoAction(VIDEO_OFFERS[remote.pack_id]?.[0]?.action || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connexion au Mini-Studio impossible."); }
    finally { setLoading(false); }
  }

  async function loadGallery() {
    setGalleryLoading(true);
    try {
      const data = await api<{ media?: unknown[] }>("/media");
      const media = (data.media || []).map(asMedia).filter((item): item is Media => item !== null);
      setGallery(media);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger vos créations."); }
    finally { setGalleryLoading(false); }
  }

  useEffect(() => { void loadCapabilities(); void loadGallery(); }, []); // ouverture du Studio uniquement
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && allowCloseRef.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = before; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  useEffect(() => {
    if (!reference) { setReferenceUrl(null); return; }
    const url = URL.createObjectURL(reference);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);
  useEffect(() => { return () => { if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl); }; }, [lastBlobUrl]);
  useEffect(() => { allowCloseRef.current = !busy; }, [busy]);
  useEffect(() => {
    if (!caps) return;
    // Un changement de modèle peut réduire les résolutions possibles.
    const model = caps.images.models.find(item => item.model === imageModel);
    if (model && !model.resolutions.includes(resolution)) {
      setResolution(model.resolutions[0] || "1K"); invalidateQuote();
    }
  }, [imageModel, caps]);

  function selectReference(file: File | undefined) {
    invalidateQuote(); setError(null);
    if (!file) { setReference(null); return; }
    if (!IMAGE_MIMES.has(file.type) || file.size <= 0 || file.size > MAX_REFERENCE_BYTES) {
      setReference(null);
      setError(tr("Photo JPEG, PNG ou WebP de 10 Mo maximum.", "JPEG, PNG or WebP image, up to 10 MB."));
      return;
    }
    setReference(file);
  }
  function selectMode(next: Mode) {
    invalidateQuote(); setError(null);
    if (screen === "image") setModeImage(next as ImageMode); else setModeVideo(next as VideoMode);
    if (next === "text_to_image" || next === "text_to_video") setReference(null);
  }
  function selectOffer(next: string) {
    invalidateQuote();
    if (screen === "image") {
      const offer = imageOffers.find(o => o.action === next);
      setImageAction(next);
      if (offer && resolutionRank(resolution) > resolutionRank(offer.maxResolution)) setResolution(offer.maxResolution);
    } else setVideoAction(next);
  }

  const optionsForModel = caps?.images.models.find(model => model.model === imageModel)?.resolutions || [];

  const canQuote = Boolean(
    wallet?.is_pack_active && caps?.quote_available && !loading && !busy && !quoting &&
    prompt.trim() && prompt.length <= 8000 && modeAvailableNow &&
    (!needsReference || reference) &&
    (activeKind === "image" ? imageModel && selectedImageOffer && optionsForModel.includes(resolution) && resolutionRank(resolution) <= resolutionRank(selectedImageOffer.maxResolution) : selectedVideoOffer),
  );

  async function prepareQuote() {
    if (!canQuote) return;
    setQuoting(true); setError(null); invalidateQuote();
    try {
      const payload = activeKind === "image" ? {
        media_type: "image", mode: modeImage, model: imageModel, resolution,
        reference_count: needsReference ? 1 : 0, count: 1,
      } : {
        media_type: "video", mode: modeVideo, reference_count: needsReference ? 1 : 0,
        model: videoModel, resolution: "720p", count: 1, final_duration_seconds: selectedVideoOffer.seconds,
                scene_durations_seconds: [selectedVideoOffer.seconds],
        ...(MEDIA_PROVIDER === "openrouter" ? { generate_audio: videoAudio } : {}),
      };
      const calculated = await api<Quote>(`${MEDIA_API}/quote`, { method: "POST", body: JSON.stringify(payload) });
      if (calculated.pack_id !== wallet?.pack_id || calculated.media_type !== activeKind) {
        throw new Error("Le devis ne correspond pas à la configuration actuelle.");
      }
      setQuote(calculated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Devis indisponible."); }
    finally { setQuoting(false); }
  }

  async function generate() {
    if (!canQuote || quoting || !quoteReady || !quote || !accepted || !generationReady || !quote.generation_available || !quote.credits_sufficient) return;
    if (activeKind === "video" && !caps?.video.short_clip_actions_available_now.includes(selectedVideoOffer.action)) return;
    const action = activeKind === "image" ? selectedImageOffer.action : selectedVideoOffer.action;
    if (!action) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const ref = needsReference && reference ? await fileToB64(reference) : undefined;
      const request_id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      const shared = { action, prompt: prompt.trim(), accepted_max_credits: quote.reservation_credits,
        ...(MEDIA_PROVIDER === "openrouter" ? { request_id } : {}) };
      const payload = activeKind === "image" ? {
        ...shared, mode: modeImage, model: imageModel, resolution, aspect_ratio: ratioImage,
        ...(ref ? { reference_image_b64: ref, reference_mime_type: reference?.type } : {}),
      } : {
        ...shared, mode: modeVideo, model: videoModel, requested_seconds: selectedVideoOffer.seconds, aspect_ratio: ratioVideo,
        ...(MEDIA_PROVIDER === "openrouter" ? { generate_audio: videoAudio } : {}),
        ...(ref ? { reference_image_b64: ref, reference_mime_type: reference?.type } : {}),
      };
      // Retenir l'identifiant AVANT le POST : si le réseau coupe, rechercher
      // cette requête plutôt que payer une deuxième création.
      if (MEDIA_PROVIDER === "openrouter") setPendingRequestId(request_id);
      const result = await api<Generation>(`${MEDIA_API}/${activeKind}`, {
        method: "POST", body: JSON.stringify(payload),
      });
      if (!result.success) throw new Error("La génération n'a pas été confirmée.");
      if (MEDIA_PROVIDER === "openrouter" && ["refunded", "failed"].includes(result.status || "")) {
        setPendingRequestId(null);
        setQuote(null); setAccepted(false);
        setNotice(`${result.status === "refunded"
          ? tr("Création refusée : réservation restituée.", "Creation declined: reservation returned.")
          : tr("Création non commencée : aucun débit.", "Creation not started: no charge.")}${result.error_message ? ` ${tr("Motif :", "Reason:")} ${result.error_message}` : ""}`);
        try { const current = await api<{ wallet: Wallet }>("/credits/me"); setWallet(current.wallet); } catch {}
        onWalletRefresh?.();
        return;
      }
      if (MEDIA_PROVIDER === "openrouter" && result.status && result.status !== "completed") {
        setPendingRequestId(result.request_id || request_id);
        setNotice(tr("Création suivie. Vous pouvez continuer avec une autre création ; ne renvoyez pas cette même demande.",
          "Creation tracked. You may start a different creation; do not resubmit this same request."));
        setQuote(null); setAccepted(false);
        return;
      }
      if (MEDIA_PROVIDER === "openrouter") setPendingRequestId(null);
      let url = String(result.media_url || result.url || result.public_url || "");
      let blobUrl: string | null = null;
      // Secours : si Supabase est indisponible, le backend peut renvoyer le fichier
      // déjà facturé en Base64. Ne pas redemander une génération facturable.
      if (!url && result.data && result.data.length <= 90_000_000) {
        try {
          const binary = window.atob(result.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          blobUrl = URL.createObjectURL(new Blob([bytes], { type: result.mime_type || "application/octet-stream" }));
          url = blobUrl;
        } catch { /* voir message de récupération ci-dessous */ }
      }
      if (!url) {
        setNotice(tr("La génération a été facturée mais sa sauvegarde n'est pas confirmée. Vérifiez l'historique avant toute nouvelle tentative.", "Generation was charged, but storage is unconfirmed. Check history before retrying."));
      } else {
        setLastBlobUrl(blobUrl);
        const media: Media = {
          id: result.media_id || `local-${Date.now()}`,
          media_type: result.type,
          url, model: result.model, action: result.action,
          prompt: prompt.trim(), mime_type: result.mime_type,
          created_at: new Date().toISOString(), credits_cost: result.cost,
        };
        setLastResult(media);
        setNotice(result.media_id
          ? tr("Création terminée. Le coût confirmé a été déduit de votre solde.", "Creation finished. The confirmed cost was charged.")
          : tr("Création facturée. La sauvegarde Cloud n'est pas confirmée : téléchargez immédiatement ce fichier et vérifiez votre historique avant de réessayer.", "Creation charged. Cloud storage is unconfirmed: download this file now and check history before retrying."));
      }
      setQuote(null); setAccepted(false);
      await loadGallery();
      try { const updated = await api<{ wallet: Wallet }>("/credits/me"); setWallet(updated.wallet); } catch { /* solde relu à l'ouverture */ }
      onWalletRefresh?.();
    } catch (cause) {
      // Une coupure réseau n'implique pas que Google n'ait rien facturé.
      // On retire le consentement et interdit la relance avec l'ancien devis.
      setQuote(null);
      setAccepted(false);
      const detail = cause instanceof Error ? cause.message : "Génération non confirmée.";
      setError(`${detail} ${tr("Vérifiez vos créations avant toute nouvelle tentative.", "Check your creations before retrying.")}`);
    } finally { setBusy(false); }
  }

  const modes = screen === "video" ? VIDEO_MODES : IMAGE_MODES;
  const offers = screen === "video" ? videoOffers : imageOffers;
  const activeOffer = screen === "image" ? imageAction : videoAction;
  const disabledReason = !caps?.generation_available
    ? tr("Créations désactivées sur le serveur pendant les vérifications de sécurité.", "Generations are disabled on the server pending safety checks.")
    : !modeAvailableNow
      ? tr("Ce mode est prévu dans le pack, mais son moteur n'est pas encore actif.", "This mode is included in the plan, but its engine is not active yet.")
      : "";

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/65 p-2 backdrop-blur-sm sm:p-5" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="oria-studio-heading"
        className="mx-auto my-1 w-full max-w-[1130px] rounded-[26px] border border-border bg-background text-foreground shadow-2xl sm:my-4">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-tertiary"><Sparkles size={22}/></span>
            <div className="min-w-0">
              <h2 id="oria-studio-heading" className="truncate text-lg font-bold tracking-tight sm:text-2xl">Mini-Studio ORIA</h2>
              <p className="text-xs text-muted">{tr(`Images, retouches et vidéos — ${MEDIA_PROVIDER === "openrouter" ? "OpenRouter" : "Google"}`, `Images, editing and video — ${MEDIA_PROVIDER === "openrouter" ? "OpenRouter" : "Google"}`)}</p>
            </div>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label={tr("Fermer", "Close")}
            className="rounded-xl border border-border p-2.5 text-muted hover:bg-surface-secondary disabled:opacity-40"><X size={19}/></button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-7">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={tr("Espaces du studio", "Studio tabs")}>
            {([{ id: "image", label: tr("Images & retouches", "Images & editing"), icon: ImageIcon },
              { id: "video", label: tr("Vidéo", "Video"), icon: Video },
              { id: "gallery", label: tr("Mes créations", "My creations"), icon: Images }] as const).map(item => (
              <button key={item.id} type="button" role="tab" aria-selected={screen === item.id}
                onClick={() => changeScreen(item.id)} disabled={busy}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold sm:text-sm ${screen === item.id ? "bg-accent text-accent-foreground" : "bg-surface-secondary text-muted-strong hover:bg-surface-tertiary"}`}>
                <item.icon size={16}/>{item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Wallet size={15}/>
            {wallet?.pack_id ? LABEL_PACK[wallet.pack_id] || wallet.pack_id : tr("Aucun pack", "No plan")}
            {wallet && <strong className="text-foreground">· {formatted(wallet.balance, language)} {tr("crédits", "credits")}</strong>}
          </div>
        </div>

        <div className="p-4 sm:p-6 lg:p-7">
          {loading && <div role="status" className="mb-4 flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={17}/>{tr("Chargement des droits de création…", "Loading creation permissions…")}</div>}
          {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">{error}</div>}
          {notice && <div role="status" className="mb-4 rounded-xl border border-border bg-surface-secondary p-3 text-xs">{notice}</div>}
           {MEDIA_PROVIDER === "openrouter" && pendingRequestId && <button type="button"
             disabled={busy} onClick={async () => {
               try {
                 const job = await api<Generation>(`${MEDIA_API}/jobs/${encodeURIComponent(pendingRequestId)}`);
                 if (job.status === "completed" && (job.media_url || job.url)) {
                   setPendingRequestId(null);
                   setLastResult({ id: job.media_id || pendingRequestId, media_type: job.type,
                     url: String(job.media_url || job.url), model: job.model, action: job.action,
                     prompt: prompt.trim(), mime_type: job.mime_type, created_at: new Date().toISOString(),
                     credits_cost: job.cost });
                   await loadGallery(); onWalletRefresh?.();
                   setNotice(tr("Création terminée et enregistrée.", "Creation completed and saved."));
                 } else if (["refunded", "failed"].includes(job.status || "")) {
                   setPendingRequestId(null);
                   setNotice(`${job.status === "refunded"
                     ? tr("Génération refusée : les crédits réservés ont été restitués.", "Creation declined: reserved credits were returned.")
                     : tr("Création non démarrée, aucun débit.", "Creation not started; no charge.")}${job.error_message ? ` ${tr("Motif :", "Reason:")} ${job.error_message}` : ""}`);
                   try { const current = await api<{ wallet: Wallet }>("/credits/me"); setWallet(current.wallet); } catch {}
                   onWalletRefresh?.();
                 } else setNotice(`${tr("Statut", "Status")} : ${job.status || "pending"}. ${job.error_message || (job.timed_out
                   ? tr("Délai dépassé : rapprochement financier en cours. Vous pouvez demander un autre devis avec votre solde disponible.", "Timeout: billing review pending. You may request another quote using your available balance.")
                   : tr("Vous pouvez continuer à créer sans renvoyer cette même demande.", "You may keep creating without resubmitting this request."))}`);
               } catch (e) { setError(e instanceof Error ? e.message : "Statut indisponible."); }
             }} className="mb-4 rounded-xl border border-border px-4 py-2 text-xs font-semibold">
             {tr("Vérifier la création en attente", "Check pending creation")}
           </button>}
          {caps && !caps.generation_available && screen !== "gallery" && (
            <div className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-3 text-xs leading-5 text-muted-strong">
              <ShieldCheck size={17} className="mt-0.5 shrink-0"/>
              {disabledReason}
            </div>
          )}

          {screen === "gallery" ? (
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">{tr("Bibliothèque de créations", "Creation library")}</h3>
                <button type="button" onClick={() => void loadGallery()} disabled={galleryLoading} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs">
                  <RefreshCw size={15} className={galleryLoading ? "animate-spin" : ""}/>{tr("Actualiser", "Refresh")}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {gallery.map(item => (
                  <article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-surface">
                    {item.media_type === "image" ? <img src={item.url} alt={item.prompt || "Création ORIA"} className="h-48 w-full object-cover"/> :
                      <video src={item.url} controls playsInline preload="metadata" className="h-48 w-full bg-black object-contain"/>}
                    <div className="space-y-2 p-3">
                      <p className="line-clamp-2 text-xs font-medium">{item.prompt || tr("Création ORIA", "ORIA creation")}</p>
                      <p className="text-[11px] text-muted">{item.model}</p>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" download className="inline-flex items-center gap-2 text-xs font-semibold underline underline-offset-4"><Download size={14}/>{tr("Ouvrir / télécharger", "Open / download")}</a>
                    </div>
                  </article>
                ))}
              </div>
              {!gallery.length && !galleryLoading && <p className="rounded-2xl border border-border p-10 text-center text-sm text-muted">{tr("Aucune création enregistrée pour le moment.", "No saved creations yet.")}</p>}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="min-w-0 space-y-5">
                <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-2"><Clapperboard size={18}/><h3 className="text-sm font-semibold">{tr("Votre création", "Your creation")}</h3></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium">{tr("Type de création", "Creation mode")}</label>
                      <select value={mode} disabled={busy || quoting || loading || !caps} onChange={e => selectMode(e.target.value as Mode)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs outline-none focus:border-muted-strong">
                        {modes.map(item => {
                          const permitted = (screen === "image" ? caps?.images.allowed_modes : caps?.video.allowed_modes)?.includes(item.id as never) || false;
                          const active = screen === "image"
                            ? item.id === "text_to_image" || item.id === "image_edit"
                            : item.id === "text_to_video" || item.id === "image_to_video";
                          return <option key={item.id} value={item.id} disabled={!permitted || !active}>
                            {item[language]}{!permitted ? ` — ${tr("hors pack", "not in plan")}` : !active ? ` — ${tr("bientôt", "coming soon")}` : ""}
                          </option>;
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">{tr("Offre de création", "Creation offer")}</label>
                      <div className="relative">
                        <select value={activeOffer || ""} disabled={busy || quoting || loading || !caps} onChange={e => selectOffer(e.target.value)}
                          className="w-full appearance-none rounded-xl border border-border bg-background px-3 py-2.5 pr-8 text-xs outline-none focus:border-muted-strong">
                          {offers.map(o => <option value={o.action} key={o.action}>{o.label}</option>)}
                        </select><ChevronDown className="pointer-events-none absolute right-3 top-3 text-muted" size={15}/>
                      </div>
                    </div>
                  </div>
                  {screen === "image" ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium">{tr("Modèle", "Model")}</label>
                        <select value={imageModel} disabled={busy || quoting || loading} onChange={e => { setImageModel(e.target.value); invalidateQuote(); }}
                          className="w-full rounded-xl border border-border bg-background p-2.5 text-xs">
                          {caps?.images.models.map(m => <option key={m.model} value={m.model}>{m.model.replace(/^gemini-/, "")}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">{tr("Résolution", "Resolution")}</label>
                        <select value={resolution} disabled={busy || quoting || loading} onChange={e => { setResolution(e.target.value); invalidateQuote(); }}
                          className="w-full rounded-xl border border-border bg-background p-2.5 text-xs">
                          {caps?.images.resolutions.filter(r => optionsForModel.includes(r)).map(r => (
                            <option key={r} value={r} disabled={resolutionRank(r) > resolutionRank(selectedImageOffer?.maxResolution || "1K")}>{r}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">{tr("Format", "Aspect ratio")}</label>
                        <select value={ratioImage} disabled={busy || quoting} onChange={e => { setRatioImage(e.target.value); invalidateQuote(); }} className="w-full rounded-xl border border-border bg-background p-2.5 text-xs">
                          {IMAGE_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium">{tr("Durée de l'offre", "Offer duration")}</label>
                        <div className="rounded-xl border border-border bg-background p-2.5 text-xs">{selectedVideoOffer?.seconds ?? "—"} s · 720p</div>
                        <p className="mt-1 text-[10px] leading-4 text-muted">{tr("Durée demandée, non garantie au rendu Google.", "Requested duration, not guaranteed in the Google output.")}</p>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">{tr("Format", "Aspect ratio")}</label>
                        <select value={ratioVideo} disabled={busy || quoting} onChange={e => { setRatioVideo(e.target.value); invalidateQuote(); }} className="w-full rounded-xl border border-border bg-background p-2.5 text-xs">
                          {VIDEO_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="mt-4">
                    <label className="mb-1.5 block text-xs font-medium" htmlFor="oria-mini-prompt">{tr("Décrivez le résultat souhaité", "Describe your desired result")}</label>
                    <textarea id="oria-mini-prompt" rows={5} maxLength={8000} value={prompt} disabled={busy || quoting}
                      onChange={e => { setPrompt(e.target.value); invalidateQuote(); }} placeholder={tr("Ex. : Une scène réaliste dans les rues de Libreville, éclairage cinématographique…", "E.g. A realistic cinematic scene in Libreville…")}
                      className="w-full resize-y rounded-xl border border-border bg-background px-3 py-3 text-sm leading-6 outline-none placeholder:text-muted focus:border-muted-strong"/>
                  </div>
                  {needsReference && <div className="mt-4 rounded-xl border border-dashed border-border bg-surface-secondary p-3">
                    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold">{tr("Photo de référence", "Reference image")}</span><span className="text-[10px] text-muted">JPEG, PNG, WebP · 10 Mo max.</span></div>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || quoting}
                      onChange={e => selectReference(e.currentTarget.files?.[0])} className="sr-only"/>
                    <button type="button" disabled={busy || quoting} onClick={() => fileRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium"><Upload size={16}/>{reference?.name || tr("Choisir une photo", "Select an image")}</button>
                    {referenceUrl && <img src={referenceUrl} alt={tr("Photo à retoucher", "Reference photo")} className="mt-3 max-h-48 rounded-xl object-contain"/>}
                    <p className="mt-2 text-[11px] text-muted">{tr(`Votre pack prévoit jusqu'à ${caps?.images.max_reference_images_in_pack ?? 1} références pour les images. Une seule est actuellement prise en charge par génération.`, `Your plan allows up to ${caps?.images.max_reference_images_in_pack ?? 1} image references. Only one is currently supported per generation.`)}</p>
                  </div>}
                </section>
                {screen === "video" && MEDIA_PROVIDER === "openrouter" && (caps?.video.models?.length || 0) > 1 && (
                  <div className="mt-3 rounded-xl border border-border bg-surface-secondary p-3">
                    <label className="mb-1 block text-xs font-medium">{tr("Modèle vidéo", "Video model")}</label>
                    <select value={videoModel} disabled={busy || quoting}
                      onChange={e => { setVideoModel(e.target.value); setVideoAudio(false); invalidateQuote(); }}
                      className="w-full rounded-lg border border-border bg-background p-2 text-xs">
                      {caps?.video.models?.map(m => <option key={m.model} value={m.model}>{m.model}</option>)}
                    </select>
                    <p className="mt-1 text-[11px] text-muted">{tr("En cas de limite 429, choisissez volontairement un autre modèle et redemandez un devis.", "After a 429 limit, choose another model and request a new quote.")}</p>
                  </div>
                )}
                {screen === "video" && MEDIA_PROVIDER === "openrouter" && (
                  <div className="mt-3 rounded-xl border border-border bg-surface-secondary p-3">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={videoAudio} disabled={busy || quoting || !(caps?.video.models?.find(m => m.model === videoModel)?.supports_audio ?? caps?.video.supports_audio)}
                        onChange={e => { setVideoAudio(e.target.checked); invalidateQuote(); }} />
                      {tr("Générer avec audio (voix, ambiance, bruitages)", "Generate with audio (voice, ambience, effects)")}
                    </label>
                    <p className="mt-2 text-[11px] text-muted">{(caps?.video.models?.find(m => m.model === videoModel)?.supports_audio ?? caps?.video.supports_audio)
                      ? tr("Le devis dépend du modèle, de la durée et du mode audio.", "Quote depends on the model, duration and audio choice.")
                      : tr("Audio indisponible sur le modèle de ce pack.", "Audio unavailable for this plan's model.")}</p>
                  </div>
                )}
                {screen === "video" && caps && MEDIA_PROVIDER === "openrouter" && wallet?.pack_id && (
                  <OriaVideoProjectsWeb language={language} packId={wallet.pack_id} caps={caps.video} onWalletRefresh={onWalletRefresh}/>
                )}
                {screen === "video" && caps && MEDIA_PROVIDER !== "openrouter" && <div className="rounded-2xl border border-border bg-surface-secondary p-4 text-xs leading-5 text-muted-strong">
                  <p className="font-semibold text-foreground">{tr("Projets vidéo avancés", "Advanced video projects")}</p>
                  <p className="mt-1">{tr(`Ton pack prévoit des projets jusqu'à ${caps.video.max_project_seconds} s (${caps.video.max_project_scenes} scène(s) maximum), mais seuls les clips courts peuvent être générés actuellement.`, `Your plan allows projects up to ${caps.video.max_project_seconds}s (${caps.video.max_project_scenes} scenes max), but only short clips can currently be generated.`)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">{caps.video.allowed_modes.filter(m => !caps.video.available_now_modes.includes(m)).map(m => (
                    <span key={m} className="rounded-lg border border-border bg-background px-2 py-1 text-[11px]">{VIDEO_MODES.find(opt => opt.id === m)?.[language] || m} · {tr("À venir", "Coming soon")}</span>
                  ))}</div>
                </div>}
              </div>

              <aside className="min-w-0 space-y-4">
                <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                  <div className="mb-3 flex items-center gap-2"><Wallet size={18}/><h3 className="text-sm font-semibold">{tr("Devis et crédits", "Quote & credits")}</h3></div>
                  <p className="text-xs leading-5 text-muted">{tr("Le devis est calculé côté serveur. Aucun crédit n'est réservé avant la confirmation.", "The quote is calculated on the server. No credits are reserved until confirmation.")}</p>
                  <button type="button" disabled={!canQuote} onClick={() => void prepareQuote()}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40">
                    {quoting ? <Loader2 size={17} className="animate-spin"/> : <RefreshCw size={16}/>}{tr("Obtenir le devis", "Get quote")}
                  </button>
                  {quoteReady && quote && <div className="mt-4 space-y-3 rounded-xl bg-surface-secondary p-4">
                    {screen === "video" && <p className="text-[11px] text-muted">{quote.provider_price_known
                      ? tr("Estimation selon les tarifs annoncés par OpenRouter.", "Estimate based on OpenRouter's reported price.")
                      : tr("Estimation = budget administrateur, pas un prix fournisseur confirmé.", "Estimate = admin budget, not a confirmed provider price.")}</p>}
                    <p className="text-xs text-muted">{tr("Coût estimé", "Estimated cost")} : <strong className="text-foreground">{formatted(quote.estimated_credits, language)} {tr("crédits", "credits")}</strong></p>
                    <p className="text-xs text-muted">{tr("Réservation maximale acceptée", "Maximum accepted reservation")} :</p>
                    <p className="text-2xl font-bold tracking-tight">{formatted(quote.reservation_credits, language)} <span className="text-sm font-normal text-muted">{tr("crédits", "credits")}</span></p>
                    {!quote.credits_sufficient && <p className="text-xs font-semibold text-red-600">{tr("Solde insuffisant pour ce devis.", "Insufficient balance for this quote.")}</p>}
                    {quote.credits_sufficient && quote.generation_available && generationReady && (
                      <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={accepted} disabled={busy || quoting} onChange={e => setAccepted(e.target.checked)} className="mt-1 accent-current"/>
                        <span>{tr("J'accepte la réservation maximale indiquée pour cette création. Le règlement réel sera calculé par le serveur.", "I accept the maximum quoted reservation for this creation. Final billing is calculated by the server.")}</span>
                      </label>
                    )}
                  </div>}
                  {disabledReason && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><AlertCircle size={15} className="mt-0.5 shrink-0"/>{disabledReason}</p>}
                  <button type="button" onClick={() => void generate()} disabled={!canQuote || quoting || !quoteReady || !accepted || !quote?.generation_available || !quote?.credits_sufficient || !generationReady || busy || (screen === "video" && !caps?.video.short_clip_actions_available_now.includes(selectedVideoOffer?.action || ""))}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy ? <Loader2 size={17} className="animate-spin"/> : <Sparkles size={17}/>}{busy ? tr("Génération en cours…", "Generating…") : tr("Confirmer et créer", "Confirm and create")}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-muted">{tr("Aucun appel payant n'est lancé tant que la création est désactivée côté backend.", "No paid API call is made while creation is disabled by the backend.")}</p>
                </section>

                {lastResult && <section className="rounded-2xl border border-border bg-surface p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Check size={17}/>{tr("Dernière création", "Latest creation")}</h3>
                  {lastResult.media_type === "image" ? <img src={lastResult.url} alt={lastResult.prompt} className="max-h-72 w-full rounded-xl object-contain"/> :
                    <video src={lastResult.url} controls playsInline className="max-h-72 w-full rounded-xl bg-black"/>}
                  <p className="mt-2 text-xs text-muted">{tr("Coût confirmé", "Confirmed charge")} : {formatted(lastResult.credits_cost || 0, language)} {tr("crédits", "credits")}</p>
                  <a href={lastResult.url} download target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 text-xs font-semibold underline"><Download size={15}/>{tr("Ouvrir / télécharger", "Open / download")}</a>
                </section>}
                <Link href="/credits" className="inline-flex items-center gap-2 text-xs font-medium text-muted underline underline-offset-4"><ArrowLeft size={14}/>{tr("Voir les packs et crédits", "View plans and credits")}</Link>
              </aside>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
