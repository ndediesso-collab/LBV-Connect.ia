"use client";

/**
 * ORIA 3D (Web) — scènes déclaratives, primitives et surfaces scientifiques.
 * Dépendance libre à installer ultérieurement : three (+ @types/three).
 * Aucun JavaScript, shader ou expression fourni par l'IA n'est exécuté.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as THREE from "three";

type Dict = Record<string, unknown>;
type Lang = "fr" | "en";
type ThreePayload = { title: string; caption: string; objects: Dict[]; surface: Dict | null; axes: boolean; spin: boolean };
const PALETTE = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c"];
const rec = (v: unknown): Dict | null => v && typeof v === "object" && !Array.isArray(v) ? v as Dict : null;
const str = (v: unknown, fb = "", length = 140) => typeof v === "string" || typeof v === "number" ? String(v).slice(0, length) : fb;
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100000 ? v : null;
const bound = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const point3 = (value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] => {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return [0, 1, 2].map(i => bound(numeric(value[i]) ?? fallback[i], -100, 100)) as [number, number, number];
};
function parsePayload(raw: string): ThreePayload | null {
  if (raw.length > 100_000) return null;
  let o: Dict | null;
  try { o = rec(JSON.parse(raw)); } catch { return null; }
  if (!o) return null;
  const objects = Array.isArray(o.objects) ? o.objects.slice(0, 120).map(rec).filter((v): v is Dict => !!v) : [];
  const surface = rec(o.surface);
  if (!objects.length && !surface) return null;
  return { title: str(o.title, "Scène 3D"), caption: str(o.caption, "", 350), objects, surface,
    axes: o.axes !== false, spin: o.autoRotate === true };
}
const tone = (v: unknown) => PALETTE[bound(Math.floor(numeric(v) ?? 0), 0, PALETTE.length - 1)];
function makeObject(three: typeof import("three"), v: Dict): THREE.Object3D | null {
  const kind = str(v.type).toLowerCase();
  let geometry: THREE.BufferGeometry | null = null;
  const seg = 24;
  if (kind === "sphere" || kind === "atom") geometry = new three.SphereGeometry(bound(numeric(v.radius) ?? .7, .02, 20), seg, 16);
  else if (kind === "box" || kind === "cube") geometry = new three.BoxGeometry(...point3(v.size, [1, 1, 1]).map(n => Math.max(.02, Math.abs(n))) as [number, number, number]);
  else if (kind === "cone") geometry = new three.ConeGeometry(bound(numeric(v.radius) ?? .65, .02, 20), bound(numeric(v.height) ?? 1.5, .02, 30), seg);
  else if (kind === "cylinder") geometry = new three.CylinderGeometry(bound(numeric(v.radiusTop) ?? .5, 0, 20), bound(numeric(v.radiusBottom) ?? .5, 0, 20), bound(numeric(v.height) ?? 1.5, .02, 30), seg);
  else if (kind === "torus") geometry = new three.TorusGeometry(bound(numeric(v.radius) ?? 1, .05, 20), bound(numeric(v.tube) ?? .2, .01, 4), 12, 48);
  if (kind === "line" || kind === "bond" || kind === "vector") {
    const start = point3(v.from ?? v.start), end = point3(v.to ?? v.end, [1, 1, 0]);
    const vertices = new Float32Array([...start, ...end]);
    const g = new three.BufferGeometry();
    g.setAttribute("position", new three.BufferAttribute(vertices, 3));
    return new three.Line(g, new three.LineBasicMaterial({ color: tone(v.colorIndex) }));
  }
  if (!geometry) return null;
  const material = new three.MeshStandardMaterial({ color: tone(v.colorIndex), roughness: .35, metalness: .08,
    transparent: v.opacity !== undefined, opacity: bound(numeric(v.opacity) ?? 1, .08, 1), side: three.DoubleSide });
  const mesh = new three.Mesh(geometry, material);
  mesh.position.set(...point3(v.position));
  mesh.rotation.set(...point3(v.rotation));
  return mesh;
}
/** Only a fixed catalog of formulas is permitted: no eval, Function, dynamic shader, or model-authored code. */
function surfaceValue(type: string, x: number, y: number): number {
  if (type === "saddle") return (x * x - y * y) / 8;
  if (type === "paraboloid") return (x * x + y * y) / 9;
  if (type === "gaussian") return 3 * Math.exp(-(x * x + y * y) / 4);
  if (type === "ripple") { const r = Math.hypot(x, y); return r < .001 ? 2 : 2 * Math.sin(r * 2) / r; }
  if (type === "plane") return (x + y) / 5;
  return Math.sin(x) * Math.cos(y);
}
function makeSurface(three: typeof import("three"), s: Dict) {
  const mode = str(s.function ?? s.type, "sincos", 40).toLowerCase();
  const resolution = bound(Math.floor(numeric(s.resolution) ?? 55), 12, 100);
  const domain = bound(numeric(s.domain) ?? 5, 1, 15);
  const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
  const cool = new three.Color("#0d9488"), warm = new three.Color("#2563eb");
  for (let j = 0; j <= resolution; j++) {
    const y = -domain + 2 * domain * j / resolution;
    for (let i = 0; i <= resolution; i++) {
      const x = -domain + 2 * domain * i / resolution;
      const z = bound(surfaceValue(mode, x, y), -20, 20);
      vertices.push(x, z, y);
      const c = cool.clone().lerp(warm, bound((z + 4) / 8, 0, 1));
      colors.push(c.r, c.g, c.b);
      if (i < resolution && j < resolution) {
        const a = j * (resolution + 1) + i;
        indices.push(a, a + resolution + 1, a + 1, a + 1, a + resolution + 1, a + resolution + 2);
      }
    }
  }
  const g = new three.BufferGeometry();
  g.setAttribute("position", new three.Float32BufferAttribute(vertices, 3));
  g.setAttribute("color", new three.Float32BufferAttribute(colors, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return new three.Mesh(g, new three.MeshStandardMaterial({ vertexColors: true, side: three.DoubleSide, roughness: .55, metalness: .06 }));
}
function disposeScene(scene: THREE.Scene) {
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.dispose();
    }
  });
}
export default function OriaVisual3D({ kind, raw, language = "fr", fallback = null }: {
  kind: string; raw: string; language?: Lang; fallback?: ReactNode;
}) {
  const spec = useMemo(() => kind === "oria-3d" ? parsePayload(raw) : null, [kind, raw]);
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const rotating = useRef(false);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => { rotating.current = !!spec?.spin; setPlaying(!!spec?.spin); setError(false); }, [spec?.spin, spec?.title]);
  useEffect(() => {
    if (!spec || !container.current) return;
    const host = container.current;
    let dead = false, frame = 0, observer: ResizeObserver | null = null;
    let cleanup: (() => void) | undefined;
    Promise.all([import("three"), import("three/addons/controls/OrbitControls.js")]).then(([three, { OrbitControls }]) => {
      if (dead) return;
      const gl = new three.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      gl.setClearColor(0xf8fafc, 1);
      gl.outputColorSpace = three.SRGBColorSpace;
      host.appendChild(gl.domElement);
      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(45, 1, .1, 500);
      camera.position.set(10, 8, 11);
      const light = new three.DirectionalLight(0xffffff, 2.5); light.position.set(4, 12, 8);
      scene.add(light, new three.AmbientLight(0xffffff, 1.5));
      const group = new three.Group();
      for (const entry of spec.objects) { const object = makeObject(three, entry); if (object) group.add(object); }
      if (spec.surface) group.add(makeSurface(three, spec.surface));
      scene.add(group);
      if (spec.axes) { scene.add(new three.AxesHelper(5)); scene.add(new three.GridHelper(12, 12, 0x94a3b8, 0xcbd5e1)); }
      const controls = new OrbitControls(camera, gl.domElement);
      controls.enableDamping = true; controls.dampingFactor = .07;
      controls.minDistance = 1.2; controls.maxDistance = 100;
      let lastFrame = 0;
      const render = (now: number) => {
        if (dead) return;
        frame = window.requestAnimationFrame(render);
        if (document.hidden || now - lastFrame < 32) return;
        lastFrame = now;
        if (rotating.current) group.rotation.y += .007;
        controls.update(); gl.render(scene, camera);
      };
      const resize = () => {
        const w = Math.max(200, host.clientWidth), h = Math.max(200, host.clientHeight);
        gl.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      resize();
      if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(resize); observer.observe(host); }
      const contextLost = (e: Event) => { e.preventDefault(); setError(true); };
      gl.domElement.addEventListener("webglcontextlost", contextLost);
      frame = window.requestAnimationFrame(render);
      cleanup = () => {
        cancelAnimationFrame(frame); observer?.disconnect(); controls.dispose(); disposeScene(scene);
        gl.domElement.removeEventListener("webglcontextlost", contextLost);
        gl.dispose(); gl.domElement.remove();
      };
    }).catch(() => { if (!dead) setError(true); });
    return () => { dead = true; cleanup?.(); };
  }, [spec, resetKey]);
  // The optional animation toggle remains purely local and must never execute model code.
  if (!spec) return <>{fallback}</>;
  return <section className="my-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-label={spec.title}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
      <h3 className="text-sm font-semibold">{spec.title}</h3>
      <div className="flex gap-1.5">
        <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => { rotating.current = !rotating.current; setPlaying(rotating.current); }}>
          {playing ? (language === "fr" ? "Pause rotation" : "Pause rotation") : (language === "fr" ? "Rotation" : "Rotate")}
        </button>
        <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => setResetKey(v => v + 1)}>{language === "fr" ? "Réinitialiser" : "Reset"}</button>
      </div>
    </div>
    {error && <p role="alert" className="p-3 text-sm text-red-600">{language === "fr" ? "La 3D n'est pas disponible sur cet appareil ou les dépendances manquent." : "3D is unavailable on this device or dependencies are missing."}</p>}
    <div ref={container} className="w-full touch-none bg-slate-50" style={{ height: "min(62vh, 480px)", minHeight: 280 }} aria-label={spec.title} role="img"/>
    <p className="px-3 py-2 text-xs text-muted">{spec.caption || (language === "fr" ? "Glisser pour tourner · Molette pour zoomer · Clic droit pour déplacer" : "Drag to rotate · Scroll to zoom · Right click to pan")}</p>
  </section>;
}
