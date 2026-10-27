"use client";

/**
 * ORIA Maths Web — composition scientifique par KaTeX.
 * Ne modifie ni le JSON visuel ORIA, ni les messages, ni le backend.
 * Installer dans : src/components/oria-math/OriaMathRenderer.tsx
 * Prerequis : npm install katex && npm install -D @types/katex
 */
import { useEffect, useMemo, useState } from "react";
import * as katex from "katex";
import "katex/dist/katex.min.css";

type MathProps = { latex: string };
type MathResult = { html: string; error: string | null };

function compose(latex: string, displayMode: boolean): MathResult {
  if (latex.length > 40000) return { html: "", error: "Expression trop longue pour le moteur mathématique." };
  try {
    // KaTeX genere lui-meme du HTML echappe, avec la sortie MathML accessible.
    // Les commandes HTML non fiables sont bloquees (trust:false).
    return {
      html: katex.renderToString(latex, {
        displayMode,
        output: "htmlAndMathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 12,
      }),
      error: null,
    };
  } catch (error) {
    return {
      html: "",
      error: error instanceof Error ? error.message.slice(0, 240) : "Erreur de composition mathématique",
    };
  }
}

export function OriaMathInline({ latex }: MathProps) {
  const result = useMemo(() => compose(latex.trim(), false), [latex]);
  if (result.error) {
    return <code title={result.error} className="rounded bg-surface-secondary px-1 text-[.95em]" aria-label="Formule non reconnue">{latex}</code>;
  }
  return <span className="oria-math-inline align-baseline" role="math" aria-label={latex}
    dangerouslySetInnerHTML={{ __html: result.html }} />;
}

export function OriaMathBlock({ latex }: MathProps) {
  const result = useMemo(() => compose(latex.trim(), true), [latex]);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  async function copyLatex() {
    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  }

  // Jamais de rendu HTML provenant directement de l'IA ; seulement de KaTeX.
  function formula(large = false) {
    if (result.error) {
      return <div className="text-sm text-muted">
        <span className="font-medium">Formule non reconnue : </span>
        <span>{result.error}</span>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{latex}</pre>
      </div>;
    }
    return <div className="min-w-max py-2 text-center" role="math" aria-label={latex}
      style={{ fontSize: large ? `${zoom}%` : undefined }}
      dangerouslySetInnerHTML={{ __html: result.html }} />;
  }

  return <>
    <figure className="group relative my-4 min-w-0 max-w-full rounded-xl border border-border/70 bg-surface-secondary/40">
      <div className="max-w-full overflow-x-auto overscroll-x-contain px-3 py-4 sm:px-5"
        tabIndex={0} aria-label="Formule mathématique — défilement horizontal possible">
        {formula()}
      </div>
      <figcaption className="flex items-center justify-end gap-1 border-t border-border/50 px-2 py-1.5 text-xs">
        <button type="button" onClick={copyLatex}
          className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-tertiary focus-visible:outline focus-visible:outline-2"
          aria-label="Copier la formule LaTeX">{copied ? "Copié" : "Copier LaTeX"}</button>
        <button type="button" onClick={() => { setExpanded(true); setZoom(100); }}
          className="rounded-md px-2.5 py-1.5 font-medium text-muted-strong hover:bg-surface-tertiary focus-visible:outline focus-visible:outline-2"
          aria-label="Agrandir la formule">Agrandir</button>
      </figcaption>
    </figure>
    {expanded ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-6"
      role="dialog" aria-modal="true" aria-label="Lecteur mathématique agrandi"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
      <section className="flex max-h-[94dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-foreground shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <strong className="text-sm font-semibold">Formule mathématique</strong>
          <div className="flex items-center gap-2 text-sm">
            <button type="button" onClick={() => setZoom((n) => Math.max(60, n - 20))}
              className="rounded-md border border-border px-3 py-1.5" aria-label="Dézoomer">−</button>
            <span className="min-w-12 text-center text-xs tabular-nums">{zoom} %</span>
            <button type="button" onClick={() => setZoom((n) => Math.min(240, n + 20))}
              className="rounded-md border border-border px-3 py-1.5" aria-label="Zoomer">+</button>
            <button type="button" onClick={copyLatex}
              className="rounded-md border border-border px-3 py-1.5">{copied ? "Copié" : "Copier"}</button>
            <button type="button" onClick={() => setExpanded(false)}
              className="rounded-md border border-border px-3 py-1.5" aria-label="Fermer le lecteur">Fermer</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-8" tabIndex={0}>{formula(true)}</div>
      </section>
    </div> : null}
  </>;
}
