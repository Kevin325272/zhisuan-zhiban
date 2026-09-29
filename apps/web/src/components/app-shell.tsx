import {
  Bell,
  BrainCircuit,
  FlaskConical,
  Gauge,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import type { PlatformRole } from "@xuetu/contracts";

import { useAuth } from "../features/auth/auth-context";
import { clearDemoSession } from "../features/auth/demo-session";
import { GlobalAgentFab } from "../features/agent/global-agent-fab";

interface NavigationItem {
  id: string;
  label: string;
  agent: string;
  href: string;
  icon: LucideIcon;
  roles?: PlatformRole[];
}

const navigationItems: NavigationItem[] = [
  { id: "agent-tutor", label: "智能伴学中枢", agent: "Tutor-Agent", href: "/student/courses", icon: Sparkles },
  { id: "agent-lab", label: "3D 具身仿真沙盒", agent: "Lab-Agent", href: "/student/programming-experiments", icon: FlaskConical },
  { id: "agent-memory", label: "认知记忆管理", agent: "Memory-Agent", href: "/student/memory-cards", icon: BrainCircuit },
  { id: "agent-decision", label: "教师教研中枢", agent: "Decision-Agent", href: "/teacher", icon: Gauge, roles: ["teacher"] },
];

function NavigationLink({ item, active, onNavigate }: { item: NavigationItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active ? "is-active" : undefined}
      onClick={onNavigate}
      to={item.href}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
      <span className="nav-copy">
        <strong>{item.label}</strong>
        <small>{item.agent}</small>
      </span>
    </Link>
  );
}

function navigationSection(path: string) {
  if (path.startsWith("/student/programming-experiments") || path.includes("/experiments/")
    || path.startsWith("/student/tasks/") || path === "/student/test-lab") return "agent-lab";
  if (path.startsWith("/student/courses") || path === "/student/materials"
    || path === "/student/course-map" || path === "/student/question-map") return "agent-tutor";
  if (path === "/student/memory-cards") return "agent-memory";
  if (path === "/teacher" || path.startsWith("/teacher/")) return "agent-decision";
  return null;
}

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const isCodingTask = location.pathname.includes("/student/tasks/")
    || location.pathname.includes("/student/courses/data-structures/experiments/");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const activeSection = navigationSection(location.pathname);
  const visibleItems = navigationItems.filter((item) => !item.roles
    || item.roles.some((role) => auth.account?.roles.includes(role) ?? false));

  useEffect(() => {
    setMenuOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        if (menuOpen) {
          setMenuOpen(false);
          menuButtonRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <div
      className="app-shell learning-shell"
      data-workspace={isCodingTask ? "focused" : "standard"}
      data-visual-system="ochre-serif"
      data-testid="app-shell"
    >
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="topbar" ref={headerRef}>
        <div className="learning-topbar-inner">
        <Link className="brand" to="/student/home" aria-label="智算智伴学生端首页">
          <span className="brand-mark">
            <Sparkles aria-hidden="true" size={16} />
          </span>
          <span className="brand-copy">
            <strong>智算智伴</strong>
          </span>
        </Link>

        <button aria-controls="learning-main-navigation" aria-expanded={menuOpen}
          aria-label={menuOpen ? "收起主导航" : "展开主导航"} className="learning-menu-toggle"
          onClick={() => { setMenuOpen((open) => !open); setNotificationsOpen(false); }}
          ref={menuButtonRef} title={menuOpen ? "收起主导航" : "展开主导航"} type="button">
          {menuOpen ? <X aria-hidden="true" size={21} /> : <Menu aria-hidden="true" size={21} />}
        </button>

        <nav aria-label="主导航" className="learning-main-nav" data-open={menuOpen} id="learning-main-navigation">
          <ul>
            {visibleItems.map((item) => (
              <li key={item.id}>
                <NavigationLink item={item} active={activeSection === item.id} onNavigate={() => setMenuOpen(false)} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="topbar-actions">
          <div className="notification-center" ref={notificationRef}>
            <button
              aria-controls="learning-notifications"
              aria-expanded={notificationsOpen}
              aria-label="查看通知，无未读"
              className="icon-button topbar-icon"
              onClick={() => { setNotificationsOpen((current) => !current); setMenuOpen(false); }}
              title="通知"
              type="button"
            >
              <Bell aria-hidden="true" size={18} />
            </button>

            {notificationsOpen ? (
              <section
                aria-label="学习通知"
                className="notification-popover"
                id="learning-notifications"
                role="region"
              >
                <header>
                  <div>
                    <strong>学习通知</strong>
                  </div>
                </header>
                <div className="notification-empty"><span><Bell aria-hidden="true" size={25} /></span><strong>暂无未读通知</strong><p>安心学习，稍后再来看看。</p></div>
              </section>
            ) : null}
          </div>
          <Link aria-label="账户设置" className="icon-button topbar-icon" title="账户设置" to="/student/account">
            <Settings aria-hidden="true" size={18} />
          </Link>
          <Link className="profile-summary" to="/student/profile" aria-label="打开我的学习">
            <span className="profile-avatar">{auth.account?.display_name.slice(0, 1) ?? "学"}</span>
            <span className="profile-summary-copy">
              <strong>{auth.account?.display_name ?? "学习账户"}</strong>
            </span>
          </Link>
          <Link
            aria-label="退出登录"
            className="icon-button topbar-icon"
            onClick={(event) => { event.preventDefault(); if (!auth.isProviderMounted) clearDemoSession(); void auth.logout().then(() => navigate("/login", { replace: true })); }}
            title="退出登录"
            to="/login"
          >
            <LogOut aria-hidden="true" size={18} />
          </Link>
        </div>
        </div>
      </header>

      <div className="shell-body">
        <main className="page-content" id="main-content">
          <Outlet />
        </main>
      </div>

      <GlobalAgentFab hidden={isCodingTask} />

    </div>
  );
}
