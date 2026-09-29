import { ChevronRight, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { useCourseReaderControls } from "./course-reader-workspace";

interface CourseReaderHeadingProps {
  chapter: string;
  module: string;
  title: string;
}

export function CourseReaderHeading({ chapter, module, title }: CourseReaderHeadingProps) {
  const controls = useCourseReaderControls();
  return (
    <header className="course-reader-heading">
      <div>
        <p className="course-reader-breadcrumb">
          <span>{chapter}</span>
          <ChevronRight aria-hidden="true" size={13} />
          <span>{module}</span>
        </p>
        <h2>{title}</h2>
      </div>
      {controls ? <div className="course-reader-tools" aria-label="阅读工具">
        <div className="reader-font-controls" role="group" aria-label="正文字号">
          <button type="button" aria-label="缩小正文字号" disabled={controls.fontSize <= 16} onClick={() => controls.changeFontSize(controls.fontSize - 2)}><Minus aria-hidden="true" size={14} /></button>
          <button type="button" aria-label="恢复默认字号" title="恢复默认字号" onClick={() => controls.changeFontSize(18)}>{controls.fontSize}</button>
          <button type="button" aria-label="放大正文字号" disabled={controls.fontSize >= 22} onClick={() => controls.changeFontSize(controls.fontSize + 2)}><Plus aria-hidden="true" size={14} /></button>
        </div>
        <button type="button" className="reader-focus-toggle" data-reader-focus-toggle aria-pressed={controls.focused} onClick={controls.toggleFocus}>
          {controls.focused ? <Minimize2 aria-hidden="true" size={16} /> : <Maximize2 aria-hidden="true" size={16} />}
          {controls.focused ? "退出专注" : "专注阅读"}
        </button>
      </div> : null}
    </header>
  );
}
