import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function AuthGatewayLayout({
  children,
  registration = false,
}: {
  children: ReactNode;
  registration?: boolean;
}) {
  const titleId = registration ? "register-brand-title" : "login-title";

  return (
    <main className={registration ? "login-gateway registration-gateway" : "login-gateway"}>
      <header className="login-gateway-header">
        <div className="login-gateway-brand"><span><Sparkles aria-hidden="true" size={24} /></span>智算智伴</div>
        <span className="login-gateway-edition">408 考研学习平台</span>
      </header>
      <section className="login-gateway-content" aria-labelledby={titleId}>
        <div className="login-gateway-intro">
          <div className="login-gateway-pixels" aria-hidden="true" />
          <span className="login-gateway-subject">计算机学科专业基础</span>
          <h1 id={titleId}>智算<span>智伴</span><span className="login-gateway-number">408</span></h1>
          <p className="login-gateway-motto">把知识学懂，向目标靠近。</p>
          <ul className="login-gateway-courses" aria-label="核心课程">
            <li>数据结构</li><li>计算机组成原理</li><li>操作系统</li><li>计算机网络</li>
          </ul>
        </div>
        {children}
      </section>
    </main>
  );
}
