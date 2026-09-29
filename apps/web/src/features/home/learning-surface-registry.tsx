import { ArrowRight, Braces, Cpu, Database, Network } from "lucide-react";
import type { ReactNode } from "react";

import { BfsAlgorithmSurface } from "./bfs-algorithm-surface";
import type { LearningRendererType, LearningSession } from "./learning-session";

interface LearningSurfaceProps {
  session: LearningSession;
}

interface SurfaceFrameProps {
  eyebrow: string;
  icon: ReactNode;
  label: string;
  note: string;
  children: ReactNode;
}

function SurfaceFrame({ eyebrow, icon, label, note, children }: SurfaceFrameProps) {
  return (
    <section aria-label={label} className="learning-surface">
      <header className="learning-surface-head">
        <div className="learning-surface-title">
          <span aria-hidden="true">{icon}</span>
          <div>
            <small>{eyebrow}</small>
            <strong>当前任务学习面</strong>
          </div>
        </div>
        <span className="learning-surface-mode">{note}</span>
      </header>
      <div className="learning-surface-body">{children}</div>
    </section>
  );
}

function DatabaseSurface({ session }: LearningSurfaceProps) {
  return (
    <SurfaceFrame
      eyebrow="SQL LAB"
      icon={<Database size={17} />}
      label="数据库查询工作面"
      note="SQL 查询演练"
    >
      <div className="database-demo-schema">
        <article><strong>student</strong><span>id · name</span></article>
        <ArrowRight aria-hidden="true" size={18} />
        <article><strong>enrollment</strong><span>student_id · course_id</span></article>
        <ArrowRight aria-hidden="true" size={18} />
        <article><strong>course</strong><span>id · title</span></article>
      </div>
      <div className="database-demo-grid">
        <pre aria-label="SQL 示例"><code>
          <span className="sql-comment">-- 课程选课关系</span>{`\n`}
          <span className="sql-keyword">SELECT</span>{" "}<span className="sql-field">s.name</span>, <span className="sql-field">c.title</span>{`\n`}
          <span className="sql-keyword">FROM</span>{" "}<span className="sql-table">student</span> s{`\n`}
          <span className="sql-keyword">INNER JOIN</span>{" "}<span className="sql-table">enrollment</span> e <span className="sql-keyword">ON</span>{" "}<span className="sql-field">s.id</span> <span className="sql-operator">=</span> <span className="sql-field">e.student_id</span>{`\n`}
          <span className="sql-keyword">JOIN</span>{" "}<span className="sql-table">course</span> c <span className="sql-keyword">ON</span>{" "}<span className="sql-field">e.course_id</span> <span className="sql-operator">=</span> <span className="sql-field">c.id</span>{`\n`}
          <span className="sql-keyword">WHERE</span>{" "}<span className="sql-field">c.title</span> <span className="sql-operator">=</span> <span className="sql-string">'数据库原理'</span>;
        </code></pre>
        <div className="database-demo-result">
          <strong>查询结果预览</strong>
          <table>
            <thead><tr><th>name</th><th>title</th></tr></thead>
            <tbody><tr><td>林晓</td><td>数据库原理</td></tr><tr><td>周宁</td><td>数据库原理</td></tr></tbody>
          </table>
        </div>
      </div>
      <p className="surface-callout">{session.task.summary}</p>
    </SurfaceFrame>
  );
}

function SystemsSurface({ session }: LearningSurfaceProps) {
  return (
    <SurfaceFrame
      eyebrow="SYSTEM STATE"
      icon={<Cpu size={17} />}
      label="机制状态工作面"
      note="进程状态演练"
    >
      <div className="systems-demo-flow" aria-label="进程状态迁移">
        <span>就绪态</span><ArrowRight aria-hidden="true" size={18} /><span className="is-current">运行态</span><ArrowRight aria-hidden="true" size={18} /><span>时间片耗尽</span>
      </div>
      <div className="systems-demo-state">
        <article><small>CPU</small><strong>P2</strong><span>剩余 0 ms</span></article>
        <article><small>就绪队列</small><strong>P3 → P1 → P2</strong><span>P2 回到队尾</span></article>
        <article><small>下一事件</small><strong>调度 P3</strong><span>保存并恢复上下文</span></article>
      </div>
      <p className="surface-callout">{session.task.summary}</p>
    </SurfaceFrame>
  );
}

function NetworkSurface({ session }: LearningSurfaceProps) {
  return (
    <SurfaceFrame
      eyebrow="PACKET PATH"
      icon={<Network size={17} />}
      label="网络路径工作面"
      note="路由决策演练"
    >
      <div className="network-demo-rule"><small>当前规则</small><strong>最长前缀匹配：10.2.0.0/16</strong></div>
      <div className="network-demo-path" aria-label="报文转发路径">
        <article><small>Host A</small><strong>10.1.0.8</strong></article>
        <ArrowRight aria-hidden="true" size={20} />
        <article><small>Router A</small><strong>Gi0/1</strong></article>
        <ArrowRight aria-hidden="true" size={20} />
        <article className="is-current"><small>Router B</small><strong>下一跳 10.2.0.1</strong></article>
        <ArrowRight aria-hidden="true" size={20} />
        <article><small>Host B</small><strong>10.2.1.9</strong></article>
      </div>
      <p className="surface-callout">{session.task.summary}</p>
    </SurfaceFrame>
  );
}

function SoftwareSurface({ session }: LearningSurfaceProps) {
  return (
    <SurfaceFrame
      eyebrow="CODE REVIEW"
      icon={<Braces size={17} />}
      label="程序设计工作面"
      note="测试用例演练"
    >
      <div className="software-demo-grid">
        <pre aria-label="待检查代码"><code>{"export function first(items: string[]) {\n  return items[0].trim();\n}"}</code></pre>
        <div className="software-demo-tests">
          <small>失败测试</small>
          <strong>空数组应返回 undefined</strong>
          <p><span>期望</span><code>undefined</code></p>
          <p><span>实际</span><code>TypeError</code></p>
        </div>
      </div>
      <p className="surface-callout">{session.task.summary}</p>
    </SurfaceFrame>
  );
}

const rendererRegistry: Record<LearningRendererType, (props: LearningSurfaceProps) => ReactNode> = {
  algorithm_trace: BfsAlgorithmSurface,
  database_lab: DatabaseSurface,
  systems_flow: SystemsSurface,
  network_path: NetworkSurface,
  software_practice: SoftwareSurface,
};

export function LearningSurface({ session }: LearningSurfaceProps) {
  const Renderer = rendererRegistry[session.renderer_type];
  return <Renderer session={session} />;
}
