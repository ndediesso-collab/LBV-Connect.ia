"use client";
// ORIA_COLLAB_P10_SHARED_RICH_RENDERER
// Extracted verbatim from /chat/page.tsx at installation, not redesigned.
// Both /chat and the collaborative chat now call this same rendering component.
import dynamic from "next/dynamic";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Check, Code2, Download, ExternalLink, Eye, FileText, Maximize2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { OriaMathBlock, OriaMathInline } from "@/components/oria-math/OriaMathRenderer";

const OriaVisualAdvanced = dynamic(() => import("@/components/oria-visual/OriaVisualAdvanced"), {ssr:false});
const OriaVisualCore = dynamic(() => import("@/components/oria-visual/OriaVisualCore"), {ssr:false});
const OriaSimulator = dynamic(() => import("@/components/oria-simulator/OriaSimulator"), {ssr:false});
const OriaVisual3D = dynamic(() => import("@/components/oria-visual/OriaVisual3D"), {ssr:false});
const OriaVisualMaps = dynamic(() => import("@/components/oria-visual/OriaVisualMaps"), {ssr:false});

type OriaLanguage = "fr" | "en";
export type OriaWebIllustration = { image_url:string; source_url:string; caption:string; alt:string; after_paragraph:number };
type WebIllustration = OriaWebIllustration;
export type OriaCodePreviewData = { title:string; language:string; code:string };
type CodePreviewData = OriaCodePreviewData;
const UI = {
  fr:{copy:"Copier",copied:"Copié",download:"Télécharger"},
  en:{copy:"Copy",copied:"Copied",download:"Download"},
};

// Only legacy personal artifacts require re-signing; collaboration attachment URLs
// are handled by their authenticated room routes, not by this function.
const richSupabase = createClient();
const richApi = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");
async function apiFetch<T>(path:string): Promise<T> {
  const {data:{session}} = await richSupabase.auth.getSession();
  if(!session?.user?.id || !session.access_token) throw new Error("Session ORIA expirée.");
  const res = await fetch(`${richApi}${path}`, {cache:"no-store",headers:{
    "user-id":session.user.id,authorization:`Bearer ${session.access_token}`,
  }});
  if(!res.ok) throw new Error("Document ORIA privé indisponible.");
  return await res.json() as T;
}
function renderMathToken(expression: string, key: string, display = false): ReactNode {
  return display
    ? <OriaMathBlock key={key} latex={expression} />
    : <OriaMathInline key={key} latex={expression} />;
}

// Surtout ne pas inserer une formule display (<div>) a l'interieur d'un <p>.
// Les paragraphes qui contiennent des delims display sont decoupes en vrais blocs.
function renderParagraphWithDisplayMath(text: string, key: string): ReactNode {
  const delimiter = /(\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g;
  const result: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let position = 0;
  while ((match = delimiter.exec(text)) !== null) {
    const preceding = text.slice(last, match.index);
    if (preceding.trim()) {
      result.push(<p key={`${key}-p-${position++}`} className="mb-4 last:mb-0">{renderInlineMarkdown(preceding)}</p>);
    }
    const token = match[0];
    const latex = token.slice(2, -2);
    result.push(<OriaMathBlock key={`${key}-m-${position++}`} latex={latex} />);
    last = match.index + token.length;
  }
  if (last === 0) {
    return <p key={key} className="mb-4 last:mb-0">{renderInlineMarkdown(text)}</p>;
  }
  const tail = text.slice(last);
  if (tail.trim()) {
    result.push(<p key={`${key}-tail`} className="mb-4 last:mb-0">{renderInlineMarkdown(tail)}</p>);
  }
  return <Fragment key={key}>{result}</Fragment>;
}


async function oriaPdfBlobPreviewFromSignedUrl(url: string): Promise<string> {
  const response = await fetch(url, {cache: "no-store", referrerPolicy: "no-referrer"});
  if (!response.ok) throw new Error("PDF privé indisponible.");
  const maxBytes = 50 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > maxBytes) throw new Error("PDF trop volumineux pour l’aperçu.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 5 || bytes.byteLength > maxBytes ||
      new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("Fichier PDF invalide ou trop volumineux.");
  }
  return URL.createObjectURL(new Blob([bytes], {type: "application/pdf"}));
}

function OriaPrivatePdfLink({label, oldUrl}: {label: string; oldUrl: string}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  useEffect(() => () => {
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
  }, [preview]);

  const resolveFresh = async (): Promise<{previewUrl: string | null; downloadUrl: string | null; name: string}> => {
    const path = new URL(oldUrl).pathname;
    const match = path.match(/\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.|\/|$)/i);
    let id: string | undefined = match?.[1];
    if (!id) {
      // Anciens liens sans UUID: correspondance seulement si UNIQUE pour ce compte.
      const catalog = await apiFetch<{artifacts?: Array<{id: string; filename: string; extension: string}>}>(
        "/ai/artifacts?extension=pdf&limit=100"
      );
      const matches = (catalog.artifacts || []).filter(item => item.filename === label &&
        item.extension?.toLowerCase().replace(/^\./, "") === "pdf");
      if (matches.length !== 1) throw new Error("Document ambigu ou introuvable. Ouvre « Mes créations » pour le retrouver.");
      id = matches[0].id;
    }
    const response = await apiFetch<{artifact?: {filename?: string; preview_url?: string | null;
      download_url?: string | null; preview_available?: boolean}}>(`/ai/artifacts/${encodeURIComponent(id)}`);
    const artifact = response.artifact;
    if (!artifact) throw new Error("Document privé introuvable. Il n'a pas été supprimé par cette opération.");
    return {name: artifact.filename || label,
      previewUrl: artifact.preview_url ? oriaSafeUrl(artifact.preview_url) : null,
      downloadUrl: artifact.download_url ? oriaSafeUrl(artifact.download_url) : null};
  };
  const open = async () => {
    if (busy) return;
    setBusy(true); setFault(null);
    try {
      const urls = await resolveFresh();
      let inlineUrl: string | null = null;
      for (const candidate of [urls.previewUrl, urls.downloadUrl]) {
        if (!candidate) continue;
        try {
          inlineUrl = await oriaPdfBlobPreviewFromSignedUrl(candidate);
          break;
        } catch { /* Essayer le lien de téléchargement signé. */ }
      }
      if (!inlineUrl) throw new Error("Impossible de charger le PDF dans ORIA. Ouvrez Mes créations pour consulter ou télécharger le fichier.");
      setPreview(inlineUrl);
    } catch (e) { setFault(e instanceof Error ? e.message : "Aperçu indisponible."); }
    finally {setBusy(false);}
  };
  const download = async () => {
    if (busy) return;
    setBusy(true); setFault(null);
    try {
      const urls = await resolveFresh();
      if (!urls.downloadUrl) throw new Error("Lien de téléchargement temporairement indisponible.");
      // Le jeton est généré à l'instant du clic: jamais de lien historique expiré.
      const anchor = document.createElement("a");
      anchor.href = urls.downloadUrl;
      anchor.download = urls.name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (e) {setFault(e instanceof Error ? e.message : "Téléchargement indisponible.");}
    finally {setBusy(false);}
  };
  return <>
    <span className="inline-flex flex-wrap items-center gap-1">
    <button type="button" disabled={busy} onClick={() => void download()}
      className="font-medium underline underline-offset-2 hover:opacity-70 disabled:opacity-50">{label}</button>
    <button type="button" disabled={busy} onClick={() => void open()}
      title="Prévisualiser le PDF" aria-label={`Prévisualiser ${label}`}
      className="inline-flex rounded-md p-1 text-muted hover:bg-surface-secondary hover:text-foreground disabled:opacity-50"><Eye size={15}/></button>
    {fault && <span role="alert" className="text-xs text-red-600">{fault}</span>}
    </span>
    {preview && <div role="dialog" aria-modal="true" aria-label={`Aperçu de ${label}`}
      className="fixed inset-0 z-[200] flex flex-col bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="truncate font-semibold">{label}</span>
        <button type="button" onClick={() => setPreview(null)}
          className="rounded-lg border border-border px-4 py-2 text-sm">Fermer l'aperçu</button>
      </div>
      <iframe title={`Document ${label}`} src={preview} referrerPolicy="no-referrer"
        className="min-h-0 flex-1 w-full bg-white"/>
      <p className="px-3 py-1 text-center text-xs text-muted">Aperçu PDF privé (même lecteur que Mes créations).</p>
    </div>}
  </>;
}


function renderInlineMarkdown(
  text: string,
) {
  const parts: ReactNode[] = [];

  let remaining = text;
  let index = 0;

  // Le code inline reste du code ; seuls $...$ et \(...\) sont inline.
  // Les blocs $$...$$ et \[...\] passent par le renderer de blocs.
  const tokenRegex =
    /(`[^`]+`|\\\([^\n]*?\\\)|\$(?![\s$])(?:\\.|[^$\\\n])+\$(?!\d)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/;

  while (remaining.length > 0) {
    const match =
      remaining.match(tokenRegex);

    if (!match || match.index === undefined) {
      parts.push(
        <span key={index}>
          {remaining}
        </span>,
      );

      break;
    }

    if (match.index > 0) {
      parts.push(
        <span key={index}>
          {remaining.slice(
            0,
            match.index,
          )}
        </span>,
      );

      index++;
    }

    const token = match[0];

    /*
     * MATHS INLINE
     */

    if (
      (token.startsWith("\\(") && token.endsWith("\\)")) ||
      (token.startsWith("$") && token.endsWith("$"))
    ) {
      const expression = token.startsWith("$")
        ? token.slice(1, -1)
        : token.slice(2, -2);
      parts.push(renderMathToken(expression, String(index), false));
    }

    /*
     * GRAS
     */

    else if (
      token.startsWith("**") &&
      token.endsWith("**")
    ) {
      parts.push(
        <strong
          key={index}
          className="font-semibold"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    }

    /*
     * CODE INLINE
     */

    else if (
      token.startsWith("`") &&
      token.endsWith("`")
    ) {
      parts.push(
        <code
          key={index}
          className="rounded-md bg-surface-tertiary px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }

    /*
     * LIEN
     */

    else if (
      token.startsWith("[")
    ) {
      const linkMatch =
        token.match(
          /^\[([^\]]+)\]\(([^)]+)\)$/,
        );

      if (linkMatch) {
        const [, label, url] = linkMatch;
        const safeUrl = oriaSafeUrl(url);
        parts.push(safeUrl ? (
          (/\.pdf(?:$|[?#])/i.test(label) &&
            /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/sign\/generated-artifacts\//i.test(safeUrl)
              ? <OriaPrivatePdfLink key={index} label={label} oldUrl={safeUrl}/>
              : <a key={index} href={safeUrl} target="_blank" rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2 hover:opacity-70">{label}</a>)
        ) : <span key={index}>{label}</span>);
      }
    }

    /*
     * ITALIQUE
     */

    else if (
      token.startsWith("*") &&
      token.endsWith("*")
    ) {
      parts.push(
        <em key={index}>
          {token.slice(1, -1)}
        </em>,
      );
    }

    remaining =
      remaining.slice(
        match.index +
          token.length,
      );

    index++;
  }

  return parts;
}

/*
 * ============================================================
 * MARKDOWN BLOCK RENDERER
 * ============================================================
 *
 * Transforme le texte brut de l'IA en vraie structure visuelle.
 *
 * Gestion :
 *
 * - paragraphes
 * - titres
 * - listes à puces
 * - listes numérotées
 * - blocs de code
 * - citations
 * - séparateurs
 * - Markdown inline
 */

function CopyButton({
  value,
  language = "fr",
}: {
  value: string;
  language?: OriaLanguage;
}) {
  const [copied, setCopied] =
    useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        value,
      );

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:bg-surface-tertiary hover:text-foreground"
      aria-label={UI[language].copy}
      title={UI[language].copy}
    >
      {copied ? UI[language].copied : UI[language].copy}
    </button>
  );
}


function codeFileName(lang: string, hint = ""): string {
  const candidate = hint.match(/([\w./-]+\.[a-z0-9]{1,8})/i)?.[1];
  if (candidate) return candidate;
  const ext: Record<string, string> = {
    python: "py", javascript: "js", typescript: "ts", bash: "sh",
    shell: "sh", json: "json", tsx: "tsx", jsx: "jsx", html: "html", css: "css",
  };
  return `code_oria.${ext[lang.toLowerCase()] || lang.toLowerCase() || "txt"}`;
}

const CODE_WORDS = new Set([
  "const", "let", "var", "function", "class", "return", "if", "else", "try", "catch",
  "finally", "throw", "new", "async", "await", "import", "export", "default", "from",
  "interface", "type", "extends", "implements", "public", "private", "static", "def",
  "self", "None", "True", "False", "pass", "for", "while", "in", "of", "as",
  "with", "yield", "lambda", "raise", "except", "elif", "print", "SELECT", "WHERE",
  "FROM", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE", "AND", "OR", "JOIN",
]);

function highlightedCode(source: string): ReactNode {
  // Le source entier reste téléchargeable/copier, même quand il est très long.
  // Au-delà de 160 Ko, limiter uniquement la coloration (jamais le contenu).
  if (source.length > 160_000) return source;
  const token = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  const chunks: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const match of source.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > at) chunks.push(source.slice(at, index));
    const value = match[0];
    const className = /^(\/\/|#|--|\/\*)/.test(value)
      ? "text-emerald-500/90" : /^["'`]/.test(value)
        ? "text-amber-600 dark:text-amber-300" : /^\d/.test(value)
          ? "text-sky-600 dark:text-sky-300" : CODE_WORDS.has(value)
            ? "text-violet-600 dark:text-violet-300 font-semibold" : "";
    chunks.push(className ? <span key={n++} className={className}>{value}</span> : value);
    at = index + value.length;
  }
  if (at < source.length) chunks.push(source.slice(at));
  return chunks;
}

function downloadSource(code: string, filename: string) {
  const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\/\\]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}


function CodePreviewModal({ preview, onClose, language }: {
  preview: CodePreviewData; onClose: () => void; language: OriaLanguage;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={preview.title}
      className="fixed inset-0 z-[90] flex flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary"><Code2 size={19}/></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{preview.title}</p>
            <p className="text-[11px] text-muted">{preview.language.toUpperCase()} · {preview.code.split("\n").length} {language === "fr" ? "lignes" : "lines"}</p></div>
        </div>
        <div className="flex items-center gap-1.5">
          <CopyButton value={preview.code} language={language}/>
          <button type="button" onClick={() => downloadSource(preview.code, preview.title)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-surface-secondary"><Download size={15}/><span className="hidden sm:inline">{UI[language].download}</span></button>
          <button type="button" aria-label={language === "fr" ? "Fermer" : "Close"} onClick={onClose}
            className="rounded-xl p-2.5 transition hover:bg-surface-secondary"><X size={20}/></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-secondary/35 p-4 sm:p-7">
        <pre className="min-w-max whitespace-pre text-[12px] leading-[1.9] tabular-nums sm:text-[13px]"><code>{highlightedCode(preview.code)}</code></pre>
      </div>
    </div>
  );
}

function CodeBlockCard({ language, code, title, onExpand, uiLanguage }: {
  language: string; code: string; title: string;
  onExpand: (preview: CodePreviewData) => void; uiLanguage: OriaLanguage;
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface-secondary last:mb-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-muted-strong"><Code2 size={13} className="mr-1.5 inline"/>{title}</span>
        <div className="flex items-center gap-1.5"><CopyButton value={code} language={uiLanguage}/>
          <button type="button" onClick={() => onExpand({ title, language, code })}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] hover:bg-surface-tertiary"
            aria-label={uiLanguage === "fr" ? "Ouvrir le lecteur" : "Open code viewer"}>
            <Maximize2 size={13}/>{uiLanguage === "fr" ? "Ouvrir" : "Open"}</button>
        </div>
      </div>
      <pre className="max-h-72 overflow-auto p-4 text-xs leading-6"><code className="whitespace-pre">{highlightedCode(code)}</code></pre>
    </div>
  );
}

function WebImageGallery({ images, language }: { images: WebIllustration[]; language: OriaLanguage }) {
  if (!images.length) return null;
  return (
    <div className="my-4 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
      {images.map((item) => (
        <a key={item.image_url} href={item.source_url} target="_blank" rel="noopener noreferrer"
          className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:border-muted-strong">
          <div className="aspect-[16/10] w-full overflow-hidden bg-surface-secondary">
            <img src={item.image_url} alt={item.alt} loading="lazy" referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"/>
          </div>
          <div className="flex items-start gap-2 p-3"><p className="min-w-0 flex-1 text-xs leading-5 text-muted-strong">
            {item.caption || item.alt}</p><ExternalLink size={13} className="mt-1 shrink-0 text-muted"/></div>
          <p className="px-3 pb-3 text-[10px] text-muted">{language === "fr" ? "Voir la source" : "View source"} · {new URL(item.source_url).hostname}</p>
        </a>
      ))}
    </div>
  );
}


type OriaRecord = Record<string, unknown>;

function oriaRecord(value: unknown): OriaRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as OriaRecord : null;
}

function oriaLabel(value: unknown, fallback = "", max = 160): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function oriaFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function oriaSafeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname ? url.href : null;
  } catch { return null; }
}

function oriaTableCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let codeOpen = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\" && source[index + 1] === "|") {
      current += "|";
      index++;
    } else if (char === "`") {
      codeOpen = !codeOpen;
      current += char;
    } else if (char === "|" && !codeOpen) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function oriaIsTableDivider(line: string): boolean {
  const cells = oriaTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function OriaDataTable({ headers, rows, alignment, language }: {
  headers: string[];
  rows: string[][];
  alignment: Array<"left" | "center" | "right">;
  language: OriaLanguage;
}) {
  const [copied, setCopied] = useState(false);
  const asTsv = [headers, ...rows].map((row) => row.map((cell) =>
    cell.replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
  const alignClass = (index: number) => alignment[index] === "right" ? "text-right" :
    alignment[index] === "center" ? "text-center" : "text-left";
  return <section className="my-4 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-label={language === "fr" ? "Tableau de données" : "Data table"}>
    <div className="flex items-center justify-between border-b border-border bg-surface-secondary/40 px-3 py-2">
      <span className="inline-flex items-center gap-2 text-xs font-medium text-muted"><FileText size={14}/>{language === "fr" ? "Tableau" : "Table"}</span>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(asTsv).then(() => {
        setCopied(true); window.setTimeout(() => setCopied(false), 1500);
      }).catch(() => setCopied(false)); }} className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-surface-tertiary">
        {copied ? (language === "fr" ? "Copié" : "Copied") : (language === "fr" ? "Copier" : "Copy")}
      </button>
    </div>
    <div className="max-w-full overflow-x-auto" role="region" tabIndex={0} aria-label={language === "fr" ? "Tableau défilable" : "Scrollable table"}>
      <table className="w-full min-w-max border-collapse text-[13px] leading-5">
        <thead><tr className="bg-surface-secondary/70">{headers.map((cell, index) =>
          <th scope="col" key={index} className={`whitespace-nowrap border-b border-border px-4 py-3 font-semibold ${alignClass(index)}`}>{renderInlineMarkdown(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="even:bg-surface-secondary/30">{headers.map((_, index) =>
          <td key={index} className={`max-w-[360px] border-b border-border/50 px-4 py-2.5 align-top last:border-b-0 ${alignClass(index)}`}>{renderInlineMarkdown(row[index] || "")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function OriaCallout({ kind, lines, language }: {kind: string; lines: string[]; language: OriaLanguage}) {
  const variants: Record<string, { color: string; title: string }> = {
    NOTE: { color: "border-sky-500/50", title: language === "fr" ? "Note" : "Note" },
    TIP: { color: "border-emerald-500/50", title: language === "fr" ? "Conseil" : "Tip" },
    IMPORTANT: { color: "border-violet-500/50", title: language === "fr" ? "Important" : "Important" },
    WARNING: { color: "border-amber-500/60", title: language === "fr" ? "Attention" : "Warning" },
    CAUTION: { color: "border-red-500/60", title: language === "fr" ? "Prudence" : "Caution" },
  };
  const variant = variants[kind] || variants.NOTE;
  return <aside className={`my-4 rounded-xl border-l-4 ${variant.color} bg-surface-secondary/50 p-3.5`}>
    <p className="mb-1 text-xs font-bold tracking-wide">{variant.title}</p>
    <div className="space-y-1 text-[13px]">{lines.map((line, index) => <p key={index}>{renderInlineMarkdown(line)}</p>)}</div>
  </aside>;
}

const ORIA_PALETTE = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#64748b"];

function OriaChart({ data, language }: { data: OriaRecord; language: OriaLanguage }) {
  const kind = oriaLabel(data.type || data.chartType).toLowerCase();
  if (!["bar", "line", "pie", "scatter"].includes(kind) || !Array.isArray(data.data)) return null;
  const title = oriaLabel(data.title, language === "fr" ? "Graphique" : "Chart");
  const items = data.data.slice(0, 36).map(oriaRecord).filter((item): item is OriaRecord => !!item);
  const values = items.map((item) => oriaFinite(item.value ?? item.y));
  const points = items.filter((_, index) => values[index] !== null).map((item) => ({
    label: oriaLabel(item.label ?? item.name ?? item.x, "", 48),
    x: oriaFinite(item.x),
    y: oriaFinite(item.value ?? item.y) as number,
  }));
  if (!points.length) return null;
  const W = 640, H = 320, left = 55, right = 18, top = 24, bottom = 65;
  const plotW = W - left - right, plotH = H - top - bottom;
  const minY = Math.min(0, ...points.map((item) => item.y));
  const maxY = Math.max(0, ...points.map((item) => item.y));
  const scaleMin = minY === maxY ? minY - 1 : minY;
  const scaleMax = minY === maxY ? maxY + 1 : maxY;
  const yToPx = (value: number) => top + (scaleMax - value) / (scaleMax - scaleMin) * plotH;
  const labelFor = (value: number) => Number(value.toFixed(2)).toLocaleString(language === "fr" ? "fr-FR" : "en-US");
  let marks: ReactNode = null;
  if (kind === "pie") {
    const positive = points.filter((point) => point.y > 0);
    const sum = positive.reduce((total, item) => total + item.y, 0);
    if (!sum) return null;
    let cursor = -Math.PI / 2;
    marks = <>{positive.map((item, index) => {
      const ratio = item.y / sum;
      const angle = Math.PI * 2 * ratio;
      const start = cursor;
      cursor += angle;
      const cx = 300, cy = 155, radius = 115;
      if (ratio >= 0.99999) return <circle key={index} cx={cx} cy={cy} r={radius} fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}/>;
      const x1 = cx + radius * Math.cos(start), y1 = cy + radius * Math.sin(start);
      const x2 = cx + radius * Math.cos(cursor), y2 = cy + radius * Math.sin(cursor);
      return <path key={index} d={`M${cx} ${cy} L${x1} ${y1} A${radius} ${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`}
        fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}><title>{item.label}: {labelFor(item.y)}</title></path>;
    })}</>;
  } else {
    const xs = points.map((point, index) => kind === "scatter" ? (point.x ?? index) : index);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const xToPx = (x: number) => minX === maxX ? left + plotW / 2 : left + (x - minX) / (maxX - minX) * plotW;
    const step = plotW / points.length;
    const linePoints = points.map((point, index) => `${xToPx(xs[index])},${yToPx(point.y)}`).join(" ");
    marks = <>
      {Array.from({length: 5}, (_, index) => {
        const value = scaleMin + (scaleMax - scaleMin) * index / 4;
        return <g key={index}><line x1={left} y1={yToPx(value)} x2={W - right} y2={yToPx(value)} stroke="currentColor" strokeOpacity="0.12"/>
          <text x={left - 8} y={yToPx(value) + 4} fontSize="12" textAnchor="end" fill="currentColor" opacity="0.7">{labelFor(value)}</text></g>;
      })}
      {kind === "bar" ? points.map((item, index) => {
        const x = left + index * step + step * 0.16;
        const barWidth = step * 0.68;
        const zeroY = yToPx(0), pointY = yToPx(item.y);
        return <rect key={index} x={x} y={Math.min(zeroY, pointY)} width={barWidth} height={Math.max(1, Math.abs(zeroY - pointY))} rx="3" fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}>
          <title>{item.label}: {labelFor(item.y)}</title></rect>;
      }) : null}
      {kind === "line" ? <polyline fill="none" stroke={ORIA_PALETTE[0]} strokeWidth="3" strokeLinejoin="round" points={linePoints}/> : null}
      {kind === "line" || kind === "scatter" ? points.map((item, index) => <circle key={index} cx={xToPx(xs[index])} cy={yToPx(item.y)} r={kind === "scatter" ? 5 : 4} fill={ORIA_PALETTE[index % ORIA_PALETTE.length]}>
        <title>{item.label}: {labelFor(item.y)}</title></circle>) : null}
      {points.map((item, index) => points.length <= 14 || index % Math.ceil(points.length / 12) === 0 ?
        <text key={index} x={kind === "bar" ? left + step * (index + .5) : xToPx(xs[index])} y={H - bottom + 21}
          fontSize="11" fill="currentColor" opacity=".75" textAnchor="middle">{item.label.slice(0, 12)}</text> : null)}
    </>;
  }
  return <figure className="my-4 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-4">
    <figcaption className="mb-2 font-semibold">{title}</figcaption>
    <div className="max-w-full overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="w-full min-w-[320px]" xmlns="http://www.w3.org/2000/svg">{marks}</svg></div>
    {kind === "pie" ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">{points.filter((point) => point.y > 0).map((point, index) =>
      <span key={index} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{backgroundColor: ORIA_PALETTE[index % ORIA_PALETTE.length]}}/>{point.label}: {labelFor(point.y)}</span>)}</div> : null}
    <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">{language === "fr" ? "Voir les données" : "View data"}</summary>
      <div className="mt-2 max-h-36 overflow-auto">{points.map((point, index) => <p key={index}>{point.label || index + 1}: {labelFor(point.y)}</p>)}</div>
    </details>
  </figure>;
}

function OriaStats({ data }: { data: OriaRecord }) {
  if (!Array.isArray(data.items)) return null;
  const items = data.items.slice(0, 12).map(oriaRecord).filter((item): item is OriaRecord => !!item);
  if (!items.length) return null;
  return <section className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={oriaLabel(data.title, "Statistiques")}>
    {items.map((item, index) => <div key={index} className="min-w-0 rounded-xl border border-border bg-surface p-3">
      <p className="truncate text-[11px] text-muted">{oriaLabel(item.label)}</p>
      <p className="mt-1 break-words text-xl font-semibold tabular-nums">{oriaLabel(item.value, String(oriaFinite(item.value) ?? "—"), 60)}</p>
      {item.detail ? <p className="mt-1 text-xs text-muted">{oriaLabel(item.detail)}</p> : null}
    </div>)}
  </section>;
}

function OriaDiagram({ data }: { data: OriaRecord }) {
  if (!Array.isArray(data.nodes)) return null;
  const nodes = data.nodes.slice(0, 12).map(oriaRecord).filter((item): item is OriaRecord => !!item)
    .map((node, index) => ({id: oriaLabel(node.id, String(index)), label: oriaLabel(node.label, "Étape", 64)}));
  if (!nodes.length) return null;
  const edges = Array.isArray(data.edges) ? data.edges.slice(0, 24).map(oriaRecord).filter((item): item is OriaRecord => !!item) : [];
  const width = 600, row = 92, height = nodes.length * row + 28;
  const indexes = new Map(nodes.map((node, index) => [node.id, index]));
  return <figure className="my-4 overflow-hidden rounded-2xl border border-border bg-surface p-3">
    <figcaption className="mb-2 font-semibold">{oriaLabel(data.title, "Diagramme")}</figcaption>
    <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" role="img" aria-label={oriaLabel(data.title, "Diagramme")}>
      {edges.map((edge, index) => {
        const from = indexes.get(oriaLabel(edge.from)), to = indexes.get(oriaLabel(edge.to));
        if (from === undefined || to === undefined || from === to) return null;
        const y1 = from * row + 71, y2 = to * row + 19;
        return <g key={index}><path d={`M300 ${y1} L300 ${y2}`} fill="none" stroke="#64748b" strokeWidth="1.5"/>
          <polygon points={y2 >= y1 ? `294,${y2 - 9} 306,${y2 - 9} 300,${y2}` : `294,${y2 + 9} 306,${y2 + 9} 300,${y2}`} fill="#64748b"/>
          {edge.label ? <text x="310" y={(y1 + y2) / 2} fontSize="11" fill="currentColor">{oriaLabel(edge.label, "", 30)}</text> : null}</g>;
      })}
      {nodes.map((node, index) => <g key={node.id}><rect x="120" y={index * row + 18} width="360" height="54" rx="14" fill="#2563eb" fillOpacity=".08" stroke="#64748b" strokeOpacity=".6"/>
        <text x="300" y={index * row + 49} fill="currentColor" fontSize="14" textAnchor="middle">{node.label}</text></g>)}
    </svg></div>
  </figure>;
}

function OriaGeometry({ data }: { data: OriaRecord }) {
  if (!Array.isArray(data.elements)) return null;
  const width = Math.min(1200, Math.max(100, oriaFinite(data.width) ?? 600));
  const height = Math.min(900, Math.max(100, oriaFinite(data.height) ?? 360));
  const shapes = data.elements.slice(0, 80).map(oriaRecord).filter((item): item is OriaRecord => !!item);
  const number = (item: OriaRecord, key: string) => oriaFinite(item[key]);
  const color = (item: OriaRecord) => ORIA_PALETTE[Math.min(ORIA_PALETTE.length - 1, Math.max(0, Math.floor(oriaFinite(item.colorIndex) ?? 0)))];
  return <figure className="my-4 overflow-hidden rounded-2xl border border-border bg-surface p-3">
    <figcaption className="mb-2 font-semibold">{oriaLabel(data.title, "Figure géométrique")}</figcaption>
    <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" role="img" aria-label={oriaLabel(data.title, "Figure géométrique")}>
      {shapes.map((item, index) => {
        const type = oriaLabel(item.type);
        const stroke = color(item);
        if (type === "line") {
          const x1 = number(item,"x1"), y1 = number(item,"y1"), x2 = number(item,"x2"), y2 = number(item,"y2");
          return [x1,y1,x2,y2].every((v) => v !== null) ? <line key={index} x1={x1!} y1={y1!} x2={x2!} y2={y2!} stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "circle") {
          const cx = number(item,"cx"), cy = number(item,"cy"), r = number(item,"r");
          return cx !== null && cy !== null && r !== null && r > 0 && r < 2000 ? <circle key={index} cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "rect") {
          const x = number(item,"x"), y = number(item,"y"), w = number(item,"width"), h = number(item,"height");
          return x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0 ? <rect key={index} x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "polygon" && Array.isArray(item.points)) {
          const coordinates = item.points.slice(0, 25).filter((point) => Array.isArray(point) && point.length === 2 && point.every((n) => oriaFinite(n) !== null)) as number[][];
          return coordinates.length >= 3 ? <polygon key={index} points={coordinates.map((p) => p.join(",")).join(" ")} fill={stroke} fillOpacity=".1" stroke={stroke} strokeWidth="2.5"/> : null;
        }
        if (type === "point" || type === "text") {
          const x = number(item,"x"), y = number(item,"y");
          if (x === null || y === null) return null;
          return <g key={index}>{type === "point" ? <circle cx={x} cy={y} r="4.5" fill={stroke}/> : null}
            <text x={x + (type === "point" ? 10 : 0)} y={y - (type === "point" ? 8 : 0)} fill="currentColor" fontSize="14">{oriaLabel(item.label, "", 60)}</text></g>;
        }
        return null;
      })}
    </svg></div>
    {data.caption ? <p className="mt-2 text-xs text-muted">{oriaLabel(data.caption, "", 280)}</p> : null}
  </figure>;
}

function oriaRenderVisualBlock(kind: string, raw: string, language: OriaLanguage): ReactNode | null {
  if (raw.length > 60000) return null;
  let data: OriaRecord | null;
  try { data = oriaRecord(JSON.parse(raw)); } catch { return null; }
  if (!data) return null;
  if (kind === "oria-chart") return <OriaChart data={data} language={language}/>;
  if (kind === "oria-stats") return <OriaStats data={data}/>;
  if (kind === "oria-diagram") return <OriaDiagram data={data}/>;
  if (kind === "oria-geometry") return <OriaGeometry data={data}/>;
  return null;
}

/*
 * ============================================================
 * MARKDOWN MESSAGE
 * ============================================================
 */

function MarkdownMessage({
  content,
  language = "fr",
  onOpenCode,
  webImages = [],
}: {
  content: string;
  language?: OriaLanguage;
  onOpenCode?: (preview: CodePreviewData) => void;
  webImages?: WebIllustration[];
}) {
  const normalized =
    content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  const lines =
    normalized.split("\n");

  const blocks: ReactNode[] =
    [];

  let paragraph: string[] = [];

  let bulletItems: string[] =
    [];

  let numberedItems: string[] =
    [];

  let codeLines: string[] =
    [];

  let codeLanguage = "";
  let codeTitle = "";
  let lastCodeHeading = "";
  const consumedTableLines = new Set<number>();

  let inCodeBlock = false;
  // Une formule multiline n'est rendue qu'apres son delimiteur de fermeture.
  // Cela evite d'afficher des moities d'equation pendant le streaming.
  let mathMode: { ending: string; parts: string[] } | null = null;

  let blockIndex = 0;
  let paragraphIndex = 0;
  const placedImageUrls = new Set<string>();

  function addWebImages(upToParagraph: number) {
    const due = webImages.filter((item) => !placedImageUrls.has(item.image_url) &&
      item.after_paragraph <= upToParagraph);
    if (!due.length) return;
    due.forEach((item) => placedImageUrls.add(item.image_url));
    blocks.push(<WebImageGallery key={`web-${blockIndex++}`} images={due} language={language}/>);
  }

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    const text =
      paragraph.join(" ");

    blocks.push(renderParagraphWithDisplayMath(text, `paragraph-${blockIndex}`));

    blockIndex++;
    addWebImages(paragraphIndex++);
    paragraph = [];
  }

  function flushBulletList() {
    if (bulletItems.length === 0) {
      return;
    }

    flushParagraph();

    blocks.push(
      <ul
        key={`bullet-${blockIndex}`}
        className="mb-4 list-disc space-y-2 pl-6 last:mb-0"
      >
        {bulletItems.map(
          (item, index) => (
            <li
              key={`bullet-item-${index}`}
              className="pl-1"
            >
              {/^\[([ xX])\]\s+/.test(item) ? (
                <label className="inline-flex items-start gap-2">
                  <input type="checkbox" checked={/^\[[xX]\]/.test(item)} readOnly
                    className="mt-1.5 h-3.5 w-3.5 accent-foreground"/>
                  <span>{renderInlineMarkdown(item.replace(/^\[[ xX]\]\s+/, ""))}</span>
                </label>
              ) : renderInlineMarkdown(item)}
            </li>
          ),
        )}
      </ul>,
    );

    blockIndex++;
    bulletItems = [];
  }

  function flushNumberedList() {
    if (
      numberedItems.length ===
      0
    ) {
      return;
    }

    flushParagraph();

    blocks.push(
      <ol
        key={`numbered-${blockIndex}`}
        className="mb-4 list-decimal space-y-2 pl-6 last:mb-0"
      >
        {numberedItems.map(
          (item, index) => (
            <li
              key={`numbered-item-${index}`}
              className="pl-1"
            >
              {renderInlineMarkdown(
                item,
              )}
            </li>
          ),
        )}
      </ol>,
    );

    blockIndex++;
    numberedItems = [];
  }

  function flushAllLists() {
    flushBulletList();
    flushNumberedList();
  }

  function flushCodeBlock() {
    if (!inCodeBlock) {
      return;
    }

    // Les fences mathematiques sont composees, jamais affichees en monospace.
    if (["latex", "tex", "math", "katex"].includes(codeLanguage.toLowerCase())) {
      blocks.push(<OriaMathBlock key={`latex-${blockIndex++}`} latex={codeLines.join("\n")} />);
      codeLines = [];
      codeLanguage = "";
      codeTitle = "";
      inCodeBlock = false;
      return;
    }

    const code = codeLines.join("\n");
    const title = codeFileName(codeLanguage, codeTitle);
    // Le rendu historique reste disponible en secours pour les anciens formats.
    const visual = ["oria-chart", "oria-stats", "oria-diagram", "oria-geometry"].includes(codeLanguage)
      ? oriaRenderVisualBlock(codeLanguage, code, language) : null;
    const codeFallback = <CodeBlockCard
      code={code}
      language={codeLanguage || "text"}
      title={title}
      uiLanguage={language}
      onExpand={onOpenCode || (() => undefined)}
    />;
    const fallback = visual ?? codeFallback;
    const advancedKinds = ["oria-chart", "oria-diagram", "oria-grid"];
    const coreKinds = ["oria-stats", "oria-geometry", "oria-callout", "oria-table"];
    // Un JSON mal formé reste visible sous forme de code au lieu d'une zone vide.
    const validVisualJson = (() => {
      if (![...advancedKinds, ...coreKinds, "oria-3d", "oria-map", "oria-sim"].includes(codeLanguage)) return false;
      try {
        const value: unknown = JSON.parse(code);
        return value !== null && typeof value === "object" && !Array.isArray(value);
      } catch { return false; }
    })();
    blocks.push(!validVisualJson
      ? <Fragment key={`code-${blockIndex}`}>{codeFallback}</Fragment>
      : advancedKinds.includes(codeLanguage)
        ? <OriaVisualAdvanced key={`advanced-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={fallback} />
        : coreKinds.includes(codeLanguage)
          ? <OriaVisualCore key={`core-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={fallback} />
          : codeLanguage === "oria-sim"
            ? <OriaSimulator key={`sim-${blockIndex}`} raw={code} language={language} fallback={codeFallback} />
          : codeLanguage === "oria-3d"
            ? <OriaVisual3D key={`3d-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={codeFallback} />
            : <OriaVisualMaps key={`map-${blockIndex}`} kind={codeLanguage} raw={code} language={language} fallback={codeFallback} />);

    blockIndex++;
    codeLines = [];
    codeLanguage = "";
    codeTitle = "";
    inCodeBlock = false;
  }

  lines.forEach(
    (line, index) => {
      if (consumedTableLines.has(index)) return;
      const trimmed =
        line.trim();

      // Continuer une equation multi-ligne sans toucher aux fences de code.
      if (mathMode) {
        const closeAt = line.indexOf(mathMode.ending);
        if (closeAt < 0) {
          mathMode.parts.push(line);
        } else {
          mathMode.parts.push(line.slice(0, closeAt) + (mathMode.ending.startsWith("\\end{") ? mathMode.ending : ""));
          blocks.push(<OriaMathBlock key={`math-${blockIndex++}`} latex={mathMode.parts.join("\n")} />);
          const after = line.slice(closeAt + mathMode.ending.length).trim();
          mathMode = null;
          if (after) paragraph.push(after);
        }
        return;
      }

      /*
       * BLOC DE CODE
       */

      if (
        trimmed.startsWith("```")
      ) {
        if (!inCodeBlock) {
          flushAllLists();
          flushParagraph();

          inCodeBlock = true;

          codeLanguage =
            trimmed
              .slice(3)
              .trim().split(/\s+/)[0];
          codeTitle = lastCodeHeading;
          return;
        }

        flushCodeBlock();
        return;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }

      // Les grandes formules peuvent etre ecrites sous $$...$$, \[...\]
      // ou directement dans un environnement LaTeX (\\begin{aligned}...).
      // Elles ne doivent PAS passer par le parser Markdown des paragraphes.
      const opening = trimmed.startsWith("$$") ? "$$" :
        trimmed.startsWith("\\[") ? "\\[" : null;
      const environment = !opening
        ? trimmed.match(/^\\begin\{(aligned|alignedat|align\*?|alignat\*?|gathered|gather\*?|equation\*?|split|multline\*?|cases|dcases|rcases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array)\}/)
        : null;
      if (opening || environment) {
        flushAllLists();
        flushParagraph();
        const ending = opening === "$$" ? "$$" : opening ? "\\]" : `\\end{${environment![1]}}`;
        const source = opening ? trimmed.slice(opening.length) : trimmed;
        const found = source.indexOf(ending);
        if (found >= 0) {
          const formula = (opening ? source.slice(0, found) : source.slice(0, found + ending.length));
          blocks.push(<OriaMathBlock key={`math-${blockIndex++}`} latex={formula} />);
          const after = source.slice(found + ending.length).trim();
          if (after) paragraph.push(after);
        } else {
          mathMode = { ending, parts: [source] };
        }
        return;
      }

      /*
       * TABLEAUX GFM : détection en streaming, sans casser les blocs de code.
       */
      if (trimmed.includes("|") && index + 1 < lines.length &&
          oriaIsTableDivider(lines[index + 1].trim())) {
        const headers = oriaTableCells(trimmed);
        const separators = oriaTableCells(lines[index + 1].trim());
        if (headers.length >= 2 && headers.length <= 16 &&
            headers.length === separators.length) {
          flushAllLists();
          flushParagraph();
          consumedTableLines.add(index + 1);
          const alignment = separators.map((separator): "left" | "center" | "right" =>
            separator.startsWith(":") && separator.endsWith(":") ? "center" :
              separator.endsWith(":") ? "right" : "left");
          const rows: string[][] = [];
          let cursor = index + 2;
          while (cursor < lines.length && rows.length < 200 &&
              lines[cursor].trim() !== "" && lines[cursor].includes("|")) {
            const cells = oriaTableCells(lines[cursor]);
            if (cells.length !== headers.length) break;
            rows.push(cells);
            consumedTableLines.add(cursor);
            cursor++;
          }
          blocks.push(<OriaDataTable key={`table-${blockIndex}`} headers={headers}
            rows={rows} alignment={alignment} language={language}/>);
          blockIndex++;
          return;
        }
      }

      /*
       * LIGNE VIDE
       */

      if (trimmed === "") {
        flushAllLists();
        flushParagraph();
        return;
      }

      /*
       * SÉPARATEUR
       */

      if (
        /^(-{3,}|\*{3,}|_{3,})$/.test(
          trimmed,
        )
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <hr
            key={`hr-${blockIndex}`}
            className="my-6 border-border"
          />,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H2
       */

      if (
        trimmed.startsWith("## ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h2
            key={`h2-${blockIndex}`}
            className="mb-3 mt-7 text-xl font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(3),
            )}
          </h2>,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H3
       */

      if (
        trimmed.startsWith("### ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h3
            key={`h3-${blockIndex}`}
            className="mb-2 mt-6 text-base font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(4),
            )}
          </h3>,
        );

        blockIndex++;
        return;
      }

      /*
       * TITRE H1
       */

      if (
        trimmed.startsWith("# ")
      ) {
        flushAllLists();
        flushParagraph();

        blocks.push(
          <h1
            key={`h1-${blockIndex}`}
            className="mb-4 mt-7 text-2xl font-semibold tracking-tight first:mt-0"
          >
            {renderInlineMarkdown(
              trimmed.slice(2),
            )}
          </h1>,
        );

        blockIndex++;
        return;
      }

      /*
       * LISTE À PUCES
       */

      const bulletMatch =
        trimmed.match(
          /^[-*•]\s+(.+)$/,
        );

      if (bulletMatch) {
        flushParagraph();
        flushNumberedList();

        bulletItems.push(
          bulletMatch[1],
        );

        return;
      }

      /*
       * LISTE NUMÉROTÉE
       */

      const numberedMatch =
        trimmed.match(
          /^\d+[.)]\s+(.+)$/,
        );

      if (numberedMatch) {
        flushParagraph();
        flushBulletList();

        numberedItems.push(
          numberedMatch[1],
        );

        return;
      }

      /*
       * Citations multiligne et encadrés [!NOTE], [!TIP], etc.
       */
      if (trimmed.startsWith(">")) {
        flushAllLists();
        flushParagraph();
        const quoteLines: string[] = [];
        let cursor = index;
        while (cursor < lines.length && lines[cursor].trimStart().startsWith(">")) {
          quoteLines.push(lines[cursor].trimStart().replace(/^>\s?/, ""));
          if (cursor !== index) consumedTableLines.add(cursor);
          cursor++;
        }
        const marker = quoteLines[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
        if (marker) {
          blocks.push(<OriaCallout key={`callout-${blockIndex}`} kind={marker[1].toUpperCase()}
            lines={quoteLines.slice(1).filter(Boolean)} language={language}/>);
        } else {
          blocks.push(<blockquote key={`quote-${blockIndex}`}
            className="mb-4 border-l-2 border-border-strong pl-4 text-muted-strong last:mb-0">
            {quoteLines.map((value, position) => <p key={position}>{renderInlineMarkdown(value)}</p>)}
          </blockquote>);
        }
        blockIndex++;
        return;
      }

      // Retient un titre de fichier éventuel pour le lecteur de code.
      if (/\.[a-z0-9]{1,8}(?:`|\*\*)?$/i.test(trimmed)) {
        lastCodeHeading = trimmed;
      }

      /*
       * PARAGRAPHE
       *
       * On conserve les phrases d'une même ligne logique
       * ensemble, puis on les espace lors du rendu.
       */

      flushAllLists();

      paragraph.push(
        trimmed,
      );
    },
  );

  /*
   * Fermeture des éventuels blocs restants.
   */

  if (inCodeBlock) {
    flushCodeBlock();
  }
  if (mathMode) {
    // Le stream peut couper au milieu de \end{aligned} ou \].
    // On affiche un etat neutre plutot qu'une formule corrompue.
    blocks.push(<div key={`math-pending-${blockIndex++}`} role="status"
      className="my-3 text-xs text-muted">Composition de la formule en cours…</div>);
  }

  flushAllLists();
  flushParagraph();
  addWebImages(Number.MAX_SAFE_INTEGER);

  /*
   * Si le modèle est encore en train de streamer et que le
   * contenu est vide, on évite un conteneur inutile.
   */

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="break-words text-[14px] leading-7">
      {blocks}
    </div>
  );
}


export function OriaRichMessage({content, language="fr", onOpenCode, webImages=[]}: {
  content:string; language?: OriaLanguage;
  onOpenCode?:(data:OriaCodePreviewData)=>void;
  webImages?:OriaWebIllustration[];
}) {
  const [preview,setPreview]=useState<OriaCodePreviewData|null>(null);
  const validImages=webImages.filter(item=>{
    try {
      const u=new URL(item.image_url), s=new URL(item.source_url);
      return u.protocol==="https:" && s.protocol==="https:" && !u.username && !s.username;
    } catch {return false;}
  }).slice(0,3);
  return <>
    <MarkdownMessage content={content} language={language}
      onOpenCode={onOpenCode ?? ((data)=>setPreview(data))} webImages={validImages}/>
    {preview && <CodePreviewModal preview={preview} language={language} onClose={()=>setPreview(null)}/>}
  </>;
}
