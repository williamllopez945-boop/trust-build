/**
 * Estate graph: a typed node/edge view over a Household.
 * Used by the estate map UI, the rule engine, and the attorney packet.
 */
import type { Asset, FiduciaryRole, Household, Person } from "./types.ts";

export type NodeType = "person" | "trust" | "asset";
export type EdgeType =
  | "relationship"
  | "fiduciary"
  | "owns"
  | "beneficiary_primary"
  | "beneficiary_contingent"
  | "trust_distribution"
  | "funded_into";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  label: string;
}

export interface EstateGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const TRUST_NODE_ID = "trust";

export function buildEstateGraph(h: Household): EstateGraph {
  const nodes: GraphNode[] = [
    { id: TRUST_NODE_ID, type: "trust", label: h.plan.name },
    ...h.people.map((p) => ({ id: p.id, type: "person" as const, label: p.displayName })),
    ...h.assets.map((a) => ({ id: a.id, type: "asset" as const, label: a.label })),
  ];
  const edges: GraphEdge[] = [];

  for (const r of h.relationships) {
    edges.push({ from: r.from, to: r.to, type: "relationship", label: r.type });
  }
  for (const f of h.fiduciaries) {
    edges.push({ from: f.personId, to: TRUST_NODE_ID, type: "fiduciary", label: `${f.role} #${f.order}` });
  }
  for (const a of h.assets) {
    for (const owner of a.titledTo.value ?? []) {
      edges.push({ from: owner, to: a.id, type: "owns", label: "owns" });
    }
    if (a.funding.state === "funded") {
      edges.push({ from: a.id, to: TRUST_NODE_ID, type: "funded_into", label: a.funding.method });
    }
    for (const d of a.designations?.value ?? []) {
      edges.push({
        from: a.id,
        to: d.personId,
        type: d.tier === "primary" ? "beneficiary_primary" : "beneficiary_contingent",
        label: `${d.tier} ${d.sharePercent}%`,
      });
    }
  }
  for (const d of h.plan.distributions) {
    edges.push({ from: TRUST_NODE_ID, to: d.beneficiaryId, type: "trust_distribution", label: `${d.tier} ${d.sharePercent.value ?? "?"}%` });
  }
  return { nodes, edges };
}

export function personById(h: Household, id: string): Person | undefined {
  return h.people.find((p) => p.id === id);
}

export function nameOf(h: Household, id: string): string {
  if (id === TRUST_NODE_ID) return h.plan.name;
  return personById(h, id)?.displayName ?? `(unknown: ${id})`;
}

export function grantors(h: Household): Person[] {
  return h.people.filter((p) => p.isGrantor);
}

export function minors(h: Household): Person[] {
  return h.people.filter((p) => p.isMinor);
}

export function fiduciariesFor(h: Household, role: FiduciaryRole) {
  return h.fiduciaries.filter((f) => f.role === role).sort((a, b) => a.order - b.order);
}

export function assetsBy(h: Household, pred: (a: Asset) => boolean): Asset[] {
  return h.assets.filter(pred);
}
