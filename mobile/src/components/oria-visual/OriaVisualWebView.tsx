/**
 * ORIA Visual — WebView mobile à parité de moteur avec le Web.
 *
 * Ne contient aucun moteur de rendu simplifié : charge la route Next.js
 * /oria-visual-embed, qui réutilise les 4 composants ORIA du Web.
 *
 * Pré-requis : EXPO_PUBLIC_ORIA_VISUAL_RENDERER_URL=https://VOTRE-WEB/oria-visual-embed
 * Cette route doit être accessible au téléphone (HTTPS en production).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

export type OriaVisualKind =
  | 'oria-chart'
  | 'oria-grid'
  | 'oria-diagram'
  | 'oria-stats'
  | 'oria-geometry'
  | 'oria-table'
  | 'oria-callout'
  | 'oria-3d'
  | 'oria-map';

export type OriaVisualProps = {
  kind: string;
  raw: string;
  language?: 'fr' | 'en';
  fallback?: ReactNode;
  /** Hauteur initiale, ajustée automatiquement lorsque le renderer répond. */
  height?: number;
  /** URL explicite facultative pour les tests ; sinon variable EXPO_PUBLIC_*. */
  rendererUrl?: string;
};

type HostMessage = {
  type?: string;
  height?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  base64?: unknown;
  text?: unknown;
  message?: unknown;
};

const KNOWN_KINDS = new Set<OriaVisualKind>([
  'oria-chart', 'oria-grid', 'oria-diagram', 'oria-stats', 'oria-geometry',
  'oria-table', 'oria-callout', 'oria-3d', 'oria-map',
]);
const MAX_RAW_CHARS = 180_000;
const MAX_EXPORT_BASE64_CHARS = 12_000_000;
const DEFAULT_URL = process.env.EXPO_PUBLIC_ORIA_VISUAL_RENDERER_URL ?? '';

function safeRendererUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.hash) return null;
    // En production, le serveur de rendu doit être servi via HTTPS.
    if (url.protocol !== 'https:' && !(typeof __DEV__ !== 'undefined' && __DEV__ && url.protocol === 'http:')) {
      return null;
    }
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validSpec(kind: string, raw: string): boolean {
  if (!KNOWN_KINDS.has(kind as OriaVisualKind) || raw.length > MAX_RAW_CHARS) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return !!value && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

function uniqueName(input: string): string {
  const safe = input.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 90);
  return safe || 'oria-export.bin';
}

async function handleExport(message: HostMessage) {
  const data = message.base64;
  if (typeof data !== 'string' || !data || data.length > MAX_EXPORT_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new Error('Export non valide ou trop volumineux.');
  }
  const filename = uniqueName(typeof message.filename === 'string' ? message.filename : 'oria-export.bin');
  const mimeType = typeof message.mimeType === 'string' ? message.mimeType.slice(0, 100) : 'application/octet-stream';
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!directory) throw new Error('Le stockage local est indisponible.');
  const destination = `${directory}oria-${Date.now()}-${filename}`;
  await FileSystem.writeAsStringAsync(destination, data, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destination, { mimeType, dialogTitle: filename });
  } else {
    throw new Error('Le partage des fichiers est indisponible sur cet appareil.');
  }
}

export default function OriaVisualWebView({
  kind,
  raw,
  language = 'fr',
  fallback = null,
  height = 550,
  rendererUrl,
}: OriaVisualProps) {
  const webRef = useRef<WebView<unknown>>(null);
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? 'dark' : 'light';
  const endpoint = useMemo(() => safeRendererUrl(rendererUrl ?? DEFAULT_URL), [rendererUrl]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(height);
  const [reloadIndex, setReloadIndex] = useState(0);

  const isValid = useMemo(() => validSpec(kind, raw), [kind, raw]);
  const languageFr = language === 'fr';

  // L'appel ReactNativeWebView.injectJavaScript ne reçoit JAMAIS du JS généré par l'IA.
  // Le contenu de l'IA est un littéral JSON encodé deux fois et interprété comme des données.
  const sendVisual = useCallback(() => {
    if (!isValid) return;
    const payload = JSON.stringify({
      channel: 'oria-visual-v1',
      type: 'render',
      kind, raw, language, theme,
    });
    const code = `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(payload)} })); true;`;
    webRef.current?.injectJavaScript(code);
  }, [isValid, kind, raw, language, theme]);

  useEffect(() => {
    if (ready) sendVisual();
  }, [ready, sendVisual]);

  useEffect(() => {
    setMeasuredHeight(height);
  }, [height, kind]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let value: HostMessage;
    try { value = JSON.parse(event.nativeEvent.data) as HostMessage; }
    catch { return; }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'ORIA_VISUAL_READY') {
      setReady(true);
      setFailed(null);
      setLoading(false);
    } else if (value.type === 'ORIA_VISUAL_HEIGHT' && typeof value.height === 'number' && Number.isFinite(value.height)) {
      setMeasuredHeight(Math.max(180, Math.min(1800, Math.ceil(value.height) + 3)));
      setLoading(false);
    } else if (value.type === 'ORIA_VISUAL_CLIPBOARD' && typeof value.text === 'string') {
      void Clipboard.setStringAsync(value.text.slice(0, 200_000)).catch(() => {
        Alert.alert('ORIA', languageFr ? 'Copie impossible.' : 'Could not copy.');
      });
    } else if (value.type === 'ORIA_VISUAL_EXPORT') {
      void handleExport(value).catch((error: unknown) => {
        Alert.alert('ORIA', error instanceof Error ? error.message : 'Export impossible.');
      });
    } else if (value.type === 'ORIA_VISUAL_ERROR') {
      setFailed(typeof value.message === 'string' ? value.message.slice(0, 180) : 'Erreur de visualisation.');
      setLoading(false);
    }
  }, [languageFr]);

  if (!isValid) return <>{fallback}</>;

  if (!endpoint) {
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          {languageFr
            ? 'ORIA Visuel : configure EXPO_PUBLIC_ORIA_VISUAL_RENDERER_URL vers le moteur Web partagé.'
            : 'ORIA Visual: configure EXPO_PUBLIC_ORIA_VISUAL_RENDERER_URL to the shared Web renderer.'}
        </Text>
      </View>
    );
  }

  const allowedOrigin = new URL(endpoint).origin;
  return (
    <View style={[styles.container, { borderColor: theme === 'dark' ? '#334155' : '#e2e8f0' }]}>
      {failed ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{failed}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            setReady(false); setLoading(true); setFailed(null); setReloadIndex(i => i + 1);
          }} style={styles.retry}>
            <Text style={styles.retryLabel}>{languageFr ? 'Réessayer' : 'Retry'}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <WebView<unknown>
            ref={webRef}
            key={`${endpoint}:${reloadIndex}`}
            source={{ uri: endpoint }}
            originWhitelist={['https://*', 'http://*']}
            onShouldStartLoadWithRequest={request => {
              // Pas de navigation interne vers une page inconnue ni d'exécution de javascript:.
              if (request.url === 'about:blank') return true;
              try {
                const next = new URL(request.url);
                if (next.origin === allowedOrigin && next.pathname === new URL(endpoint).pathname) return true;
                if (next.protocol === 'https:') void Linking.openURL(next.toString()).catch(() => undefined);
              } catch { /* ignore URL */ }
              return false;
            }}
            onMessage={onMessage}
            onLoadStart={() => { setReady(false); setLoading(true); }}
            onLoadEnd={() => { /* Attendre le message READY de React après hydratation. */ }}
            onError={() => { setFailed(languageFr ? 'Impossible de joindre le moteur visuel Web.' : 'Cannot reach the Web visual renderer.'); setLoading(false); }}
            onHttpError={event => {
              if (event.nativeEvent.statusCode >= 400 && event.nativeEvent.url.startsWith(allowedOrigin)) {
                setFailed(`Serveur visuel : HTTP ${event.nativeEvent.statusCode}.`);
                setLoading(false);
              }
            }}
            javaScriptEnabled
            domStorageEnabled={false}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            androidLayerType="hardware"
            style={[styles.web, { height: measuredHeight, backgroundColor: theme === 'dark' ? '#0f172a' : '#fff' }]}
          />
          {loading && <View pointerEvents="none" style={styles.loading}>
            <ActivityIndicator color="#0d9488" />
            <Text style={styles.loadingLabel}>{languageFr ? 'Chargement du visuel interactif…' : 'Loading interactive visual…'}</Text>
          </View>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', marginVertical: 10, overflow: 'hidden', borderWidth: 1, borderRadius: 16 },
  web: { width: '100%' },
  loading: { position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center', gap: 8 },
  loadingLabel: { fontSize: 12, color: '#64748b' },
  notice: { padding: 15, minHeight: 95, alignItems: 'flex-start', justifyContent: 'center', gap: 10 },
  noticeText: { color: '#64748b', fontSize: 13 },
  retry: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#0d9488' },
  retryLabel: { color: 'white', fontSize: 13, fontWeight: '600' },
});
