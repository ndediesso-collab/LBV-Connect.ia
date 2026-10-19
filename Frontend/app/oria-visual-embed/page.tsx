'use client';

/**
 * Route Web ORIA dédiée à Expo WebView.
 * Réutilise STRICTEMENT les quatre moteurs installés dans Frontend :
 *   OriaVisualAdvanced, OriaVisualCore, OriaVisual3D, OriaVisualMaps.
 *
 * Ne demande aucun jeton de session, ne lit pas le cache du chat et ne
 * transmet aucune donnée du chat à des CDN pour exécuter des scripts.
 * Les données JSON arrivent après chargement par le pont mobile / WebView.
 *
 * Chemin : Frontend/app/oria-visual-embed/page.tsx
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const OriaVisualAdvanced = dynamic(() => import('@/components/oria-visual/OriaVisualAdvanced'), { ssr: false });
const OriaVisualCore = dynamic(() => import('@/components/oria-visual/OriaVisualCore'), { ssr: false });
const OriaVisual3D = dynamic(() => import('@/components/oria-visual/OriaVisual3D'), { ssr: false });
const OriaVisualMaps = dynamic(() => import('@/components/oria-visual/OriaVisualMaps'), { ssr: false });

type Language = 'fr' | 'en';
type Theme = 'light' | 'dark';
type VisualRequest = { channel: 'oria-visual-v1'; type: 'render'; kind: string; raw: string; language: Language; theme: Theme };
type BridgeWindow = Window & { ReactNativeWebView?: { postMessage(message: string): void } };

const VISUAL_KINDS = new Set([
  'oria-chart', 'oria-grid', 'oria-diagram',
  'oria-stats', 'oria-geometry', 'oria-table', 'oria-callout',
  'oria-3d', 'oria-map',
]);
const ADVANCED_KINDS = new Set(['oria-chart', 'oria-grid', 'oria-diagram']);
const CORE_KINDS = new Set(['oria-stats', 'oria-geometry', 'oria-table', 'oria-callout']);
const MAX_MESSAGE_CHARS = 250_000;
const MAX_EXPORT_BYTES = 8_000_000;

function sendToNative(data: Record<string, unknown>): void {
  const bridge = (window as BridgeWindow).ReactNativeWebView;
  if (bridge) bridge.postMessage(JSON.stringify(data));
}

function decodeRequest(value: unknown): VisualRequest | null {
  if (typeof value !== 'string' || value.length > MAX_MESSAGE_CHARS) return null;
  try {
    const item: unknown = JSON.parse(value);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const spec = item as Partial<VisualRequest>;
    if (spec.channel !== 'oria-visual-v1' || spec.type !== 'render') return null;
    if (typeof spec.kind !== 'string' || !VISUAL_KINDS.has(spec.kind)) return null;
    if (typeof spec.raw !== 'string' || spec.raw.length > 180_000) return null;
    if (spec.language !== 'fr' && spec.language !== 'en') return null;
    if (spec.theme !== 'dark' && spec.theme !== 'light') return null;
    const json: unknown = JSON.parse(spec.raw);
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    return spec as VisualRequest;
  } catch {
    return null;
  }
}

async function forwardDownload(href: string, filename: string) {
  try {
    if (!/^(blob:|data:)/.test(href)) return;
    const response = await fetch(href);
    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_EXPORT_BYTES) throw new Error('Fichier trop volumineux pour le partage mobile.');
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return;
      const comma = result.indexOf(',');
      if (comma < 0) return;
      sendToNative({
        type: 'ORIA_VISUAL_EXPORT',
        filename: filename.slice(0, 95),
        mimeType: blob.type || 'application/octet-stream',
        base64: result.slice(comma + 1),
      });
    };
    reader.onerror = () => sendToNative({ type: 'ORIA_VISUAL_ERROR', message: 'Lecture du fichier exporté impossible.' });
    reader.readAsDataURL(blob);
  } catch (error) {
    sendToNative({
      type: 'ORIA_VISUAL_ERROR',
      message: error instanceof Error ? error.message : 'Export impossible.',
    });
  }
}

/** Capture les boutons d'export de nos moteurs Web (CSV / PNG / SVG). */
function installMobileExports(): () => void {
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.download && /^(blob:|data:)/.test(this.href)) {
      void forwardDownload(this.href, this.download);
      return;
    }
    originalClick.call(this);
  };
  // Les liens activés à la main ne passent pas nécessairement par .click().
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[download]') : null;
    if (!(anchor instanceof HTMLAnchorElement) || !/^(blob:|data:)/.test(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
    void forwardDownload(anchor.href, anchor.download);
  };
  document.addEventListener('click', onClick, true);
  return () => {
    HTMLAnchorElement.prototype.click = originalClick;
    document.removeEventListener('click', onClick, true);
  };
}

function installMobileClipboard(): () => void {
  const navigatorObject = navigator as Navigator & { clipboard?: Clipboard };
  const original = Object.getOwnPropertyDescriptor(navigatorObject, 'clipboard');
  // Une route WebView isolée : copier un tableau depuis Core doit aussi marcher sur Mobile.
  if (original && !original.configurable) return () => undefined;
  try {
    Object.defineProperty(navigatorObject, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => {
        sendToNative({ type: 'ORIA_VISUAL_CLIPBOARD', text });
      } },
    });
  } catch { return () => undefined; }
  return () => {
    try {
      if (original) Object.defineProperty(navigatorObject, 'clipboard', original);
      else Reflect.deleteProperty(navigatorObject, 'clipboard');
    } catch { /* ignore */ }
  };
}

function RenderVisual({ request }: { request: VisualRequest }): ReactNode {
  const { kind, raw, language } = request;
  const fallback = <pre role="alert" className="whitespace-pre-wrap break-words p-4 text-sm text-red-700">{language === 'fr' ? 'Format de visualisation non reconnu.' : 'Unsupported visualization format.'}</pre>;
  if (ADVANCED_KINDS.has(kind)) return <OriaVisualAdvanced kind={kind} raw={raw} language={language} fallback={fallback} />;
  if (CORE_KINDS.has(kind)) return <OriaVisualCore kind={kind} raw={raw} language={language} fallback={fallback} />;
  if (kind === 'oria-3d') return <OriaVisual3D kind={kind} raw={raw} language={language} fallback={fallback} />;
  if (kind === 'oria-map') return <OriaVisualMaps kind={kind} raw={raw} language={language} fallback={fallback} />;
  return fallback;
}

export default function OriaVisualEmbedPage() {
  const [request, setRequest] = useState<VisualRequest | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const notifyHeight = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const height = Math.max(180, Math.ceil(element.scrollHeight + 8));
    sendToNative({ type: 'ORIA_VISUAL_HEIGHT', height });
  }, []);
  const currentTheme = request?.theme ?? 'light';

  useEffect(() => {
    // Pas de données dans l'URL : le modèle fournit exclusivement un objet JSON.
    const onMessage = (event: MessageEvent<unknown>) => {
      const parsed = decodeRequest(event.data);
      if (parsed) setRequest(parsed);
    };
    window.addEventListener('message', onMessage);
    const removeExports = installMobileExports();
    const removeClipboard = installMobileClipboard();
    sendToNative({ type: 'ORIA_VISUAL_READY' });
    return () => {
      window.removeEventListener('message', onMessage);
      removeExports();
      removeClipboard();
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', currentTheme === 'dark');
    document.documentElement.style.colorScheme = currentTheme;
  }, [currentTheme]);

  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(notifyHeight) : null;
    observer?.observe(target);
    window.addEventListener('resize', notifyHeight);
    const frame = window.requestAnimationFrame(notifyHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', notifyHeight);
      window.cancelAnimationFrame(frame);
    };
  }, [notifyHeight, request]);

  const wrapperStyles = useMemo(() => ({
    backgroundColor: currentTheme === 'dark' ? '#0f172a' : '#ffffff',
    color: currentTheme === 'dark' ? '#f8fafc' : '#0f172a',
  }), [currentTheme]);

  return (
    <main style={{ margin: 0, padding: '0 4px', width: '100%', minHeight: 160, ...wrapperStyles }}>
      <div ref={root} id="oria-visual-root" className="w-full min-w-0 overflow-visible">
        {request ? <RenderVisual request={request} /> : (
          <div className="p-4 text-sm text-slate-500" role="status">ORIA Visual</div>
        )}
      </div>
    </main>
  );
}
