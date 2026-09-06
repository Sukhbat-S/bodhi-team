// ============================================================
// BODHI — EntityGraph2D
//
// The legible editorial graph. react-force-graph-2d + Canvas2D,
// every node/edge drawn by hand. Replaces the retired
// react-force-graph-3d / Three.js / heliocentric scene.
//
// Aesthetic (ENTITIES-REDESIGN-DESIGN-JUN08.md §3 + Wave 9a
// prototype parity): glowing nodes (color = type, size =
// mention-count) on near-black, hairline curved edges carried by
// clustering, progressive label disclosure, hover/select state.
// Selection is CALM and in-place under the current DESIGN.md grammar: no
// camera motion, no re-layout, no dim cascade — the amber double
// ring + amber relation edges carry it.
//
// The simulation settles and the canvas then pauses. Selection and evidence
// highlights are static state cues; there is no decorative idle motion.
// ============================================================

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useReducedMotion } from "framer-motion";
import { entityColor, STATE_AMBER } from "../theme/tokens";
import {
  applyClusterForces,
  type ForceNode,
  type ForceLink,
} from "../lib/entityForce";
import { graphMotionSettings } from "../lib/entityGraphMotion";

// ── Public data shape (ports 1:1 from the old fetch) ──────────────
export interface Graph2DNode {
  id: string;
  name: string;
  type: string;
  /** raw mention count — sqrt-clamped to a visual radius on the filtered set */
  mentionCount: number;
  /** server-provided first-mention timestamp — Wave 5 time-strip consumes it */
  firstSeenAt?: string | null;
  /** server-provided last-mention timestamp — Wave 8 recency (radius/alpha/glow) */
  lastSeenAt?: string | null;
}

export interface Graph2DLink {
  sourceId: string;
  targetId: string;
  /** sharedMemoryCount — log-weighted into alpha/width, never color */
  value: number;
}

interface EntityGraph2DProps {
  nodes: Graph2DNode[];
  links: Graph2DLink[];
  width: number;
  height: number;
  selectedId: string | null;
  onNodeClick: (id: string) => void;
  onBackgroundClick: () => void;
}

export interface EntityGraph2DHandle {
  /** Highlight entities referenced by the focused day-evidence row. */
  pulseNodes(ids: string[] | null): void;
}

// ── Internal node/link the engine mutates in place ────────────────
// Typed to match react-force-graph-2d's NodeObject contract (fx/fy are
// `number | undefined`, NOT d3-force's `number | null`); cast to the
// d3-force ForceNode/ForceLink only at the simFacade boundary.
interface GNode {
  id: string;
  type: string;
  r: number; // visual radius on the filtered set (drives collide)
  name: string;
  color: string;
  mentions: number;
  recency: number; // 0..1 — ~14d half-life decay from lastSeenAt (Wave 8)
  // engine-mutated:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}
interface GLink {
  sourceId: string;
  targetId: string;
  value: number;
  // engine replaces source/target with node objects after the first tick:
  source: string | GNode;
  target: string | GNode;
}

// ── Visual constants (§3 + Wave 8 prototype port) ─────────────────
// Node radius/alpha/glow/labels follow DESIGN.md's honest-signal contract.
// Historical formula provenance is recoverable with
// `git show 4eca578:docs/design/BODHI.dc.html`:
//   r = 2.2 + min(deg, 9)·0.55 + recency·1.7   (deg = link count)
//   alpha = 0.5 + 0.5·recency · glow (shadowBlur 15·recency) iff recency > 0.55
//   label at rest iff r > 4.4 (or selected/neighbor) — 10px mono at y + r + 13
// The prototype's outside-brush-window case (alpha 0.08, r×0.6) is
// unreachable here: the live page FILTERS brushed-out nodes from the data
// set instead of dimming them, so every painted node is in-window.
const LABEL_R = 4.4; // prototype label-at-rest radius gate
const GLOW_RECENCY = 0.55; // prototype glow threshold
const RECENCY_HALF_LIFE_DAYS = 14; // ~14d half-life feel per the Wave-8 plan
const HALO_FACTOR = 2.2; // pointer halo radius = r * HALO_FACTOR (hit-test + gesture snap)
const MONO_FONT = "'JetBrains Mono','SF Mono',ui-monospace,monospace";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0..1 recency from lastSeenAt — exponential decay, ~14d half-life (Wave 8).
 *  Missing timestamp reads as fully cold (0) — never invent activity. */
function recencyOf(lastSeenAt: string | null | undefined): number {
  if (!lastSeenAt) return 0;
  const ts = Date.parse(lastSeenAt);
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export const EntityGraph2D = forwardRef<EntityGraph2DHandle, EntityGraph2DProps>(function EntityGraph2D({
  nodes,
  links,
  width,
  height,
  selectedId,
  onNodeClick,
  onBackgroundClick,
}: EntityGraph2DProps, ref) {
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion() === true;
  const motionSettings = graphMotionSettings(reducedMotion);

  // 1-hop adjacency — neighbor labels on selection (Wave 9a keeps it paint-only).
  const adjacency = useMemo(() => {
    const map = new Map<string, Map<string, number>>(); // id -> (neighborId -> weight)
    for (const l of links) {
      if (!map.has(l.sourceId)) map.set(l.sourceId, new Map());
      if (!map.has(l.targetId)) map.set(l.targetId, new Map());
      map.get(l.sourceId)!.set(l.targetId, l.value);
      map.get(l.targetId)!.set(l.sourceId, l.value);
    }
    return map;
  }, [links]);

  // ── Build the engine graph. Wave 8 prototype radius: degree (link count)
  //    carries structural weight, recency carries temperature —
  //    r = 2.2 + min(deg, 9)·0.55 + recency·1.7 (≈2.2–9.85). ──
  const graphData = useMemo(() => {
    const degById = new Map<string, number>();
    for (const l of links) {
      degById.set(l.sourceId, (degById.get(l.sourceId) ?? 0) + 1);
      degById.set(l.targetId, (degById.get(l.targetId) ?? 0) + 1);
    }

    const gNodes: GNode[] = nodes.map((n) => {
      const deg = degById.get(n.id) ?? 0;
      const recency = recencyOf(n.lastSeenAt);
      return {
        id: n.id,
        name: n.name,
        type: n.type,
        color: entityColor(n.type),
        mentions: n.mentionCount,
        recency,
        r: 2.2 + Math.min(deg, 9) * 0.55 + recency * 1.7,
      };
    });
    const gLinks: GLink[] = links.map((l) => ({
      sourceId: l.sourceId,
      targetId: l.targetId,
      source: l.sourceId,
      target: l.targetId,
      value: l.value,
    }));
    return { nodes: gNodes, links: gLinks };
  }, [nodes, links]);

  // log-weight range for edge alpha/width.
  const linkWeightRange = useMemo(() => {
    const ws = links.map((l) => Math.log1p(l.value));
    return { lo: ws.length ? Math.min(...ws) : 0, hi: ws.length ? Math.max(...ws) : 1 };
  }, [links]);

  // ── Install DEFAULT cluster forces once the ref is live ──
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const sim = fg.d3Force as unknown; // presence guard below
    if (typeof fg.d3Force !== "function") return;
    // d3Force getter/setter mirrors the simulation; install via the ref.
    try {
      // The ref exposes d3Force(name) getter + d3Force(name, force) setter.
      // applyClusterForces wants the Simulation; reconstruct via the setters.
      if (!reducedMotion) {
        installClusterVia(fg);
        fg.d3ReheatSimulation();
      }
    } catch {
      // best-effort; the engine's defaults still produce a usable layout
    }
    void sim;
  }, [graphData.nodes.length, reducedMotion]);

  // Fit once the force simulation settles. The zero-duration move keeps the
  // relationship layout visible without a large camera transition.
  const handleEngineStop = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || selectedId) return;
    fg.zoomToFit(0, 80);
  }, [selectedId]);

  useImperativeHandle(
    ref,
    (): EntityGraph2DHandle => ({
      pulseNodes(ids) { setPulseIds(new Set(ids ?? [])); },
    }),
    [],
  );

  // ── Node painter — two-pass glow (§3) ──
  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (typeof node.x !== "number" || typeof node.y !== "number") return;
      const x = node.x;
      const y = node.y;
      const r = node.r;
      const isSelected = selectedId === node.id;
      const focusActive = selectedId != null;
      const isNeighbor = focusActive && !isSelected && adjacency.get(selectedId!)?.has(node.id);

      ctx.save();

      // Wave 8 prototype draw — recency IS the temperature channel:
      // hot nodes glow (shadowBlur 15·recency past the 0.55 gate); every core's alpha rides
      // 0.5 + 0.5·recency. Wave 9a: NO dim cascade on selection — the whole
      // constellation stays visible (prototype grammar); only the amber
      // relation edges + ring mark the neighborhood.
      if (node.recency > GLOW_RECENCY) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 15 * node.recency;
      }
      ctx.globalAlpha = 0.5 + 0.5 * node.recency;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // state ring — amber DOUBLE ring (Wave 8 prototype: 0.9 at r+5,
      // 0.22 echo at r+11). Stroke = state, never confused with topic fill.
      if (isSelected) {
        ctx.lineWidth = 1.2 / globalScale;
        ctx.strokeStyle = STATE_AMBER;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(x, y, r + 11, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (pulseIds.has(node.id) && !isSelected) {
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.3 / globalScale;
        ctx.strokeStyle = STATE_AMBER;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      // ── label — Wave 8 prototype rule: at rest iff r > 4.4; selected +
      //    neighbors always (replaces the old rank/zoom-scale gates) ──
      const showLabel = isSelected || isNeighbor || r > LABEL_R;
      if (showLabel) {
        // Greedy collision suppression (Wave 8): the real graph's hub is far
        // denser than the prototype's mock, so the bare r>4.4 rule stacks
        // labels in the core. Skip a label whose anchor would land on one
        // already drawn this frame (screen-space thresholds; selection and
        // neighbors always win and still claim their rect).
        const lw = (node.name.length * 6) / globalScale; // ≈10px-mono width, graph units
        const ly = y + r + 13 / globalScale;
        const rects = labelRectsRef.current;
        const collides = rects.some(
          (p) =>
            Math.abs(x - p.x) * globalScale < ((lw + p.w) / 2) * globalScale + 6 &&
            Math.abs(ly - p.y) * globalScale < 12,
        );
        if (!collides || isSelected || isNeighbor) {
          drawLabel(ctx, node, x, y, r, globalScale, isSelected);
          rects.push({ x, y: ly, w: lw });
        }
      }
    },
    [selectedId, adjacency, pulseIds],
  );

  // per-frame label rects for the greedy suppression above — reset each frame
  const labelRectsRef = useRef<Array<{ x: number; y: number; w: number }>>([]);

  // Hit-test footprint must match the painted node (halo radius) — required
  // in 'replace' mode or hover/click silently break.
  const paintNodePointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      if (typeof node.x !== "number" || typeof node.y !== "number") return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, Math.max(node.r * 1.6, 6), 0, Math.PI * 2);
      ctx.fill();
    },
    [],
  );

  // ── Link painter — hairline curved; amber relation edges on selection
  //    (Wave 9a prototype grammar) ──
  const paintLink = useCallback(
    (link: GLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const src = link.source as GNode;
      const dst = link.target as GNode;
      if (!src || !dst || typeof src.x !== "number" || typeof dst.x !== "number") return;

      const touchesSelection =
        selectedId != null && (src.id === selectedId || dst.id === selectedId);

      // log-weighted alpha + width (never color).
      const w = Math.log1p(link.value);
      const { lo, hi } = linkWeightRange;
      const t = hi > lo ? (w - lo) / (hi - lo) : 0.5;

      const restAlpha = lerp(0.06, 0.18, t); // unselected baseline
      const restWidth = lerp(0, 0.6, t);

      let alpha: number;
      let lineWidth: number;
      let stroke = "rgb(150,150,150)";
      if (touchesSelection) {
        // Relation edges go STATE_AMBER (~0.5 alpha, ~1.2px) — state, never
        // topic; the prototype's "the amber relations read" move.
        alpha = 0.5;
        lineWidth = 1.2 / globalScale;
        stroke = STATE_AMBER;
      } else {
        // Non-relation edges soften slightly (~0.6× rest) so the amber
        // reads — the constellation stays visible (no dim cascade).
        alpha = selectedId ? restAlpha * 0.6 : restAlpha;
        lineWidth = (1 + restWidth) / globalScale;
      }

      // gentle quadratic curve, curvature ≈ 0.12.
      const sx = src.x as number;
      const sy = src.y as number;
      const dx = dst.x as number;
      const dy = dst.y as number;
      const mx = (sx + dx) / 2;
      const my = (sy + dy) / 2;
      const nx = -(dy - sy);
      const ny = dx - sx;
      const len = Math.hypot(nx, ny) || 1;
      const curve = 0.12;
      const cx = mx + (nx / len) * len * curve;
      const cy = my + (ny / len) * len * curve;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, dx, dy);
      ctx.stroke();
      ctx.restore();
    },
    [selectedId, linkWeightRange],
  );

  return (
    <ForceGraph2D<GNode, GLink>
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor="#0A0A0A"
      autoPauseRedraw
      cooldownTicks={motionSettings.cooldownTicks}
      cooldownTime={motionSettings.cooldownTime}
      warmupTicks={motionSettings.warmupTicks}
      enableNodeDrag={false}
      nodeRelSize={4}
      nodeCanvasObjectMode={() => "replace"}
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={paintNodePointerArea}
      linkCanvasObjectMode={() => "replace"}
      linkCanvasObject={paintLink}
      onNodeClick={(node) => onNodeClick((node as GNode).id)}
      onBackgroundClick={onBackgroundClick}
      onEngineStop={handleEngineStop}
      onRenderFramePre={() => {
        labelRectsRef.current = []; // greedy label suppression resets per frame
      }}
    />
  );

  // ── helpers that need the ref's d3Force getter/setter ──
  function installClusterVia(fg: ForceGraphMethods<GNode, GLink>) {
    // The ref's d3Force(name) getter returns the live force; we drive the
    // shared config via a synthetic Simulation-like facade over the ref.
    applyClusterForces(simFacade(fg), graphData.nodes.length);
  }
});

// ── tiny render helpers ───────────────────────────────────────────

/** Draw the node label — Wave 8 prototype grammar: 10px JetBrains Mono at
 *  y + r + 13, selected bright (237,237,238,0.95) vs rest quiet
 *  (154,154,159,0.72). Font + the +13 gap are divided by globalScale so the
 *  label keeps a constant SCREEN size (the prototype canvas never zooms; the
 *  live graph does — at the rest scale ≈1 the two are identical). The dark
 *  text-halo stroke is a live-build legibility nicety the prototype lacks. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  node: GNode,
  x: number,
  y: number,
  r: number,
  globalScale: number,
  isSelected: boolean,
) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const py = y + r + 13 / globalScale;
  ctx.font = `${10 / globalScale}px ${MONO_FONT}`;
  ctx.lineWidth = 2 / globalScale;
  ctx.strokeStyle = "rgba(10,10,10,0.85)";
  ctx.strokeText(node.name, x, py);
  ctx.fillStyle = isSelected ? "rgba(237,237,238,0.95)" : "rgba(154,154,159,0.72)";
  ctx.fillText(node.name, x, py);
  ctx.restore();
}

/**
 * Facade exposing the d3-force `Simulation` surface our config helpers need
 * (`force(name, force?)`), backed by the ForceGraph2D ref's d3Force getter/
 * setter. Lets entityForce.ts stay a pure d3-force module while the live
 * simulation lives inside the lib.
 */
function simFacade(fg: ForceGraphMethods<GNode, GLink>): import("d3-force").Simulation<ForceNode, ForceLink> {
  const facade = {
    force(name: string, force?: unknown) {
      if (force === undefined) {
        return fg.d3Force(name as "link" | "charge" | "center" | string) as never;
      }
      // setter — null removes the force
      (fg as unknown as { d3Force: (n: string, f: unknown) => void }).d3Force(name, force);
      return facade as never;
    },
  };
  return facade as unknown as import("d3-force").Simulation<ForceNode, ForceLink>;
}
