"use client";

/**
 * ORIA Visual Core (Web) — affichage sûr des statistiques, tableaux,
 * encadrés et figures scientifiques 2D. Aucun code reçu de l'IA n'est exécuté.
 * Compatible avec les anciens blocs oria-stats / oria-geometry.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";

type Lang = "fr" | "en";
type Dict = Record<string, unknown>;
type VisualKind = "oria-stats" | "oria-geometry" | "oria-callout" | "oria-table";
const COLORS = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c"] as const;
const obj = (v: unknown): Dict | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Dict : null;
const text = (v: unknown, fallback = "", max = 160) =>
  typeof v === "string" || typeof v === "number" ? String(v).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : fallback;
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6 ? v : null;
const tr = (lang: Lang, fr: string, en: string) => lang === "fr" ? fr : en;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function color(v: unknown) { return COLORS[clamp(Math.floor(num(v) ?? 0), 0, COLORS.length - 1)]; }
function Panel({ title, children, actions, caption }: { title: string; children: ReactNode; actions?: ReactNode; caption?: string }) {
  return <section className="my-4 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
      <h3 className="min-w-0 break-words text-sm font-semibold sm:text-base">{title}</h3>
      {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
    </div>
    {children}
    {caption && <p className="border-t border-border px-4 py-2 text-xs text-muted">{caption}</p>}
  </section>;
}
function Button({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return <button type="button" title={title} onClick={onClick} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-surface-secondary">{children}</button>;
}
function Stats({ data, lang }: { data: Dict; lang: Lang }) {
  const items = Array.isArray(data.items) ? data.items.slice(0, 16).map(obj).filter((v): v is Dict => !!v) : [];
  if (!items.length) return null;
  return <Panel title={text(data.title, tr(lang, "Statistiques", "Statistics"))}>
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-4">
      {items.map((item, i) => <div key={i} className="min-w-0 rounded-xl border border-border bg-surface-secondary/40 p-3">
        <p className="break-words text-xs text-muted">{text(item.label, "—", 90)}</p>
        <p className="mt-1 break-words text-xl font-semibold tabular-nums">{text(item.value, "—", 90)}</p>
        {!!item.detail && <p className="mt-1 break-words text-xs text-muted">{text(item.detail, "", 160)}</p>}
      </div>)}
    </div>
  </Panel>;
}
function SimpleTable({ data, lang }: { data: Dict; lang: Lang }) {
  const headers = Array.isArray(data.headers) ? data.headers.slice(0, 24).map(v => text(v, "—", 100)) : [];
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 1000).filter(Array.isArray).map(r => r.slice(0, headers.length).map((c: unknown) => text(c, "", 1000))) : [];
  if (!headers.length || !rows.length) return null;
  const tsv = [headers, ...rows].map(row => row.map(cell => cell.replace(/[\t\r\n]/g, " ")).join("\t")).join("\n");
  return <Panel title={text(data.title, tr(lang, "Tableau", "Table"))}
    actions={<Button onClick={() => { if (typeof navigator !== "undefined") void navigator.clipboard?.writeText(tsv).catch(() => undefined); }}>
      {tr(lang, "Copier", "Copy")}
    </Button>}>
    <div className="max-h-[540px] overflow-auto" tabIndex={0} role="region" aria-label={tr(lang, "Tableau défilable", "Scrollable table")}>
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 bg-surface-secondary"><tr>{headers.map((h, i) => <th key={i} scope="col" className="border-b border-border px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="even:bg-surface-secondary/40">{headers.map((_, j) => <td key={j} className="max-w-[480px] border-b border-border/50 px-3 py-2 align-top">{r[j] ?? ""}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </Panel>;
}
function Callout({ data, lang }: { data: Dict; lang: Lang }) {
  const variant = text(data.variant ?? data.level ?? data.type, "note", 24).toLowerCase();
  const colors: Record<string, string> = {
    note: "border-sky-500", tip: "border-emerald-500", success: "border-emerald-500", warning: "border-amber-500",
    important: "border-violet-500", error: "border-red-500", caution: "border-red-500",
  };
  return <aside className={`my-4 rounded-xl border-l-4 ${colors[variant] ?? colors.note} bg-surface-secondary/60 p-4`}>
    <strong className="block text-sm">{text(data.title, tr(lang, "Information", "Information"))}</strong>
    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{text(data.content ?? data.text ?? data.message, "", 5000)}</p>
  </aside>;
}
function GeometryShape({ item, index }: { item: Dict; index: number }): ReactNode {
  const type = text(item.type, "", 32).toLowerCase();
  const stroke = color(item.colorIndex);
  const fill = item.fill === true ? stroke : "none";
  const thickness = clamp(num(item.strokeWidth) ?? 2.5, .5, 10);
  const line = { stroke, strokeWidth: thickness, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "line" || type === "arrow") {
    const x1 = num(item.x1), y1 = num(item.y1), x2 = num(item.x2), y2 = num(item.y2);
    if ([x1, y1, x2, y2].some(v => v === null)) return null;
    return <line key={index} {...line} x1={x1!} y1={y1!} x2={x2!} y2={y2!} markerEnd={type === "arrow" ? "url(#oria-core-arrow)" : undefined}/>;
  }
  if (type === "circle" || type === "ellipse") {
    const cx = num(item.cx), cy = num(item.cy), rx = num(item.rx ?? item.r), ry = num(item.ry ?? item.r);
    if ([cx, cy, rx, ry].some(v => v === null) || rx! <= 0 || ry! <= 0) return null;
    return <ellipse key={index} {...line} cx={cx!} cy={cy!} rx={rx!} ry={ry!} fill={fill} fillOpacity={.12}/>;
  }
  if (type === "rect" || type === "rectangle") {
    const x = num(item.x), y = num(item.y), width = num(item.width), height = num(item.height);
    if ([x, y, width, height].some(v => v === null) || width! <= 0 || height! <= 0) return null;
    return <rect key={index} {...line} x={x!} y={y!} width={width!} height={height!} rx={clamp(num(item.rx) ?? 0, 0, 60)} fill={fill} fillOpacity={.12}/>;
  }
  if ((type === "polygon" || type === "polyline") && Array.isArray(item.points)) {
    const points = item.points.slice(0, 150).filter(v => Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null) as number[][];
    if (points.length < (type === "polygon" ? 3 : 2)) return null;
    return type === "polygon"
      ? <polygon key={index} {...line} points={points.map(p => p.join(",")).join(" ")} fill={fill === "none" ? stroke : fill} fillOpacity={fill === "none" ? .08 : .15}/>
      : <polyline key={index} {...line} points={points.map(p => p.join(",")).join(" ")} fill="none"/>;
  }
  if (type === "point" || type === "text") {
    const x = num(item.x), y = num(item.y);
    if (x === null || y === null) return null;
    return <g key={index}>
      {type === "point" && <circle cx={x} cy={y} r={clamp(num(item.r) ?? 4, 2, 12)} fill={stroke}/>}
      <text x={x + (type === "point" ? 9 : 0)} y={y - (type === "point" ? 8 : 0)} fill="currentColor" fontSize={clamp(num(item.fontSize) ?? 14, 8, 28)}>{text(item.label ?? item.text, "", 100)}</text>
    </g>;
  }
  return null;
}
function Geometry({ data, lang }: { data: Dict; lang: Lang }) {
  const width = clamp(num(data.width) ?? 600, 100, 1800);
  const height = clamp(num(data.height) ?? 360, 100, 1200);
  const elements = Array.isArray(data.elements) ? data.elements.slice(0, 250).map(obj).filter((v): v is Dict => !!v) : [];
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  if (!elements.length) return null;
  const downloadSvg = () => {
    const original = svgRef.current;
    if (!original || typeof document === "undefined") return;
    const clone = original.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
    clone.removeAttribute("style"); clone.removeAttribute("class");
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "oria-figure.svg"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return <Panel title={text(data.title, tr(lang, "Figure géométrique", "Geometry"))} caption={text(data.caption, "", 300)} actions={<>
    <Button onClick={() => setZoom(z => clamp(Math.round((z - .25) * 100) / 100, .5, 3))}>−</Button>
    <Button onClick={() => setZoom(1)}>{Math.round(zoom * 100)} %</Button>
    <Button onClick={() => setZoom(z => clamp(Math.round((z + .25) * 100) / 100, .5, 3))}>+</Button>
    <Button onClick={downloadSvg}>SVG</Button>
  </>}>
    <div className="overflow-auto p-3" role="region" aria-label={tr(lang, "Figure défilable", "Scrollable figure")} tabIndex={0}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={text(data.title, "Figure")} className="max-w-none rounded-lg bg-white text-slate-800"
        style={{ width: Math.max(320, Math.round(width * zoom)), height: "auto" }}>
        <defs><marker id="oria-core-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8" fill="#475569"/></marker></defs>
        {elements.map((item, i) => GeometryShape({ item, index: i }))}
      </svg>
    </div>
  </Panel>;
}
/** Used only after validation. Invalid model output yields fallback, never executable markup. */
export default function OriaVisualCore({ kind, raw, language = "fr", fallback = null }: {
  kind: string; raw: string; language?: Lang; fallback?: ReactNode;
}) {
  const data = useMemo(() => {
    if (raw.length > 160_000 || !(["oria-stats", "oria-geometry", "oria-callout", "oria-table"] as string[]).includes(kind)) return null;
    try { return obj(JSON.parse(raw)); } catch { return null; }
  }, [kind, raw]);
  if (!data) return <>{fallback}</>;
  if (kind === "oria-stats") return <Stats data={data} lang={language}/>;
  if (kind === "oria-geometry") return <Geometry data={data} lang={language}/>;
  if (kind === "oria-callout") return <Callout data={data} lang={language}/>;
  if (kind === "oria-table") return <SimpleTable data={data} lang={language}/>;
  return <>{fallback}</>;
}
