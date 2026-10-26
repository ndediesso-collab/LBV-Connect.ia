import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal,
  Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { File as ExpoFile } from "expo-file-system";
import { supabase } from "@/lib/supabase/client";

/**
 * ORIA MINI-STUDIO — REACT NATIVE / EXPO
 * Interface indépendante du Chat mobile : Google Image, retouche, vidéo et galerie.
 * Les droits de chaque pack et tous les prix proviennent du backend authentifié.
 * Aucun accès direct à GOOGLE_LBV_KEY ; aucun débit de wallet dans ce composant.
 * Les vidéos longues/multi-scènes sont uniquement des options informatives.
 * Chemin : components/oria-mini-studio/OriaMiniStudio.tsx
 */

type Language = "fr" | "en";
type Theme = "light" | "dark";
type Kind = "image" | "video";
type Section = Kind | "gallery";
type ImageMode = "text_to_image" | "image_edit" | "multi_reference" | "advanced_edit";
type VideoMode = "text_to_video" | "image_to_video" | "multi_scene" | "extend_video" | "first_last_frame" | "edit_video";
type Mode = ImageMode | VideoMode;

type Props = {
  visible: boolean;
  language: Language;
  theme?: Theme;
  onClose: () => void;
  onWalletRefresh?: () => void;
};
type Wallet = { balance: number; pack_id: string | null; is_pack_active: boolean };
type ModelOption = { model: string; resolutions: string[]; max_references_supported_now: number };
type Capabilities = {
  success: boolean;
  provider: "google";
  pack_id: string;
  pack_active: boolean;
  quote_available: boolean;
  generation_available: boolean;
  images: {
    models: ModelOption[];
    resolutions: string[];
    allowed_modes: ImageMode[];
    available_now_modes: ImageMode[];
    max_reference_images_in_pack: number;
    max_reference_images_per_call_now: number;
    max_images_per_call_now: number;
  };
  video: {
    model: string;
    allowed_modes: VideoMode[];
    available_now_modes: VideoMode[];
    duration_choices_seconds: number[];
    max_project_seconds: number;
    max_project_scenes: number;
    billable_resolutions: string[];
    short_clip_actions_available_now: string[];
    long_projects_generation_available: boolean;
  };
};
type Quote = {
  success: boolean;
  media_type: Kind;
  pack_id: string;
  model: string;
  mode: string;
  estimated_credits: number;
  reservation_credits: number;
  credits_available: number;
  credits_sufficient: boolean;
  generation_available: boolean;
  notice?: string;
};
type Media = {
  id: string;
  type: Kind;
  url: string;
  model: string;
  prompt: string;
  created_at?: string;
  action?: string;
  credits_cost?: number;
};
type Generation = {
  success: boolean;
  type: Kind;
  model: string;
  action: string;
  cost: number;
  credits_remaining: number;
  mime_type: string;
  media_id?: string | null;
  media_url?: string | null;
  public_url?: string | null;
  url?: string | null;
  data?: string | null;
};
type Photo = { uri: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; size?: number };
type Offer = { action: string; label: string; resolution?: string; seconds?: number };

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") || "https://lbv-connect-api.onrender.com";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const VIDEO_RATIOS = ["16:9", "9:16"];
const PACK_NAMES: Record<string, string> = {
  light_pack: "Léger", intermediate_pack: "Intermédiaire", pro_pack: "Pro", business_pack: "Business",
};

// Mapping d'offres : étiquettes uniquement. Le serveur reste l'unique autorité.
const IMAGE_OFFERS: Record<string, Offer[]> = {
  light_pack: [
    { action: "image_480", label: "Image Essentielle", resolution: "1K" },
    { action: "image_720", label: "Image Plus", resolution: "1K" },
  ],
  intermediate_pack: [
    { action: "image_480", label: "Image Essentielle", resolution: "1K" },
    { action: "image_720", label: "Image Plus", resolution: "2K" },
  ],
  pro_pack: [
    { action: "image_pro", label: "Image Pro", resolution: "1K" },
    { action: "image_pro_standard", label: "Image Pro HD", resolution: "2K" },
    { action: "image_pro_ultra", label: "Image Pro Ultra", resolution: "4K" },
  ],
  business_pack: [
    { action: "image_business", label: "Image Business", resolution: "2K" },
    { action: "image_business_hd", label: "Image Business HD", resolution: "4K" },
    { action: "image_business_ultra", label: "Image Business Ultra", resolution: "4K" },
  ],
};
const VIDEO_OFFERS: Record<string, Offer[]> = {
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
const IMAGE_MODES: Array<{ id: ImageMode; fr: string; en: string }> = [
  { id: "text_to_image", fr: "Créer une image", en: "Generate an image" },
  { id: "image_edit", fr: "Retoucher une photo", en: "Edit a photo" },
  { id: "multi_reference", fr: "Plusieurs photos · bientôt", en: "Multiple photos · soon" },
  { id: "advanced_edit", fr: "Retouche avancée · bientôt", en: "Advanced editing · soon" },
];
const VIDEO_MODES: Array<{ id: VideoMode; fr: string; en: string }> = [
  { id: "text_to_video", fr: "Texte vers vidéo", en: "Text to video" },
  { id: "image_to_video", fr: "Animer une photo", en: "Animate a photo" },
  { id: "multi_scene", fr: "Film multi-scènes · bientôt", en: "Multi-scene film · soon" },
  { id: "extend_video", fr: "Prolonger une vidéo · bientôt", en: "Extend video · soon" },
  { id: "first_last_frame", fr: "Image début/fin · bientôt", en: "First/last image · soon" },
  { id: "edit_video", fr: "Montage vidéo · bientôt", en: "Video editing · soon" },
];
const RESOLUTION_RANK: Record<string, number> = { "1K": 1, "2K": 2, "4K": 4 };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase n’est pas configuré sur cet appareil.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id || !session.access_token) {
    throw new Error("Connexion expirée. Reconnectez-vous à ORIA.");
  }
  const headers = new Headers(init.headers);
  headers.set("user-id", session.user.id);
  headers.set("authorization", `Bearer ${session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body
      ? (body as { detail: unknown }).detail : undefined;
    throw new Error(typeof detail === "string" ? detail : `Erreur ORIA (${response.status}).`);
  }
  return body as T;
}
function credits(value: number, language: Language): string {
  return Math.max(0, value).toLocaleString(language === "fr" ? "fr-FR" : "en-US");
}
function normalizeMedia(raw: unknown): Media | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  const url = [item.media_url, item.public_url, item.url].find((v) => typeof v === "string") as string | undefined;
  if (!id || !url || !/^https:\/\//i.test(url)) return null;
  return {
    id, url, type: item.media_type === "video" || item.type === "video" ? "video" : "image",
    prompt: typeof item.prompt === "string" ? item.prompt : "",
    model: typeof item.model === "string" ? item.model : "",
    action: typeof item.action === "string" ? item.action : "",
    created_at: typeof item.created_at === "string" ? item.created_at : undefined,
    credits_cost: typeof item.credits_cost === "number" ? item.credits_cost : undefined,
  };
}

export default function OriaMiniStudio({ visible, language, theme = "light", onClose, onWalletRefresh }: Props) {
  const [section, setSection] = useState<Section>("image");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [imageMode, setImageMode] = useState<ImageMode>("text_to_image");
  const [videoMode, setVideoMode] = useState<VideoMode>("text_to_video");
  const [imageModel, setImageModel] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [imageRatio, setImageRatio] = useState("1:1");
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [imageAction, setImageAction] = useState("");
  const [videoAction, setVideoAction] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [gallery, setGallery] = useState<Media[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [lastResult, setLastResult] = useState<Media | null>(null);
  const quoteVersion = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const dark = theme === "dark";
  const palette = useMemo(() => dark ? {
    bg: "#101115", card: "#1b1d23", text: "#f4f5f8", muted: "#b0b5c3", line: "#30343e",
    chip: "#242731", active: "#4440a7", notice: "#222333",
  } : {
    bg: "#f7f8fa", card: "#ffffff", text: "#191923", muted: "#697084", line: "#e4e7ed",
    chip: "#f1f3f8", active: "#ebeaff", notice: "#f0f2ff",
  }, [dark]);
  const tr = (fr: string, en: string) => language === "fr" ? fr : en;
  const kind: Kind = section === "video" ? "video" : "image";
  const mode: Mode = kind === "image" ? imageMode : videoMode;
  const needsPhoto = mode === "image_edit" || mode === "image_to_video";
  const imageOffers = IMAGE_OFFERS[wallet?.pack_id || ""] || [];
  const videoOffers = VIDEO_OFFERS[wallet?.pack_id || ""] || [];
  const offerImage = imageOffers.find((o) => o.action === imageAction) || imageOffers[0];
  const offerVideo = videoOffers.find((o) => o.action === videoAction) || videoOffers[0];
  const imageOptions = caps?.images.models.find((m) => m.model === imageModel)?.resolutions || [];
  const currentOffers = kind === "image" ? imageOffers : videoOffers;
  const currentlyAllowed = kind === "image"
    ? (imageMode === "text_to_image" || imageMode === "image_edit") && caps?.images.allowed_modes.includes(imageMode) === true
    : (videoMode === "text_to_video" || videoMode === "image_to_video") && caps?.video.allowed_modes.includes(videoMode) === true;
  const modelAndOfferReady = kind === "image"
    ? Boolean(imageModel && offerImage?.action && imageOptions.includes(resolution) &&
        (RESOLUTION_RANK[resolution] || 0) <= (RESOLUTION_RANK[offerImage.resolution || "1K"] || 0))
    : Boolean(offerVideo?.action && caps?.video.duration_choices_seconds.includes(offerVideo.seconds || 0));
  const canQuote = Boolean(wallet?.is_pack_active && caps?.quote_available && currentlyAllowed &&
    prompt.trim() && prompt.length <= 8000 && modelAndOfferReady && (!needsPhoto || photo) &&
    !loading && !busy && !quoting);
  const quoteReady = Boolean(quote?.success && quote?.pack_id === wallet?.pack_id && quote?.media_type === kind);
  const canGenerate = Boolean(canQuote && quoteReady && accepted && quote?.credits_sufficient &&
    quote?.generation_available && caps?.generation_available &&
    (kind === "image" || caps?.video.short_clip_actions_available_now.includes(offerVideo?.action || "")));

  function invalidateQuote() {
    quoteVersion.current += 1;
    setQuote(null);
    setAccepted(false);
    setNotice(null);
  }
  function changeSection(next: Section) { if (busy) return; setSection(next); invalidateQuote(); setError(null); }
  function chooseMode(next: Mode) {
    invalidateQuote(); setError(null);
    if (kind === "image") setImageMode(next as ImageMode); else setVideoMode(next as VideoMode);
    if (next === "text_to_image" || next === "text_to_video") setPhoto(null);
  }

  async function loadCapabilities() {
    setLoading(true); setCaps(null); setError(null);
    try {
      const result = await api<{ success: boolean; wallet: Wallet }>("/credits/me");
      const current = result.wallet;
      if (!mounted.current) return;
      setWallet(current);
      if (!current?.is_pack_active) { setError(tr("Activez un pack ORIA pour créer.", "Activate an ORIA plan to create.")); return; }
      const rights = await api<Capabilities>("/ai/google-media/capabilities");
      if (!rights.success || rights.provider !== "google" || !rights.pack_active || rights.pack_id !== current.pack_id) {
        throw new Error("Les droits du pack ne correspondent pas au portefeuille.");
      }
      if (!mounted.current) return;
      setCaps(rights);
      setImageModel(rights.images.models[0]?.model || "");
      setResolution(rights.images.models[0]?.resolutions[0] || "1K");
      setImageAction(IMAGE_OFFERS[current.pack_id || ""]?.[0]?.action || "");
      setVideoAction(VIDEO_OFFERS[current.pack_id || ""]?.[0]?.action || "");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Connexion au Mini-Studio impossible.");
    } finally { if (mounted.current) setLoading(false); }
  }
  async function loadGallery() {
    setGalleryLoading(true);
    try {
      const result = await api<{ media?: unknown[] }>("/media");
      if (mounted.current) setGallery((result.media || []).map(normalizeMedia).filter((m): m is Media => m !== null));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Galerie indisponible.");
    } finally { if (mounted.current) setGalleryLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (visible) { void loadCapabilities(); void loadGallery(); }
    return () => { mounted.current = false; quoteVersion.current += 1; };
    // Ce composant est monté uniquement pendant l'ouverture du Studio dans le Chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => {
    if (caps && !imageOptions.includes(resolution) && imageOptions.length) {
      setResolution(imageOptions[0]); invalidateQuote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageModel, caps]);

  async function selectPhoto() {
    if (busy) return;
    invalidateQuote(); setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { Alert.alert("ORIA", tr("Autorisez l'accès aux photos.", "Allow access to your photos.")); return; }
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, selectionLimit: 1 });
      if (selected.canceled || !selected.assets.length) return;
      const asset = selected.assets[0];
      const filename = (asset.fileName || asset.uri).toLowerCase();
      const mime = (asset.mimeType || (filename.endsWith(".png") ? "image/png" : filename.endsWith(".webp") ? "image/webp" : "image/jpeg")).toLowerCase();
      if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
        setError(tr("Choisis une photo JPEG, PNG ou WebP.", "Choose a JPEG, PNG or WebP photo.")); return;
      }
      const file = new ExpoFile(asset.uri);
      const size = asset.fileSize ?? file.size;
      if (!size || size > MAX_IMAGE_BYTES) {
        setError(tr("La photo doit peser entre 1 octet et 10 Mo.", "Photo must be between 1 byte and 10 MB.")); return;
      }
      setPhoto({ uri: asset.uri, mimeType: mime, size });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sélection de photo impossible."); }
  }

  async function prepareQuote() {
    if (!canQuote || inFlight.current) return;
    const currentVersion = ++quoteVersion.current;
    setQuote(null); setAccepted(false); setError(null); setQuoting(true);
    try {
      const payload = kind === "image" ? {
        media_type: "image", mode: imageMode, model: imageModel, resolution,
        reference_count: needsPhoto ? 1 : 0, count: 1,
      } : {
        media_type: "video", mode: videoMode, reference_count: needsPhoto ? 1 : 0,
        resolution: "720p", count: 1, final_duration_seconds: offerVideo.seconds,
        scene_durations_seconds: [offerVideo.seconds],
      };
      const result = await api<Quote>("/ai/google-media/quote", { method: "POST", body: JSON.stringify(payload) });
      if (!mounted.current || currentVersion !== quoteVersion.current) return;
      if (!result.success || result.pack_id !== wallet?.pack_id || result.media_type !== kind) {
        throw new Error("Le devis ne correspond pas à la sélection.");
      }
      setQuote(result);
    } catch (cause) {
      if (mounted.current && currentVersion === quoteVersion.current) setError(cause instanceof Error ? cause.message : "Devis indisponible.");
    } finally { if (mounted.current) setQuoting(false); }
  }

  async function generate() {
    if (!canGenerate || !quote || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      let photoB64: string | undefined;
      if (needsPhoto && photo) {
        const file = new ExpoFile(photo.uri);
        const length = file.size;
        if (!file.exists || !length || length > MAX_IMAGE_BYTES) throw new Error("La photo de référence n'est plus disponible.");
        photoB64 = await file.base64();
      }
      const shared = {
        action: kind === "image" ? offerImage.action : offerVideo.action,
        prompt: prompt.trim(), accepted_max_credits: quote.reservation_credits,
      };
      const payload = kind === "image" ? {
        ...shared, mode: imageMode, model: imageModel, resolution, aspect_ratio: imageRatio,
        ...(photoB64 ? { reference_image_b64: photoB64, reference_mime_type: photo?.mimeType } : {}),
      } : {
        ...shared, mode: videoMode, requested_seconds: offerVideo.seconds, aspect_ratio: videoRatio,
        ...(photoB64 ? { reference_image_b64: photoB64, reference_mime_type: photo?.mimeType } : {}),
      };
      const output = await api<Generation>(`/ai/google-media/${kind}`, { method: "POST", body: JSON.stringify(payload) });
      if (!output.success) throw new Error("La génération n'a pas été confirmée.");
      // Ne jamais lancer automatiquement une seconde génération si la sauvegarde échoue.
      const url = String(output.media_url || output.url || output.public_url || "");
      if (!/^https:\/\//i.test(url)) {
        setNotice(tr(
          "La génération peut avoir été facturée, mais son lien de sauvegarde manque. Consultez l'historique avant de réessayer.",
          "Generation may have been billed, but its saved link is missing. Check history before retrying.",
        ));
      } else {
        setLastResult({ id: output.media_id || `temporary-${Date.now()}`, type: output.type,
          url, prompt: prompt.trim(), model: output.model, action: output.action,
          credits_cost: output.cost, created_at: new Date().toISOString() });
        setNotice(tr("Création terminée. Coût confirmé :", "Creation finished. Confirmed cost:") +
          ` ${credits(output.cost, language)} ${tr("crédits", "credits")}.`);
      }
      // Invalider le consentement sans effacer le message de livraison.
      quoteVersion.current += 1;
      setQuote(null);
      setAccepted(false);
      await loadGallery();
      try { const result = await api<{ wallet: Wallet }>("/credits/me"); setWallet(result.wallet); } catch { /* statut disponible plus tard */ }
      onWalletRefresh?.();
    } catch (cause) {
      invalidateQuote();
      const detail = cause instanceof Error ? cause.message : "Création non confirmée.";
      setError(detail + " " + tr("Vérifiez votre historique avant de réessayer : un appel peut avoir été facturé.",
        "Check your history before retrying: an API call may have been billed."));
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  function requestClose() {
    if (busy || inFlight.current) return;
    onClose();
  }
  const textStyle = { color: palette.text };
  const mutedStyle = { color: palette.muted };
  const panelStyle = { backgroundColor: palette.card, borderColor: palette.line };
  const chipStyle = { backgroundColor: palette.chip, borderColor: palette.line };

  const Choice = ({ title, active, disabled, onPress }: { title: string; active: boolean; disabled?: boolean; onPress: () => void }) => (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
      onPress={onPress} disabled={disabled || busy}
      style={[styles.choice, chipStyle, active && { borderColor: "#756de0", backgroundColor: dark ? "#302f53" : "#eceafd" }, disabled && styles.unavailable]}>
      <Text style={[styles.choiceText, textStyle]}>{title}</Text>{active ? <Ionicons name="checkmark" size={15} color="#756de0" /> : null}
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen"
      statusBarTranslucent={Platform.OS === "android"} onRequestClose={requestClose}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: palette.bg }}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} backgroundColor={palette.bg} />
        <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }} edges={["top", "bottom", "left", "right"]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={[styles.topbar, { borderColor: palette.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.h1, textStyle]}>{tr("Mini-Studio ORIA", "ORIA Mini-Studio")}</Text>
                <Text style={[styles.subtitle, mutedStyle]}>{tr("Images, retouches et vidéos · Google", "Images, editing and video · Google")}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Fermer", "Close")}
                disabled={busy} onPress={requestClose} style={[styles.close, chipStyle]}>
                <Ionicons name="close" size={22} color={palette.text} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <View style={styles.tabs}>
                {(["image", "video", "gallery"] as Section[]).map((tab) => (
                  <Pressable key={tab} disabled={busy} onPress={() => changeSection(tab)}
                    accessibilityRole="tab" accessibilityState={{ selected: section === tab }}
                    style={[styles.tab, chipStyle, section === tab && styles.tabSelected]}>
                    <Ionicons name={tab === "image" ? "images-outline" : tab === "video" ? "videocam-outline" : "albums-outline"}
                      size={17} color={section === tab ? "#fff" : palette.text} />
                    <Text style={[styles.tabText, { color: section === tab ? "#fff" : palette.text }]}>
                      {tab === "image" ? tr("Images", "Images") : tab === "video" ? tr("Vidéo", "Video") : tr("Galerie", "Gallery")}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.wallet, panelStyle]}>
                <Ionicons name="wallet-outline" size={19} color="#7269e6" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, textStyle]}>{wallet?.pack_id ? PACK_NAMES[wallet.pack_id] || wallet.pack_id : tr("Aucun pack", "No plan")}</Text>
                  <Text style={[styles.note, mutedStyle]}>{wallet
                    ? `${credits(wallet.is_pack_active ? wallet.balance : 0, language)} ${tr("crédits disponibles", "credits available")}`
                    : tr("Chargement des crédits…", "Loading credits…")}</Text>
                </View>
                <Pressable onPress={() => { void loadCapabilities(); void loadGallery(); }} disabled={busy || loading}>
                  <Ionicons name="refresh-outline" size={19} color={palette.text}/>
                </Pressable>
              </View>
              {loading ? <View style={styles.status}><ActivityIndicator color="#746be8"/><Text style={mutedStyle}>{tr("Chargement des droits…", "Loading permissions…")}</Text></View> : null}
              {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
              {notice ? <View style={[styles.info, { backgroundColor: palette.notice }]}><Text style={[styles.note, textStyle]}>{notice}</Text></View> : null}
              {caps && !caps.generation_available && section !== "gallery" ? (
                <View style={[styles.info, { backgroundColor: palette.notice }]}>
                  <Text style={[styles.note, textStyle]}>{tr("Les créations payantes sont encore désactivées côté backend pendant les contrôles de sécurité. Les devis restent consultables.",
                    "Paid generations are disabled on the backend pending safety checks. Quotes remain available.")}</Text>
                </View>
              ) : null}

              {section === "gallery" ? (
                <View style={[styles.card, panelStyle]}>
                  <View style={styles.headerRow}>
                    <Text style={[styles.h2, textStyle]}>{tr("Mes créations", "My creations")}</Text>
                    <Pressable disabled={galleryLoading} onPress={() => void loadGallery()}>
                      {galleryLoading ? <ActivityIndicator color="#7269e6"/> : <Ionicons name="refresh-outline" size={20} color={palette.text}/>}
                    </Pressable>
                  </View>
                  {gallery.length === 0 ? <Text style={mutedStyle}>{tr("Aucune création enregistrée.", "No saved creations yet.")}</Text> : null}
                  {gallery.map((item) => (
                    <View key={item.id} style={[styles.galleryItem, { borderColor: palette.line }]}>
                      {item.type === "image" ? <Image source={{ uri: item.url }} style={styles.galleryImage} resizeMode="cover" />
                        : <View style={[styles.galleryImage, styles.videoPlaceholder]}><Ionicons name="play-circle-outline" size={42} color="#fff"/></View>}
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text numberOfLines={2} style={[styles.label, textStyle]}>{item.prompt || (item.type === "image" ? tr("Image", "Image") : tr("Vidéo", "Video"))}</Text>
                        <Text numberOfLines={1} style={[styles.note, mutedStyle]}>{item.model || item.action || "ORIA"}</Text>
                        <Pressable onPress={() => void Linking.openURL(item.url).catch(() => setError(tr("Lien inaccessible.", "Link unavailable.")))}>
                          <Text style={styles.link}>{tr("Ouvrir / enregistrer", "Open / save")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <>
                  <View style={[styles.card, panelStyle]}>
                    <Text style={[styles.h2, textStyle]}>{kind === "image" ? tr("Créer ou retoucher une image", "Create or edit an image") : tr("Créer une vidéo", "Create a video")}</Text>
                    <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Mode de création", "Creation mode")}</Text>
                    <View style={styles.flexWrap}>
                      {(kind === "image" ? IMAGE_MODES : VIDEO_MODES).map((option) => {
                        const enabledForPack = kind === "image"
                          ? caps?.images.allowed_modes.includes(option.id as ImageMode)
                          : caps?.video.allowed_modes.includes(option.id as VideoMode);
                        const implemented = kind === "image"
                          ? option.id === "text_to_image" || option.id === "image_edit"
                          : option.id === "text_to_video" || option.id === "image_to_video";
                        return <Choice key={option.id} title={option[language]} active={mode === option.id}
                          disabled={!enabledForPack || !implemented} onPress={() => chooseMode(option.id)} />;
                      })}
                    </View>
                    {caps ? <Text style={[styles.note, mutedStyle]}>{kind === "image"
                      ? `${tr("Votre pack : jusqu'à", "Your plan: up to")} ${caps.images.max_reference_images_in_pack} ${tr("photos théoriques. Une seule photo par appel actuellement.", "reference photos in theory. One photo per call currently.")}`
                      : `${tr("Projet prévu jusqu'à", "Project limit")} ${caps.video.max_project_seconds} s · ${tr("clips courts seuls actifs actuellement", "only short clips implemented for now")}`}</Text> : null}
                    <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Description", "Description")}</Text>
                    <TextInput multiline value={prompt} onChangeText={(value: string) => { invalidateQuote(); setPrompt(value); }}
                      editable={!busy} placeholder={kind === "image" ? tr("Décris l'image ou la retouche…", "Describe the image or edit…") : tr("Décris la scène à animer…", "Describe the scene…")}
                      placeholderTextColor={palette.muted} style={[styles.prompt, { color: palette.text, backgroundColor: palette.bg, borderColor: palette.line }]}/>

                    {needsPhoto ? (
                      <View>
                        <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Photo de référence", "Reference photo")}</Text>
                        <Pressable disabled={busy} onPress={() => void selectPhoto()} style={[styles.photoPicker, chipStyle]}>
                          <Ionicons name="image-outline" size={20} color={palette.text}/>
                          <Text style={[styles.label, textStyle]}>{photo ? tr("Remplacer la photo", "Replace photo") : tr("Choisir une photo", "Select photo")}</Text>
                        </Pressable>
                        {photo ? (
                          <View style={styles.photoPreview}><Image source={{ uri: photo.uri }} style={styles.refImage}/>
                            <Pressable onPress={() => { invalidateQuote(); setPhoto(null); }} disabled={busy}><Ionicons name="trash-outline" size={20} color="#bf434d"/></Pressable>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Configuration du pack", "Plan configuration")}</Text>
                    <View style={styles.flexWrap}>
                      {currentOffers.map((offer) => <Choice key={offer.action} title={offer.label}
                        active={kind === "image" ? imageAction === offer.action : videoAction === offer.action}
                        disabled={false} onPress={() => {
                          invalidateQuote();
                          if (kind === "image") {
                            setImageAction(offer.action);
                            if ((RESOLUTION_RANK[resolution] || 0) > (RESOLUTION_RANK[offer.resolution || "1K"] || 0)) setResolution(offer.resolution || "1K");
                          } else setVideoAction(offer.action);
                        }} />)}
                    </View>
                    {kind === "image" ? (
                      <>
                        <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Modèle Google", "Google model")}</Text>
                        <View style={styles.flexWrap}>{caps?.images.models.map((model) => (
                          <Choice key={model.model} title={model.model} active={imageModel === model.model}
                            onPress={() => { invalidateQuote(); setImageModel(model.model); setResolution(model.resolutions[0] || "1K"); }}/>
                        ))}</View>
                        <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Résolution", "Resolution")}</Text>
                        <View style={styles.flexWrap}>{["1K", "2K", "4K"].map((r) => (
                          <Choice key={r} title={r} active={resolution === r}
                            disabled={!imageOptions.includes(r) || (RESOLUTION_RANK[r] || 0) > (RESOLUTION_RANK[offerImage?.resolution || "1K"] || 0)}
                            onPress={() => { invalidateQuote(); setResolution(r); }}/>
                        ))}</View>
                      </>
                    ) : null}
                    <Text style={[styles.fieldLabel, mutedStyle]}>{tr("Format", "Aspect ratio")}</Text>
                    <View style={styles.flexWrap}>{(kind === "image" ? IMAGE_RATIOS : VIDEO_RATIOS).map((ratio) => (
                      <Choice key={ratio} title={ratio} active={(kind === "image" ? imageRatio : videoRatio) === ratio}
                        onPress={() => { invalidateQuote(); if (kind === "image") setImageRatio(ratio); else setVideoRatio(ratio); }}/>
                    ))}</View>
                  </View>
                  <View style={[styles.card, panelStyle]}>
                    <Text style={[styles.h2, textStyle]}>{tr("Devis et crédits", "Quote and credits")}</Text>
                    <Text style={[styles.note, mutedStyle]}>{tr("Le devis ne débite aucun crédit. Confirmez son plafond avant la génération.",
                      "A quote doesn't debit credits. Approve its cap before generating.")}</Text>
                    <Pressable accessibilityRole="button" disabled={!canQuote} onPress={() => void prepareQuote()}
                      style={[styles.primaryButton, !canQuote && styles.unavailable]}>
                      {quoting ? <ActivityIndicator color="#fff"/> : <Ionicons name="calculator-outline" size={18} color="#fff"/>}
                      <Text style={styles.primaryText}>{tr("Calculer mon devis", "Calculate quote")}</Text>
                    </Pressable>
                    {quote && quoteReady ? (
                      <View style={[styles.quoteBox, { backgroundColor: palette.notice }]}>
                        <Text style={[styles.label, textStyle]}>{tr("Estimation :", "Estimate:")} {credits(quote.estimated_credits, language)} {tr("crédits", "credits")}</Text>
                        <Text style={[styles.label, textStyle]}>{tr("Réservation maximale :", "Maximum reservation:")} {credits(quote.reservation_credits, language)} {tr("crédits", "credits")}</Text>
                        <Text style={[styles.note, mutedStyle]}>{quote.credits_sufficient
                          ? tr("Solde suffisant", "Sufficient balance") : tr("Solde insuffisant", "Insufficient balance")}</Text>
                        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} disabled={busy || !quote.credits_sufficient}
                          onPress={() => setAccepted((v) => !v)} style={styles.acceptRow}>
                          <Ionicons name={accepted ? "checkbox" : "square-outline"} size={22} color="#6b64dc" />
                          <Text style={[styles.note, { flex: 1, color: palette.text }]}>{tr("J'accepte la réservation maximale indiquée avant l'appel Google.",
                            "I approve the maximum reservation shown before the Google call.")}</Text>
                        </Pressable>
                        {!quote.generation_available ? <Text style={[styles.note, mutedStyle]}>{tr("Devis seulement : génération non disponible actuellement.",
                          "Quote only: generation is not currently available.")}</Text> : null}
                      </View>
                    ) : null}
                    <Pressable accessibilityRole="button" disabled={!canGenerate || busy} onPress={() => void generate()}
                      style={[styles.primaryButton, { backgroundColor: "#151722" }, (!canGenerate || busy) && styles.unavailable]}>
                      {busy ? <ActivityIndicator color="#fff"/> : <Ionicons name="sparkles" size={18} color="#fff" />}
                      <Text style={styles.primaryText}>{kind === "image" ? tr("Générer l'image", "Generate image") : tr("Créer la vidéo", "Generate video")}</Text>
                    </Pressable>
                    {!caps?.generation_available ? <Text style={[styles.note, mutedStyle]}>{tr("Bouton bloqué jusqu'à l'activation sécurisée du backend.",
                      "Button locked until the backend is safely enabled.")}</Text> : null}
                  </View>
                  {lastResult ? <View style={[styles.card, panelStyle]}>
                    <Text style={[styles.h2, textStyle]}>{tr("Dernière création", "Latest creation")}</Text>
                    {lastResult.type === "image" ? <Image source={{ uri: lastResult.url }} resizeMode="contain" style={styles.lastImage}/>
                      : <Text style={[styles.note, mutedStyle]}>{tr("Votre vidéo est prête.", "Your video is ready.")}</Text>}
                    <Pressable onPress={() => void Linking.openURL(lastResult.url).catch(() => setError("Lien indisponible."))}>
                      <Text style={styles.link}>{tr("Ouvrir la création", "Open creation")}</Text>
                    </Pressable>
                  </View> : null}
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topbar: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  h1: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  close: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 44, gap: 14, width: "100%", maxWidth: 750, alignSelf: "center" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4, paddingHorizontal: 5 },
  tabSelected: { backgroundColor: "#7168dd", borderColor: "#7168dd" },
  tabText: { fontSize: 11, fontWeight: "700" },
  wallet: { borderWidth: 1, borderRadius: 15, padding: 14, flexDirection: "row", gap: 11, alignItems: "center" },
  card: { borderWidth: 1, borderRadius: 19, padding: 15, gap: 13 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  h2: { fontSize: 16, fontWeight: "800" },
  fieldLabel: { fontSize: 12, fontWeight: "700", marginTop: 5 },
  flexWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 12 },
  choiceText: { fontSize: 11, fontWeight: "600" },
  unavailable: { opacity: 0.38 },
  label: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  note: { fontSize: 11, lineHeight: 18 },
  status: { flexDirection: "row", gap: 9, alignItems: "center" },
  info: { padding: 12, borderRadius: 13 },
  error: { borderWidth: 1, borderColor: "#f2b8bd", backgroundColor: "#fff3f3", borderRadius: 12, padding: 12 },
  errorText: { color: "#ae263a", fontSize: 12, lineHeight: 18 },
  prompt: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 125, fontSize: 13, lineHeight: 20, textAlignVertical: "top" },
  photoPicker: { borderWidth: 1, borderRadius: 13, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  photoPreview: { flexDirection: "row", alignItems: "center", gap: 14, marginVertical: 9 },
  refImage: { height: 90, width: 120, borderRadius: 12 },
  primaryButton: { minHeight: 48, borderRadius: 13, paddingHorizontal: 12, backgroundColor: "#746be2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  primaryText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  quoteBox: { borderRadius: 12, padding: 13, gap: 8 },
  acceptRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  link: { fontSize: 12, color: "#635bd2", fontWeight: "700", paddingVertical: 8 },
  galleryItem: { borderTopWidth: 1, paddingTop: 12, flexDirection: "row", gap: 11 },
  galleryImage: { width: 104, height: 102, borderRadius: 11 },
  videoPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: "#2f3240" },
  lastImage: { width: "100%", height: 240, borderRadius: 13, backgroundColor: "#161622" },
});
