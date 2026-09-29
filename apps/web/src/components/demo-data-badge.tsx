import { FlaskConical } from "lucide-react";

/** 标注用于熟悉页面操作的示例内容。 */
export function DemoDataBadge({ label = "示例内容" }: { label?: string }) {
  return (
    <span
      className="demo-data-badge"
      title="用于熟悉页面与操作"
    >
      <FlaskConical aria-hidden="true" size={12} />
      {label}
    </span>
  );
}
