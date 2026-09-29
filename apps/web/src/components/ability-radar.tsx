import type {
  AbilityAssessmentDimension,
  AbilityAssessmentKey,
} from "@xuetu/contracts";

interface AbilityRadarProps {
  compact?: boolean;
  dimensions: AbilityAssessmentDimension[];
  selectedKey: AbilityAssessmentKey;
  onSelect: (key: AbilityAssessmentKey) => void;
}

const VIEWBOX_SIZE = 520;
const CENTER = VIEWBOX_SIZE / 2;
const RADIUS = 166;
const LABEL_RADIUS = 216;

function pointAt(index: number, value: number, radius = RADIUS) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 6;
  const scaledRadius = (Math.max(0, Math.min(value, 100)) / 100) * radius;

  return {
    x: CENTER + Math.cos(angle) * scaledRadius,
    y: CENTER + Math.sin(angle) * scaledRadius,
  };
}

function polygonPoints(values: number[], radius = RADIUS) {
  return values
    .map((value, index) => {
      const point = pointAt(index, value, radius);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");
}

export function AbilityRadar({
  compact = false,
  dimensions,
  selectedKey,
  onSelect,
}: AbilityRadarProps) {
  if (dimensions.length !== 6) {
    return <div role="alert">能力维度数据不完整</div>;
  }

  return (
    <div className={`ability-radar${compact ? " is-compact" : ""}`}>
      <svg
        aria-label={compact ? "六维能力雷达预览" : "六维专业能力雷达图"}
        className="ability-radar-svg"
        role="img"
        viewBox={compact ? "60 60 400 400" : `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      >
        <g className="ability-radar-grid">
          {[20, 40, 60, 80, 100].map((value) => (
            <polygon
              key={value}
              points={polygonPoints(Array(6).fill(value))}
            />
          ))}
        </g>

        <g className="ability-radar-axes">
          {dimensions.map((dimension, index) => {
            const point = pointAt(index, 100);
            return (
              <line
                key={dimension.key}
                x1={CENTER}
                x2={point.x}
                y1={CENTER}
                y2={point.y}
              />
            );
          })}
        </g>

        <polygon
          className="ability-radar-target"
          data-testid="ability-target-polygon"
          points={polygonPoints(dimensions.map((dimension) => dimension.target_score))}
        />
        <polygon
          className="ability-radar-current"
          data-testid="ability-current-polygon"
          points={polygonPoints(dimensions.map((dimension) => dimension.score))}
        />

        <g className="ability-radar-points">
          {dimensions.map((dimension, index) => {
            const point = pointAt(index, dimension.score);
            const selected = dimension.key === selectedKey;
            return (
              <circle
                key={dimension.key}
                className={selected ? "is-selected" : undefined}
                cx={point.x}
                cy={point.y}
                r={selected ? 7 : 5}
              />
            );
          })}
        </g>

        <g className="ability-radar-labels" aria-hidden="true">
          {dimensions.map((dimension, index) => {
            const point = pointAt(index, 100, LABEL_RADIUS);
            return (
              <text
                key={dimension.key}
                dominantBaseline="middle"
                textAnchor="middle"
                x={point.x}
                y={point.y}
              >
                <tspan x={point.x}>{dimension.label}</tspan>
                <tspan className="ability-radar-label-score" dy="18" x={point.x}>
                  {dimension.score}
                </tspan>
              </text>
            );
          })}
        </g>
      </svg>

      {!compact
        ? dimensions.map((dimension, index) => {
            const point = pointAt(index, dimension.score);
            const selected = dimension.key === selectedKey;
            return (
              <button
                key={dimension.key}
                aria-label={`查看${dimension.label}能力`}
                aria-pressed={selected}
                className={`ability-radar-point-button${selected ? " is-selected" : ""}`}
                onClick={() => onSelect(dimension.key)}
                style={{
                  left: `${(point.x / VIEWBOX_SIZE) * 100}%`,
                  top: `${(point.y / VIEWBOX_SIZE) * 100}%`,
                }}
                title={`${dimension.label}：${dimension.score} 分`}
                type="button"
              />
            );
          })
        : null}
    </div>
  );
}
