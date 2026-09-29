import type { CourseMap, CourseMapNode } from "@xuetu/contracts";
import { AlertCircle, Check, LockKeyhole, Target } from "lucide-react";

interface KnowledgeGraphProps {
  courseMap: CourseMap;
  selectedNodeId: string;
  onlyWeak: boolean;
  onSelectNode: (nodeId: string) => void;
}

function statusLabel(status: CourseMapNode["status"]) {
  if (status === "mastered") return "已掌握";
  if (status === "validation_ready") return "待验证";
  if (status === "needs_review") return "待回访";
  if (status === "in_progress") return "学习中";
  return "未开始";
}

function NodeStateIcon({ node }: { node: CourseMapNode }) {
  if (node.status === "mastered") return <Check aria-hidden="true" size={13} />;
  if (node.status === "not_started") return <LockKeyhole aria-hidden="true" size={12} />;
  if (node.weakness_count > 0) return <AlertCircle aria-hidden="true" size={13} />;
  return <Target aria-hidden="true" size={13} />;
}

function visibleNodeIds(courseMap: CourseMap, selectedNodeId: string, onlyWeak: boolean) {
  if (!onlyWeak) return new Set(courseMap.nodes.map((node) => node.learning_node_id));

  const nodeById = new Map(courseMap.nodes.map((node) => [node.learning_node_id, node]));
  const visible = new Set(
    courseMap.nodes
      .filter(
        (node) =>
          node.weakness_count > 0 ||
          node.learning_node_id === selectedNodeId ||
          node.learning_node_id === courseMap.recommended_node_id,
      )
      .map((node) => node.learning_node_id),
  );

  const addPrerequisites = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    node?.prerequisite_node_ids.forEach((prerequisiteId) => {
      if (visible.has(prerequisiteId)) return;
      visible.add(prerequisiteId);
      addPrerequisites(prerequisiteId);
    });
  };

  [...visible].forEach(addPrerequisites);
  return visible;
}

export function KnowledgeGraph({
  courseMap,
  selectedNodeId,
  onlyWeak,
  onSelectNode,
}: KnowledgeGraphProps) {
  const shownIds = visibleNodeIds(courseMap, selectedNodeId, onlyWeak);
  const nodes = courseMap.nodes.filter((node) => shownIds.has(node.learning_node_id));
  const nodeById = new Map(courseMap.nodes.map((node) => [node.learning_node_id, node]));
  const edges = courseMap.edges.filter(
    (edge) => shownIds.has(edge.from_node_id) && shownIds.has(edge.to_node_id),
  );

  return (
    <div className="knowledge-graph" aria-label="图算法知识图谱">
      <svg
        aria-hidden="true"
        className="knowledge-graph-edges"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <defs>
          <marker
            id="knowledge-edge-arrow"
            markerHeight="5"
            markerWidth="5"
            orient="auto"
            refX="4"
            refY="2.5"
          >
            <path d="M0,0 L5,2.5 L0,5 Z" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = nodeById.get(edge.from_node_id);
          const to = nodeById.get(edge.to_node_id);
          if (!from || !to) return null;
          const highlighted =
            edge.from_node_id === selectedNodeId || edge.to_node_id === selectedNodeId;

          return (
            <line
              className={highlighted ? "highlighted" : undefined}
              key={`${edge.from_node_id}-${edge.to_node_id}`}
              markerEnd="url(#knowledge-edge-arrow)"
              x1={from.position.x}
              x2={to.position.x}
              y1={from.position.y}
              y2={to.position.y}
            />
          );
        })}
      </svg>

      {nodes.map((node) => {
        const isRecommended = node.learning_node_id === courseMap.recommended_node_id;
        const isSelected = node.learning_node_id === selectedNodeId;
        const accessibleName = `${node.title}${isRecommended ? "，当前推荐" : ""}，掌握度 ${node.mastery_percent}%`;

        return (
          <button
            aria-label={accessibleName}
            aria-pressed={isSelected}
            className={`knowledge-node status-${node.status}${isRecommended ? " recommended" : ""}${isSelected ? " selected" : ""}`}
            key={node.learning_node_id}
            onClick={() => onSelectNode(node.learning_node_id)}
            style={{ left: `${node.position.x}%`, top: `${node.position.y}%` }}
            type="button"
          >
            <span className="knowledge-node-state">
              <NodeStateIcon node={node} />
              {isRecommended ? "当前推荐" : statusLabel(node.status)}
            </span>
            <strong>{node.title}</strong>
            <span className="knowledge-node-mastery">
              <em aria-hidden="true">
                <i style={{ width: `${node.mastery_percent}%` }} />
              </em>
              <b>{node.mastery_percent}%</b>
            </span>
          </button>
        );
      })}

      <div className="knowledge-graph-legend" aria-label="节点状态图例">
        <span><i className="legend-mastered" />已掌握</span>
        <span><i className="legend-current" />学习中</span>
        <span><i className="legend-review" />待巩固</span>
        <span><i className="legend-locked" />未开始</span>
      </div>

      {nodes.length === 0 ? <p className="knowledge-graph-empty">当前没有薄弱知识点。</p> : null}
    </div>
  );
}
