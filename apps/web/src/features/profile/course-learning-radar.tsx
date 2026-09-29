import type {
  PersonalLearningDimension,
  PersonalLearningDimensionKey,
} from "@xuetu/contracts";

interface CourseLearningRadarProps {
  courseTitle: string;
  dimensions: PersonalLearningDimension[];
  selectedKey: PersonalLearningDimensionKey | null;
  onSelect: (key: PersonalLearningDimensionKey) => void;
}

const VIEWBOX_SIZE = 460;
const CENTER = VIEWBOX_SIZE / 2;
const RADIUS = 142;
const LABEL_RADIUS = 188;

function pointAt(index: number, value: number, radius = RADIUS) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
  const scaled = (Math.max(0, Math.min(value, 100)) / 100) * radius;
  return {
    x: CENTER + Math.cos(angle) * scaled,
    y: CENTER + Math.sin(angle) * scaled,
  };
}

function polygonPoints(values: Array<number | null>, radius = RADIUS) {
  return values.map((value, index) => {
    const point = pointAt(index, value ?? 0, radius);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

export function CourseLearningRadar({
  courseTitle,
  dimensions,
  selectedKey,
  onSelect,
}: CourseLearningRadarProps) {
  if (dimensions.length !== 5) {
    return <div role="alert">课程画像维度数据不完整</div>;
  }

  return (
    <div className="course-learning-radar">
      <svg
        aria-label={`${courseTitle}课程学习画像`}
        className="course-learning-radar-svg"
        role="img"
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      >
        <g className="course-radar-grid">
          {[20, 40, 60, 80, 100].map((value) => (
            <polygon key={value} points={polygonPoints(Array(5).fill(value))} />
          ))}
        </g>
        <g className="course-radar-axes">
          {dimensions.map((dimension, index) => {
            const point = pointAt(index, 100);
            return <line key={dimension.key} x1={CENTER} x2={point.x} y1={CENTER} y2={point.y} />;
          })}
        </g>
        <polygon
          className="course-radar-area"
          points={polygonPoints(dimensions.map((dimension) => dimension.score))}
        />
        <g className="course-radar-points">
          {dimensions.map((dimension, index) => {
            if (dimension.score === null) return null;
            const point = pointAt(index, dimension.score);
            return (
              <circle
                className={dimension.key === selectedKey ? "is-selected" : undefined}
                cx={point.x}
                cy={point.y}
                key={dimension.key}
                r={dimension.key === selectedKey ? 7 : 5}
              />
            );
          })}
        </g>
        <g aria-hidden="true" className="course-radar-labels">
          {dimensions.map((dimension, index) => {
            const point = pointAt(index, 100, LABEL_RADIUS);
            return (
              <text dominantBaseline="middle" key={dimension.key} textAnchor="middle" x={point.x} y={point.y}>
                <tspan x={point.x}>{dimension.label}</tspan>
                <tspan className="course-radar-label-score" dy="19" x={point.x}>
                  {dimension.score === null ? "待积累" : `${dimension.score}%`}
                </tspan>
              </text>
            );
          })}
        </g>
      </svg>

      <div aria-label="选择画像维度" className="course-radar-dimension-controls">
        {dimensions.map((dimension) => (
          <button
            aria-pressed={selectedKey === dimension.key}
            className={selectedKey === dimension.key ? "active" : undefined}
            key={dimension.key}
            onClick={() => onSelect(dimension.key)}
            type="button"
          >
            <span>{dimension.label}</span>
            <strong>{dimension.score === null ? "待积累" : `${dimension.score}%`}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
