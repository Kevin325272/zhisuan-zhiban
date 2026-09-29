import type { LearningDiagram } from "@xuetu/contracts";
import { GitBranch, Route } from "lucide-react";
import { useId, useState } from "react";
import { layoutLearningDiagram } from "./learning-diagram-layout";

export function LearningDiagramView({ diagram }: { diagram: LearningDiagram }) {
  const [selectedId, setSelectedId] = useState(diagram.nodes[0]!.id);
  const markerId = `arrow-${useId().replace(/:/gu, "")}`;
  const selected = diagram.nodes.find((node) => node.id === selectedId) ?? diagram.nodes[0]!;
  const structure = diagram.kind === "structure";
  const { height, nodeWidth, positions } = layoutLearningDiagram(diagram);
  return <figure className="learning-diagram" aria-label={diagram.title}>
    <figcaption><span className="diagram-type">{structure ? <GitBranch size={16} /> : <Route size={16} />}{structure ? "结构图" : "流程图"}</span><strong>{diagram.title}</strong></figcaption>
    <p className="diagram-summary">{diagram.summary}</p>
    <div className="diagram-canvas" style={{ aspectRatio: `720 / ${height}` }}>
      <svg viewBox={`0 0 720 ${height}`} aria-hidden="true" preserveAspectRatio="none">
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
        {diagram.edges.map((edge) => {
          const from = positions.find((p) => p.id === edge.from)!;
          const to = positions.find((p) => p.id === edge.to)!;
          const vertical = from.y !== to.y;
          const direction = vertical ? Math.sign(to.y - from.y) : Math.sign(to.x - from.x);
          const x1 = vertical ? from.x : from.x + direction * (nodeWidth / 2 + 3);
          const x2 = vertical ? to.x : to.x - direction * (nodeWidth / 2 + 6);
          const y1 = vertical ? from.y + direction * 27 : from.y;
          const y2 = vertical ? to.y - direction * 30 : to.y;
          const midY = (y1 + y2) / 2;
          const bend = !vertical && (structure || Math.abs(from.x - to.x) > 300) ? (direction > 0 ? -64 : 64) : 0;
          const path = vertical ? `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}` : bend ? `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${midY + bend}, ${x2} ${y2}` : `M ${x1} ${y1} L ${x2} ${y2}`;
          return <g key={`${edge.from}-${edge.to}`} className={edge.from === selected.id || edge.to === selected.id ? "is-active" : ""}>
            <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" markerEnd={`url(#${markerId})`} />
            {edge.label ? <text x={(x1 + x2) / 2} y={midY + bend / 2 + (bend > 0 ? 17 : -10)} textAnchor="middle"><title>{edge.label}</title>{edge.label.length > 12 ? `${edge.label.slice(0, 11)}…` : edge.label}</text> : null}
          </g>;
        })}
      </svg>
      {diagram.nodes.map((node, index) => <button type="button" key={node.id} aria-pressed={selected.id === node.id} onClick={() => setSelectedId(node.id)} className="diagram-node" style={{ left: `${positions[index]!.x / 7.2}%`, top: `${positions[index]!.y / height * 100}%`, width: `${nodeWidth / 7.2}%` }}>
        {!structure ? <span>{String(index + 1).padStart(2, "0")}</span> : null}<strong>{node.label}</strong>
      </button>)}
    </div>
    <div className="diagram-detail" aria-live="polite"><strong>{selected.label}</strong><p>{selected.description}</p></div>
    <details className="diagram-relationships"><summary>查看全部关系</summary><ul>{diagram.edges.map((edge) => <li key={`${edge.from}-${edge.to}`}>{diagram.nodes.find((node) => node.id === edge.from)!.label} → {diagram.nodes.find((node) => node.id === edge.to)!.label}{edge.label ? ` · ${edge.label}` : ""}</li>)}</ul></details>
  </figure>;
}
