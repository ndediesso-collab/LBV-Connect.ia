"use client";

/**
 * ORIA Visual Engine / Web — graphiques, grilles éditables et diagrammes.
 *
 * Entrées strictement déclaratives. Aucun HTML, JavaScript, formatter ou
 * callback fourni par le modèle n'est exécuté.
 *
 * Formats : oria-chart, oria-grid, oria-diagram.
 * N'altère ni le lecteur de code du Chat, ni les événements de streaming.
 * Dépendances libres : echarts, ag-grid-community, ag-grid-react, @xyflow/react.
 */

import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type Language = "fr" | "en";
type JsonRecord = Record<string, unknown>;
type ChartKind = "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "radar" | "funnel" | "gauge" | "heatmap" | "treemap" | "sankey";
type Point = { label: string; value: number; x?: number };
type Series = { name: string; values: Array<number | null> };
type NormalizedChart = {
  kind: ChartKind;
  title: string;
  subtitle: string;
  categories: string[];
  points: Point[];
  series: Series[];
  xLabel: string;
  yLabel: string;
  unit: string;
  raw: JsonRecord;
};

const LIMITS = {
  raw: 120_000,
  chartRows: 240,
  chartSeries: 8,
  gridRows: 1_000,
  gridColumns: 24,
  flowNodes: 70,
  flowEdges: 130,
};
const PALETTE = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c"];
const CHART_KINDS = new Set<ChartKind>(["bar", "line", "area", "pie", "doughnut", "scatter", "radar", "funnel", "gauge", "heatmap", "treemap", "sankey"]);
const t = (lang: Language, fr: string, en: string) => lang === "fr" ? fr : en;
const record = (v: unknown): JsonRecord | null => v && typeof v === "object" && !Array.isArray(v) ? v as JsonRecord : null;
const label = (v: unknown, fallback = "", max = 100): string => {
  if (typeof v !== "string" && typeof v !== "number") return fallback;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s.slice(0, max) || fallback;
};
const finite = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 1e15 ? n : null;
};
const csvSafe = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  const s = label(v, "", 10_000);
  // Bloque l'interprétation des formules dans Excel / LibreOffice.
  return /^[\s]*[=+@\-\t\r]/.test(s) ? "'" + s : s;
};
const csvCell = (v: unknown) => `"${csvSafe(v).replace(/"/g, '""')}"`;

function downloadText(filename: string, value: string, mime: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob(["\uFEFF", value], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

function Panel({ title, subtitle, actions, children }: {
  title: string; subtitle?: string; actions?: ReactNode; children: ReactNode;
}) {
  return <section className="my-4 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-sm font-semibold sm:text-base">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </header>
    {children}
  </section>;
}

function Action({ children, onClick, title, disabled }: {
  children: ReactNode; onClick: () => void; title?: string; disabled?: boolean;
}) {
  return <button type="button" title={title} onClick={onClick} disabled={disabled}
    className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-surface-secondary disabled:opacity-40">
    {children}
  </button>;
}

function normalizeChart(data: JsonRecord): NormalizedChart | null {
  const kind = label(data.type ?? data.chartType).toLowerCase() as ChartKind;
  if (!CHART_KINDS.has(kind)) return null;
  const input = Array.isArray(data.data) ? data.data.slice(0, LIMITS.chartRows) : [];
  const rows = input.map(record).filter((r): r is JsonRecord => !!r);
  if (!rows.length) return null;
  const xKey = label(data.xKey, "label", 64);
  const declaredSeries = Array.isArray(data.series) ? data.series.slice(0, LIMITS.chartSeries).map(record).filter((s): s is JsonRecord => !!s) : [];
  const categories = rows.map((r, i) => label(r[xKey] ?? r.label ?? r.name ?? r.x, String(i + 1), 64));
  const series: Series[] = declaredSeries.length ? declaredSeries.map((s, i) => ({
    name: label(s.label ?? s.name, `Série ${i + 1}`, 60),
    values: rows.map(r => finite(r[label(s.dataKey, "value", 64)])),
  })) : [{ name: label(data.seriesLabel, "Valeur"), values: rows.map(r => finite(r.value ?? r.y)) }];
  if (!series.some(s => s.values.some(v => v !== null))) return null;
  const points = rows.map((r, i) => ({ label: categories[i], value: finite(r.value ?? r.y ?? series[0].values[i]) ?? 0,
    x: finite(r.x) ?? undefined }));
  return {
    kind,
    title: label(data.title, "Graphique", 160),
    subtitle: label(data.subtitle ?? data.caption, "", 260),
    categories, points, series,
    xLabel: label(data.xAxisLabel ?? data.xLabel, "", 100),
    yLabel: label(data.yAxisLabel ?? data.yLabel, "", 100),
    unit: label(data.unit ?? data.valueSuffix, "", 24),
    raw: data,
  };
}

function chartOptions(spec: NormalizedChart, language: Language, view: ChartKind): JsonRecord {
  const axisTooltip = { trigger: "axis", renderMode: "richText", confine: true, backgroundColor: "#fff", borderColor: "#d1d5db", textStyle: { color: "#111827" } };
  const common: JsonRecord = {
    color: PALETTE,
    animationDuration: 450,
    textStyle: { fontFamily: "inherit" },
    tooltip: axisTooltip,
    aria: { enabled: true },
    toolbox: { show: false },
  };
  if (view === "pie" || view === "doughnut" || view === "funnel") {
    const items = spec.points.filter(p => p.value >= 0);
    if (!items.some(p => p.value > 0)) return common;
    return { ...common, tooltip: { trigger: "item", renderMode: "richText", confine: true },
      legend: { type: "scroll", bottom: 0 },
      series: [{ name: spec.title, type: view === "funnel" ? "funnel" : "pie",
        radius: view === "doughnut" ? ["42%", "67%"] : view === "pie" ? "64%" : undefined,
        top: 10, bottom: view === "funnel" ? 30 : 45,
        label: { overflow: "truncate" },
        data: items.map(p => ({ name: p.label, value: p.value })) }],
    };
  }
  if (view === "gauge") {
    return { ...common, tooltip: { trigger: "item", renderMode: "richText" },
      series: [{ type: "gauge", progress: { show: true }, detail: { valueAnimation: true },
        min: 0, max: Math.max(100, spec.points[0]?.value || 100),
        data: [{ name: spec.points[0]?.label, value: spec.points[0]?.value ?? 0 }] }],
    };
  }
  if (view === "radar") {
    const max = Math.max(1, ...spec.series.flatMap(s => s.values.map(v => Math.max(0, v ?? 0))));
    return { ...common, legend: { bottom: 0 }, tooltip: { trigger: "item", renderMode: "richText" },
      radar: { indicator: spec.categories.slice(0, 20).map(name => ({ name, max: max * 1.1 })) },
      series: [{ type: "radar", data: spec.series.map(s => ({ name: s.name, value: s.values.slice(0, 20).map(v => v ?? 0) })) }],
    };
  }
  if (view === "treemap") {
    return { ...common, tooltip: { trigger: "item", renderMode: "richText" },
      series: [{ type: "treemap", roam: true, breadcrumb: { show: false },
        data: spec.points.filter(p => p.value > 0).map(p => ({ name: p.label, value: p.value })) }],
    };
  }
  if (view === "sankey") {
    const rawNodes = Array.isArray(spec.raw.nodes) ? spec.raw.nodes.slice(0, 60) : [];
    const rawLinks = Array.isArray(spec.raw.links) ? spec.raw.links.slice(0, 120) : [];
    const nodes = rawNodes.map(record).filter((n): n is JsonRecord => !!n).map(n => ({ name: label(n.name ?? n.id, "", 72) })).filter(n => n.name);
    const names = new Set(nodes.map(n => n.name));
    const links = rawLinks.map(record).filter((n): n is JsonRecord => !!n).map(n => ({
      source: label(n.source), target: label(n.target), value: finite(n.value) ?? 0,
    })).filter(l => names.has(l.source) && names.has(l.target) && l.value > 0);
    return { ...common, tooltip: { trigger: "item", renderMode: "richText" },
      series: [{ type: "sankey", data: nodes, links, emphasis: { focus: "adjacency" } }],
    };
  }
  if (view === "heatmap") {
    const matrix = spec.series.flatMap((s, y) => s.values.map((v, x) => v === null ? null : [x, y, v])).filter(Boolean);
    const nums = matrix.map(row => (row as number[])[2]);
    if (!nums.length) return common;
    return { ...common, grid: { top: 28, right: 26, left: 85, bottom: 80 },
      tooltip: { renderMode: "richText", position: "top", confine: true },
      xAxis: { type: "category", data: spec.categories, axisLabel: { rotate: spec.categories.length > 10 ? 35 : 0, hideOverlap: true } },
      yAxis: { type: "category", data: spec.series.map(s => s.name) },
      visualMap: { min: Math.min(...nums), max: Math.max(...nums), calculable: true, orient: "horizontal", left: "center", bottom: 0 },
      series: [{ type: "heatmap", data: matrix, progressive: 500 }],
    };
  }
  const scatter = view === "scatter";
  return { ...common,
    legend: spec.series.length > 1 ? { type: "scroll", top: 0 } : undefined,
    grid: { top: spec.series.length > 1 ? 48 : 26, right: 20, bottom: spec.categories.length > 12 ? 100 : 70, left: 58, containLabel: true },
    xAxis: scatter ? { type: "value", name: spec.xLabel } : { type: "category", data: spec.categories, name: spec.xLabel,
      axisLabel: { hideOverlap: true, rotate: spec.categories.length > 10 ? 30 : 0 } },
    yAxis: { type: "value", name: spec.yLabel, scale: true },
    dataZoom: spec.categories.length > 7 && !scatter ? [{ type: "inside" }, { type: "slider", height: 17, bottom: 15 }] : [],
    series: spec.series.map((s, idx) => ({
      name: s.name, type: scatter ? "scatter" : view === "bar" ? "bar" : "line",
      smooth: view === "line" || view === "area",
      areaStyle: view === "area" ? { opacity: 0.22 } : undefined,
      showSymbol: spec.categories.length <= 30,
      symbolSize: scatter ? 10 : 7,
      barMaxWidth: 52,
      progressive: 200,
      emphasis: { focus: "series" },
      data: scatter ? s.values.map((v, i) => v === null ? null : [spec.points[i]?.x ?? i, v]) : s.values,
      id: `series-${idx}`,
    })),
  };
}

function AdvancedChart({ data, language }: { data: JsonRecord; language: Language }) {
  const spec = useMemo(() => normalizeChart(data), [data]);
  const [view, setView] = useState<ChartKind>(() => spec?.kind ?? "bar");
  const [fullscreen, setFullscreen] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<{ dispose: () => void; resize: () => void; getDataURL: (v: any) => string } | null>(null);
  useEffect(() => { if (spec) setView(spec.kind); }, [spec?.kind]);
  const options = useMemo(() => spec ? chartOptions(spec, language, view) : null, [spec, language, view]);

  useEffect(() => {
    if (!host.current || !options) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    // ECharts n'entre dans le bundle que lorsque le visuel est réellement ouvert.
    void import("echarts").then(echarts => {
      if (cancelled || !host.current) return;
      const instance = echarts.init(host.current, undefined, { renderer: "canvas" });
      chart.current = instance;
     instance.setOption(options as EChartsOption);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(host.current);
      }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [options, fullscreen]);

  if (!spec) return null;
  const switchable = ["bar", "line", "area"].includes(spec.kind);
  const csv = [ ["Catégorie", ...spec.series.map(s => s.name)], ...spec.categories.map((c, i) => [c, ...spec.series.map(s => s.values[i] ?? "")]) ];
  const table = <div className="max-h-64 overflow-auto border-t border-border text-xs"><table className="w-full min-w-[300px] border-collapse">
    <thead><tr>{csv[0].map((v, i) => <th key={i} className="sticky top-0 border-b border-border bg-surface-secondary p-2 text-left">{v}</th>)}</tr></thead>
    <tbody>{csv.slice(1).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className="border-b border-border/60 p-2 tabular-nums">{v}</td>)}</tr>)}</tbody>
  </table></div>;
  return <Panel title={spec.title} subtitle={spec.subtitle} actions={<>
    {switchable ? <select aria-label={t(language,"Type de graphique","Chart type")} value={view} onChange={e => setView(e.target.value as ChartKind)}
      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs">
      <option value="bar">{t(language,"Barres","Bars")}</option><option value="line">{t(language,"Courbe","Line")}</option><option value="area">{t(language,"Aires","Area")}</option>
    </select> : null}
    <Action onClick={() => setShowTable(x => !x)}>{showTable ? t(language,"Masquer","Hide") : t(language,"Données","Data")}</Action>
    <Action onClick={() => downloadText("oria-donnees.csv", csv.map(row => row.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8")}>CSV</Action>
    <Action onClick={() => { const url = chart.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" }); if (!url) return;
      const a = document.createElement("a"); a.href = url; a.download = "oria-graphique.png"; a.click(); }}>PNG</Action>
    <Action onClick={() => setFullscreen(x => !x)}>{fullscreen ? t(language,"Réduire","Collapse") : t(language,"Agrandir","Expand")}</Action>
  </>}>
    <div className={fullscreen ? "fixed inset-3 z-[100] overflow-auto rounded-2xl border border-border bg-surface p-4 shadow-2xl sm:inset-8" : "p-2 sm:p-3"}>
      {fullscreen ? <div className="mb-2 flex justify-end"><Action onClick={() => setFullscreen(false)}>{t(language,"Fermer","Close")}</Action></div> : null}
      {error ? <p role="status" className="p-4 text-sm text-muted">{t(language,"Graphique indisponible. Les données sont accessibles ci-dessous.","Chart unavailable. Data is available below.")}</p> : null}
      <div ref={host} role="img" aria-label={spec.title} className="w-full" style={{ height: fullscreen ? "min(70vh, 760px)" : 350 }}/>
    </div>
    {showTable || error ? table : null}
  </Panel>;
}

type GridRow = Record<string, string | number | null>;
type GridSpec = { title: string; columns: Array<{ field: string; title: string }>; rows: GridRow[]; editable: boolean };

function normalizeGrid(data: JsonRecord): GridSpec | null {
  const headers = Array.isArray(data.headers) ? data.headers.slice(0, LIMITS.gridColumns).map((v, i) => label(v, `Colonne ${i + 1}`, 100)) : [];
  const sourceRows = Array.isArray(data.rows) ? data.rows.slice(0, LIMITS.gridRows) : [];
  if (!sourceRows.length) return null;
  if (Array.isArray(sourceRows[0])) {
    if (!headers.length) return null;
    return { title: label(data.title, "Tableau éditable"), editable: data.editable !== false,
      columns: headers.map((title, i) => ({ field: `col_${i}`, title })),
      rows: sourceRows.map((row, rowIndex) => {
        const cells = Array.isArray(row) ? row : [];
        return { __oriaRowId: rowIndex, ...Object.fromEntries(headers.map((_, i) => [`col_${i}`, scalarCell(cells[i])])) } as GridRow;
      }),
    };
  }
  const objs = sourceRows.map(record).filter((r): r is JsonRecord => !!r);
  if (!objs.length) return null;
  const fields = headers.length ? headers : Object.keys(objs[0]).slice(0, LIMITS.gridColumns).filter(s => s !== "__proto__" && s !== "constructor" && s !== "prototype");
  return { title: label(data.title, "Tableau éditable"), editable: data.editable !== false,
    columns: fields.map((field, i) => ({ field: `col_${i}`, title: field })),
    rows: objs.map((r, rowIndex) => ({ __oriaRowId: rowIndex, ...Object.fromEntries(fields.map((field, i) => [`col_${i}`, scalarCell(r[field])])) }) as GridRow),
  };
}
function scalarCell(v: unknown): string | number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return label(v, "", 5000);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}
function AdvancedGrid({ data, language }: { data: JsonRecord; language: Language }) {
  const spec = useMemo(() => normalizeGrid(data), [data]);
  const [rows, setRows] = useState<GridRow[]>(spec?.rows ?? []);
  const [search, setSearch] = useState("");
  const [changed, setChanged] = useState(false);
  useEffect(() => { setRows(spec?.rows ?? []); setChanged(false); }, [spec]);
  const columns = useMemo<ColDef<GridRow>[]>(() => spec?.columns.map(c => ({
    field: c.field, headerName: c.title, editable: spec.editable,
    sortable: true, filter: true, resizable: true, minWidth: 130, flex: 1,
  })) ?? [], [spec]);
  if (!spec) return null;
  const exportCsv = () => {
    const result = [spec.columns.map(c => c.title), ...rows.map(r => spec.columns.map(c => r[c.field] ?? ""))];
    downloadText("oria-tableau.csv", result.map(r => r.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
  };
  return <Panel title={spec.title} subtitle={t(language,"Cellules modifiables · tri · recherche","Editable cells · sorting · search")} actions={<>
    <Action onClick={() => { setRows(spec.rows.map(row => ({ ...row }))); setChanged(false); }}>{t(language,"Réinitialiser","Reset")}</Action>
    <Action onClick={exportCsv}>CSV</Action>
  </>}>
    <div className="px-3 pt-3"><input value={search} onChange={e => setSearch(e.target.value)} aria-label={t(language,"Rechercher dans le tableau","Search table")}
      placeholder={t(language,"Rechercher dans les données…","Search data…")}
      className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm"/></div>
    <div className="p-3" style={{height: Math.min(540, Math.max(190, rows.length * 42 + 75))}}>
        <AgGridReact<GridRow> theme={themeQuartz} modules={[AllCommunityModule]}
            rowData={rows} columnDefs={columns} animateRows={false}
            getRowId={params => String(params.data.__oriaRowId)}
            defaultColDef={{ sortable: true, filter: true, resizable: true }}
            quickFilterText={search}
            onCellValueChanged={e => {
            if (!e.data || e.rowIndex == null || !e.colDef.field) return;
            const field = e.colDef.field;
            const nextValue = scalarCell(e.newValue);
            setRows(prev => prev.map(r => r.__oriaRowId === e.data?.__oriaRowId ? { ...r, [field]: nextValue } : r));
            setChanged(true);
            }}
        />
    </div>
    <p className="px-3 pb-3 text-xs text-muted">{rows.length} {t(language,"lignes","rows")}{changed ? ` · ${t(language,"Modifications locales non enregistrées sur le serveur","Local changes not saved to server")}` : ""}</p>
  </Panel>;
}

type FlowSpec = { title: string; nodes: Node[]; edges: Edge[] };
function normalizeFlow(data: JsonRecord): FlowSpec | null {
  if (!Array.isArray(data.nodes)) return null;
  const raw = data.nodes.slice(0, LIMITS.flowNodes).map(record).filter((v): v is JsonRecord => !!v);
  const seen = new Set<string>();
  const nodes: Node[] = raw.flatMap((n, i) => {
    const id = label(n.id, "", 64);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const suppliedX = finite(record(n.position)?.x ?? n.x);
    const suppliedY = finite(record(n.position)?.y ?? n.y);
    return [{ id, type: "default", data: { label: label(n.label ?? n.name, `Étape ${i+1}`, 150) },
      position: { x: suppliedX === null ? (i%3)*240 : Math.max(-5000, Math.min(5000, suppliedX)),
        y: suppliedY === null ? Math.floor(i/3)*130 : Math.max(-5000, Math.min(5000, suppliedY)) },
      style: { borderRadius: 12, border: "1px solid #94a3b8", background: "#ffffff", color: "#1f2937", padding: 9, width: 190, fontSize: 13 },
    }];
  });
  if (!nodes.length) return null;
  const inputEdges = Array.isArray(data.edges) ? data.edges.slice(0, LIMITS.flowEdges) : [];
  const edges: Edge[] = inputEdges.map(record).filter((v): v is JsonRecord => !!v).flatMap((e, i) => {
    const source = label(e.from ?? e.source, "", 64), target = label(e.to ?? e.target, "", 64);
    if (!seen.has(source) || !seen.has(target) || source === target) return [];
    return [{ id: `edge-${i}-${source}-${target}`, source, target,
      label: label(e.label, "", 70), type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#64748b", strokeWidth: 1.5 } }];
  });
  return { title: label(data.title, "Diagramme interactif"), nodes, edges };
}
function AdvancedFlow({ data, language }: { data: JsonRecord; language: Language }) {
  const spec = useMemo(() => normalizeFlow(data), [data]);
  const [fullscreen, setFullscreen] = useState(false);
  if (!spec) return null;
  return <Panel title={spec.title} subtitle={t(language,"Déplace les nœuds · zoome · explore","Drag nodes · zoom · explore")}
    actions={<Action onClick={() => setFullscreen(v => !v)}>{fullscreen ? t(language,"Réduire","Collapse") : t(language,"Agrandir","Expand")}</Action>}>
    <div className={fullscreen ? "fixed inset-3 z-[100] rounded-2xl border border-border bg-surface p-3 shadow-2xl" : "p-2 sm:p-3"}>
      {fullscreen ? <div className="mb-2 flex justify-end"><Action onClick={() => setFullscreen(false)}>{t(language,"Fermer","Close")}</Action></div> : null}
      <div className="w-full overflow-hidden rounded-lg bg-slate-50" style={{height: fullscreen ? "85vh" : 370}}>
        <ReactFlow key={JSON.stringify(spec.nodes.map(n => [n.id, n.position, n.data.label]))} defaultNodes={spec.nodes} defaultEdges={spec.edges}
          fitView fitViewOptions={{padding: .25}} nodesConnectable={false} elementsSelectable={true}>
          <Background gap={20} size={1}/><Controls showInteractive={false}/><MiniMap pannable zoomable/>
        </ReactFlow>
      </div>
    </div>
  </Panel>;
}

/**
 * Un seul point d'entrée pour trois familles premium.
 * JSON incomplet / invalide => null (le chat garde son moteur de secours).
 */
export default function OriaVisualAdvanced({ kind, raw, language = "fr", fallback = null }: {
  kind: string; raw: string; language?: Language; fallback?: ReactNode;
}) {
  const data = useMemo(() => {
    if (raw.length > LIMITS.raw || !["oria-chart", "oria-grid", "oria-diagram"].includes(kind)) return null;
    try { return record(JSON.parse(raw)); } catch { return null; }
  }, [kind, raw]);
  if (!data) return <>{fallback}</>;
  if (kind === "oria-chart" && normalizeChart(data)) return <AdvancedChart data={data} language={language}/>;
  if (kind === "oria-grid" && normalizeGrid(data)) return <AdvancedGrid data={data} language={language}/>;
  if (kind === "oria-diagram" && normalizeFlow(data)) return <AdvancedFlow data={data} language={language}/>;
  return <>{fallback}</>;
}
    