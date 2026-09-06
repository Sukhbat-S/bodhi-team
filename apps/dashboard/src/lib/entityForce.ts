// ============================================================
// BODHI — Entity graph force config
//
// d3-force (2D, NOT d3-force-3d) configuration for the
// react-force-graph-2d view. ONE layout, per
// ENTITIES-REDESIGN-DESIGN-JUN08.md §3:
//
//   DEFAULT — clustered-force-by-type: same-type nodes drift
//   into 6 loose color-coherent lobes anchored on a hex ring;
//   cross-links still expose topology. ("See the shape of the
//   whole mind.")
//
// (The FOCUS radial re-layout was removed in Wave 9a — selection
// is calm and in-place, paint-only; it never re-arranges nodes.
// See EntityGraph2D.tsx.)
//
// These helpers are installed onto the live simulation via the
// ForceGraph2D ref in EntityGraph2D.tsx (d3Force() must be set
// after mount, then d3ReheatSimulation()).
// ============================================================

import {
  forceManyBody,
  forceLink,
  forceX,
  forceY,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

/** The six type-cluster anchors, in stable order around a hex ring. */
const HEX_RING_TYPES = ["topic", "project", "organization", "person", "place", "product"] as const;

/** Base hex-ring radius for the type cluster anchors (px). §3. */
export const CLUSTER_RING_RADIUS = 280;

/**
 * Cluster-ring radius scaled to the visible node count. The §3 ring (280) was
 * tuned for the ~13-node mockup; the live graph shows up to ~200 nodes, which
 * collapses every type-lobe onto its anchor unless the ring (and charge, below)
 * grow with N. sqrt keeps it from ballooning.
 */
export function clusterRingRadius(n: number): number {
  return Math.round(200 + 34 * Math.sqrt(Math.max(1, n)));
}

/** Minimal shape the force helpers read off a node (the engine adds x/y/vx/vy). */
export interface ForceNode extends SimulationNodeDatum {
  id: string;
  type: string;
  /** Visual radius on the filtered set — drives collide spacing. */
  r: number;
}

export type ForceLink = SimulationLinkDatum<ForceNode> & { value: number };

/**
 * Position of a type's cluster anchor on the hex ring. Unknown types fold
 * onto the `product` slot (last) so they still get a stable home.
 */
export function clusterAnchor(
  type: string,
  radius: number = CLUSTER_RING_RADIUS,
): { x: number; y: number } {
  const idx = HEX_RING_TYPES.indexOf(type as (typeof HEX_RING_TYPES)[number]);
  const slot = idx === -1 ? HEX_RING_TYPES.length - 1 : idx;
  const angle = (slot / HEX_RING_TYPES.length) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

/**
 * DEFAULT layout — clustered-force-by-type. Installs the cluster forces onto
 * a live simulation. §3: forceManyBody(-30); link dist 40, strength 0.15;
 * forceX/forceY toward the per-node type anchor, strength 0.08; collide r*2.3.
 *
 * Call after mount with the ForceGraph2D ref, then d3ReheatSimulation().
 */
export function applyClusterForces(sim: Simulation<ForceNode, ForceLink>, nodeCount: number): void {
  // Node-count-aware spread: the §3 constants (charge -30, ring 280) were tuned
  // for the ~13-node mockup and collapse the live ~200-node graph into a central
  // ball. Scale repulsion + ring with sqrt(N) so the field breathes at any size.
  const n = nodeCount;
  const spread = clusterRingRadius(n); // bounds the charge range

  // ORGANIC force-directed layout (Obsidian / InfraNodus-like). Spread is driven
  // by charge + links + collide; TYPE only gently nudges same-type nodes loosely
  // together (color carries type). A rigid 6-anchor hex layout clumped
  // asymmetrically under the real type-skew (project 74 + topic 60 of 200), so
  // it's downgraded to a soft nudge near center.
  //
  // DESIGN.md is current authority. Historical spacing provenance is recoverable
  // with `git show 4eca578:docs/design/BODHI.dc.html`: its simulation
  // scales spacing to the canvas, K = √(w·h/n) (≈137px for ~60 nodes in a
  // 1400×800 frame) and its K²-scaled repulsion is STRONG — that constant
  // push-apart is what keeps the hub from knotting. d3-force equivalent:
  // long link rests (46→90, toward the prototype's ~110 ceiling) + weak link
  // strength (0.15) carry the spread, and charge must EXCEED the old value,
  // not shrink (the plan's halve-knob read the direction backwards — tuned
  // by eye against :8801: -(30+3√N) left a label-colliding center knot).
  sim.force(
    "charge",
    forceManyBody<ForceNode>()
      .strength(-(160 + 12 * Math.sqrt(Math.max(1, n)))) // n157≈-310
      .distanceMax(spread),
  );

  // Links — long rests + DEGREE-AWARE strength (anti-hairball). The real graph
  // has a dense core (most entities link to the BODHI/owner hubs), which a
  // uniform strength knots into a label-colliding ball no charge can open.
  // d3's classic remedy: a hub's links pull at 1/min(degree), so leaves attach
  // firmly while hubs stop dragging their whole neighborhood inward. Hub-pair
  // links also get LONGER rests (√ combined degree) so the core breathes.
  const link = sim.force("link") as ReturnType<typeof forceLink<ForceNode, ForceLink>> | undefined;
  if (link) {
    const deg = new Map<string | number, number>();
    for (const l of link.links() as Array<{ source: ForceNode; target: ForceNode }>) {
      const s = (l.source as ForceNode).id;
      const t = (l.target as ForceNode).id;
      deg.set(s, (deg.get(s) ?? 0) + 1);
      deg.set(t, (deg.get(t) ?? 0) + 1);
    }
    // Degree influence on rest length CAPPED at 12 — the prototype caps degree
    // at 9 for radius for the same reason: real hubs (BODHI ≈ 60 links) would
    // otherwise dominate every formula they enter.
    const dOf = (n: ForceNode) => Math.min(12, deg.get(n.id) ?? 1);
    link
      .distance(
        (l) =>
          80 + 12 * Math.sqrt(dOf(l.source as ForceNode) + dOf(l.target as ForceNode)),
      )
      .strength(
        (l) =>
          0.5 / Math.max(1, Math.min(dOf(l.source as ForceNode), dOf(l.target as ForceNode))),
      );
  }

  // Collision — keep glow halos from stacking; halo footprint ≈ r*2.2.
  sim.force(
    "collide",
    forceCollide<ForceNode>((d) => d.r * 2.3).strength(0.9),
  );

  // Gentle type nudge toward a SMALL ring near the origin: loose colour grouping
  // + inherent centering (anchors near center keep the field composed). Weak
  // enough that charge + links own the actual shape.
  // Ring widened 150→260 + strength 0.05→0.03 (Wave 8): the tight near-center
  // anchors were adding centripetal pull that re-compressed the hub the charge
  // fix opens up. Color still groups loosely; charge + links own the shape.
  const typeRing = 260;
  sim.force(
    "clusterX",
    forceX<ForceNode>((d) => clusterAnchor(d.type, typeRing).x).strength(0.03),
  );
  sim.force(
    "clusterY",
    forceY<ForceNode>((d) => clusterAnchor(d.type, typeRing).y).strength(0.03),
  );

  // zoomToFit re-centers the viewport on settle.
  sim.force("center", null);
}
