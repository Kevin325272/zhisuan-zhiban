import { Check, Circle, LocateFixed, LockKeyhole } from "lucide-react";

interface CourseTreeNode {
  learning_node_id: string;
  title: string;
  status: string;
}

function NodeIcon({ status }: { status: string }) {
  if (status === "mastered") return <Check aria-hidden="true" size={14} />;
  if (status === "in_progress" || status === "validation_ready") {
    return <LocateFixed aria-hidden="true" size={15} />;
  }
  if (status === "not_started") return <LockKeyhole aria-hidden="true" size={13} />;
  return <Circle aria-hidden="true" size={13} />;
}

function statusLabel(status: string) {
  if (status === "mastered") return "已掌握";
  if (status === "in_progress") return "学习中";
  if (status === "validation_ready") return "待验证";
  if (status === "needs_review") return "待回访";
  return "未开始";
}

export function CourseTree({
  nodes,
  currentNodeId,
}: {
  nodes: CourseTreeNode[];
  currentNodeId: string;
}) {
  return (
    <ol className="course-tree" aria-label="数据结构学习路径">
      {nodes.map((node, index) => (
        <li
          className={`course-tree-node${node.learning_node_id === currentNodeId ? " current" : ""}`}
          key={node.learning_node_id}
        >
          <span className={`tree-node-icon tree-${node.status}`} aria-label={`状态：${node.status}`}>
            <NodeIcon status={node.status} />
          </span>
          <span className="tree-node-copy">
            <small>{String(index + 1).padStart(2, "0")} · {statusLabel(node.status)}</small>
            <strong>{node.title}</strong>
          </span>
          {node.learning_node_id === currentNodeId ? <span className="current-node-label">当前</span> : null}
        </li>
      ))}
    </ol>
  );
}
