"use client";

/**
 * ORIA Maps (Web) — carte interactive, marqueurs, zones, segments, navigation.
 * Cartographie libre via MapLibre GL JS. Aucun SDK propriétaire.
 * Configuration production requise : NEXT_PUBLIC_ORIA_MAP_STYLE_URL
 * La carte de démonstration MapLibre ne remplace pas un fournisseur de tuiles
 * de production ; celui-ci peut avoir des coûts et des conditions spécifiques.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type * as MapLibre from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";

type Lang = "fr" | "en";
type Dict = Record<string, unknown>;
type Coordinates = [number, number];
type Marker = { id: string; name: string; details: string; point: Coordinates };
type Area = { id: string; name: string; points: Coordinates[] };
type MapPayload = {
  title: string; markers: Marker[]; line: Coordinates[]; areas: Area[];
  center: Coordinates; zoom: number; caption: string;
};
const rec = (v: unknown): Dict | null => v && typeof v === "object" && !Array.isArray(v) ? v as Dict : null;
const txt = (v: unknown, fb = "", max = 160) => typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : fb;
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function point(v: unknown): Coordinates | null {
  if (Array.isArray(v) && v.length >= 2) {
    const lng = finite(v[0]), lat = finite(v[1]);
    if (lng !== null && lat !== null && lng >= -180 && lng <= 180 && lat >= -85 && lat <= 85) return [lng, lat];
  }
  const o = rec(v);
  if (!o) return null;
  const lng = finite(o.lng ?? o.lon ?? o.longitude), lat = finite(o.lat ?? o.latitude);
  return lng !== null && lat !== null && lng >= -180 && lng <= 180 && lat >= -85 && lat <= 85 ? [lng, lat] : null;
}
function polygonPoints(v: unknown) {
  return Array.isArray(v) ? v.slice(0, 200).map(point).filter((p): p is Coordinates => !!p) : [];
}
function normalize(raw: string): MapPayload | null {
  if (raw.length > 120_000) return null;
  let data: Dict | null;
  try { data = rec(JSON.parse(raw)); } catch { return null; }
  if (!data) return null;
  const inputMarkers = Array.isArray(data.points) ? data.points : Array.isArray(data.markers) ? data.markers : [];
  const markers: Marker[] = inputMarkers.slice(0, 100).flatMap((v, i) => {
    const o = rec(v); if (!o) return [];
    const position = point(o.position ?? o.coordinates ?? o);
    if (!position) return [];
    return [{ id: `p${i}`, name: txt(o.name ?? o.label ?? o.title, `Point ${i + 1}`, 100), details: txt(o.description ?? o.details, "", 300), point: position }];
  });
  // Lines merely connect provided coordinates; there is no routing calculation.
  const line = polygonPoints(data.line ?? data.route ?? data.path);
  const rawAreas = Array.isArray(data.areas) ? data.areas : [];
  const areas = rawAreas.slice(0, 20).flatMap((v, i) => {
    const o = rec(v); if (!o) return [];
    const pts = polygonPoints(o.coordinates ?? o.points);
    return pts.length >= 3 ? [{ id: `area${i}`, name: txt(o.name, `Zone ${i + 1}`), points: pts }] : [];
  });
  const center = point(data.center) ?? markers[0]?.point ?? line[0] ?? areas[0]?.points[0];
  if (!center) return null;
  return { title: txt(data.title, "Carte interactive"), markers, line, areas, center,
    zoom: clamp(finite(data.zoom) ?? 10, 1, 19), caption: txt(data.caption, "", 400) };
}
function asGeoJSON(spec: MapPayload): FeatureCollection {
  const features: Feature[] = [];
  if (spec.line.length >= 2) {
    features.push({ type: "Feature", properties: { type: "line" }, geometry: { type: "LineString", coordinates: spec.line } });
  }
  for (const area of spec.areas) {
    features.push({ type: "Feature", properties: { type: "area", name: area.name }, geometry: { type: "Polygon", coordinates: [[...area.points, area.points[0]]] } });
  }
  return { type: "FeatureCollection", features };
}
export default function OriaVisualMaps({ kind, raw, language = "fr", fallback = null }: {
  kind: string; raw: string; language?: Lang; fallback?: ReactNode;
}) {
  const spec = useMemo(() => kind === "oria-map" ? normalize(raw) : null, [kind, raw]);
  const host = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<MapLibre.Map | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const mapStyle = process.env.NEXT_PUBLIC_ORIA_MAP_STYLE_URL || "https://demotiles.maplibre.org/style.json";
  useEffect(() => {
    if (!spec || !host.current) return;
    const element = host.current;
    let cancelled = false, map: MapLibre.Map | null = null, observer: ResizeObserver | null = null;
    const markers: MapLibre.Marker[] = [];
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled) return;
      const createdMap = new maplibre.Map({ container: element, style: mapStyle, center: spec.center, zoom: spec.zoom,
        attributionControl: false, maxZoom: 19 });
      map = createdMap;
      mapInstance.current = createdMap;
      createdMap.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
      createdMap.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
      createdMap.on("error", (event) => { if (!cancelled && event.error) setError(language === "fr" ? "Impossible de charger certaines données de carte." : "Unable to load some map data."); });
      createdMap.on("load", () => {
        if (cancelled) return;
        const geojson = asGeoJSON(spec);
        if (geojson.features.length) {
          createdMap.addSource("oria-shapes", { type: "geojson", data: geojson });
          if (spec.areas.length) createdMap.addLayer({ id: "oria-areas", type: "fill", source: "oria-shapes",
            filter: ["==", ["get", "type"], "area"], paint: { "fill-color": "#0d9488", "fill-opacity": .20 } });
          if (spec.areas.length) createdMap.addLayer({ id: "oria-area-borders", type: "line", source: "oria-shapes",
            filter: ["==", ["get", "type"], "area"], paint: { "line-color": "#0d9488", "line-width": 2 } });
          if (spec.line.length >= 2) createdMap.addLayer({ id: "oria-line", type: "line", source: "oria-shapes",
            filter: ["==", ["get", "type"], "line"], paint: { "line-color": "#2563eb", "line-width": 4 } });
        }
        for (const item of spec.markers) {
          const popup = new maplibre.Popup({ offset: 18 }).setText(item.details ? `${item.name} — ${item.details}` : item.name);
          markers.push(new maplibre.Marker({ color: "#0d9488" }).setLngLat(item.point).setPopup(popup).addTo(createdMap));
        }
        const all: Coordinates[] = [...spec.markers.map(m => m.point), ...spec.line, ...spec.areas.flatMap(a => a.points)];
        if (all.length > 1) {
          const bounds = new maplibre.LngLatBounds(all[0], all[0]);
          for (const p of all.slice(1)) bounds.extend(p);
          createdMap.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
        }
      });
      if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(() => map?.resize()); observer.observe(element); }
    }).catch(() => { if (!cancelled) setError(language === "fr" ? "Le moteur cartographique est indisponible." : "Map engine unavailable."); });
    return () => { cancelled = true; observer?.disconnect(); for (const marker of markers) marker.remove(); map?.remove(); mapInstance.current = null; };
  }, [spec, mapStyle, language]);
  if (!spec) return <>{fallback}</>;
  return <section className="my-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-label={spec.title}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
      <h3 className="text-sm font-semibold">{spec.title}</h3>
      <button type="button" onClick={() => mapInstance.current?.flyTo({ center: spec.center, zoom: spec.zoom })}
        className="rounded-lg border border-border px-3 py-1.5 text-xs">{language === "fr" ? "Recentrer" : "Recenter"}</button>
    </div>
    {error && <p className="px-3 pt-2 text-xs text-amber-700" role="status">{error}</p>}
    <div ref={host} className="w-full bg-slate-100" style={{ height: "min(62vh, 470px)", minHeight: 300 }}/>
    {spec.markers.length > 0 && <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto p-2">
      {spec.markers.map(item => <button key={item.id} type="button" onClick={() => {
        setSelected(item.id); mapInstance.current?.flyTo({ center: item.point, zoom: Math.max(12, spec.zoom) });
      }} className={`rounded-full border px-2.5 py-1 text-xs ${selected === item.id ? "border-teal-600 bg-teal-50 text-teal-900" : "border-border"}`}>{item.name}</button>)}
    </div>}
    <p className="border-t border-border px-3 py-2 text-xs text-muted">
      {spec.caption || (language === "fr" ? "Déplace la carte, zoome ou sélectionne un point." : "Pan the map, zoom or select a location.")}
      {!process.env.NEXT_PUBLIC_ORIA_MAP_STYLE_URL && <span className="block">{language === "fr" ? "Fond MapLibre de démonstration : configurer une source de tuiles autorisée avant la production." : "MapLibre demo tiles: configure a licensed production tile source before launch."}</span>}
      {spec.line.length >= 2 && <span className="block">{language === "fr" ? "Le tracé relie des coordonnées fournies ; ce n'est pas un itinéraire calculé." : "The line connects provided coordinates; it is not a calculated route."}</span>}
    </p>
  </section>;
}
