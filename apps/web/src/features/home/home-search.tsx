import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BookOpen, Route, Sparkles } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  searchHomeIndex,
  type HomeIndexGroup,
  type HomeSearchItem,
} from "./home-index";

const groupOrder: HomeIndexGroup[] = ["课程与任务", "平台功能"];

const quickQueries = ["从零理解一个知识点", "分析一道错题", "根据课件制定路径"];

interface HomeSearchProps {
  courseTitle?: string;
}

function groupResults(results: HomeSearchItem[]) {
  return groupOrder
    .map((group) => ({
      group,
      items: results.filter((item) => item.group === group),
    }))
    .filter((section) => section.items.length > 0);
}

export function HomeSearch({ courseTitle }: HomeSearchProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const normalizedQuery = query.trim();
  const results = useMemo(() => searchHomeIndex(query), [query]);
  const groupedResults = useMemo(() => groupResults(results), [results]);
  const destinations = useMemo(
    () => [
      ...results.map((item) => item.href),
      ...(normalizedQuery && results.length === 0 ? ["/student/courses"] : []),
    ],
    [normalizedQuery, results],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleShortcut);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (searchParams.get("focus") !== "search") return;

    inputRef.current?.focus();
    setIsOpen(true);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("focus");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const moveActive = (direction: 1 | -1) => {
    if (!isOpen) {
      setIsOpen(true);
    }

    if (destinations.length === 0) {
      return;
    }

    setActiveIndex((current) => {
      if (current < 0) {
        return direction === 1 ? 0 : destinations.length - 1;
      }

      return (current + direction + destinations.length) % destinations.length;
    });
  };

  const openDestination = (href: string) => {
    setIsOpen(false);
    navigate(href);
  };

  const submitCurrent = () => {
    const href =
      destinations[activeIndex] ??
      (normalizedQuery && results.length === 0 ? "/student/courses" : results[0]?.href);

    if (href) {
      openDestination(href);
    }
  };

  return (
    <div className="home-search" ref={rootRef}>
      <form
        className="home-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitCurrent();
        }}
      >
        <div className="home-search-input-row">
          <Sparkles aria-hidden="true" size={22} strokeWidth={1.8} />
          <input
            ref={inputRef}
            aria-controls={isOpen ? "home-search-results" : undefined}
            aria-expanded={isOpen}
            aria-label="检索平台内容"
            autoComplete="off"
            name="home-search"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(-1);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActive(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(-1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setIsOpen(false);
                setActiveIndex(-1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                submitCurrent();
              }
            }}
            placeholder="搜索课程、知识点、练习或学习记录…"
            type="search"
            value={query}
          />
          <span className="home-search-shortcut" aria-hidden="true">
            Ctrl K
          </span>
        </div>

        <div className="home-search-toolbar">
          <div className="home-search-context">
            {courseTitle ? (
              <span>
                <BookOpen aria-hidden="true" size={14} />
                当前课程：{courseTitle}
              </span>
            ) : null}
            <span>
              <Route aria-hidden="true" size={14} />
              自动判断学习起点
            </span>
          </div>
          <button className="home-search-submit" type="submit" aria-label="发起学习">
            <ArrowUp aria-hidden="true" size={19} />
          </button>
        </div>
      </form>

      <div className="home-search-quick" aria-label="快捷检索">
        <span>可以这样问</span>
        {quickQueries.map((quickQuery) => (
          <button
            key={quickQuery}
            type="button"
            onClick={() => {
              setQuery(quickQuery);
              setActiveIndex(-1);
              setIsOpen(true);
              inputRef.current?.focus();
            }}
          >
            {quickQuery}
          </button>
        ))}
      </div>

      {isOpen ? (
        <div
          aria-label="检索结果"
          className="home-search-results"
          id="home-search-results"
          role="region"
        >
          <div className="home-search-results-head">
            <span>{normalizedQuery ? `“${normalizedQuery}” 的结果` : "常用入口"}</span>
            <span>{results.length} 个匹配</span>
          </div>

          {groupedResults.map((section) => (
            <section className="home-search-group" key={section.group}>
              <h3>{section.group}</h3>
              {section.items.map((item) => {
                const itemIndex = results.findIndex((result) => result.id === item.id);
                const Icon = item.icon;

                return (
                  <Link
                    className="home-search-result"
                    data-active={activeIndex === itemIndex ? "true" : undefined}
                    key={item.id}
                    onClick={() => setIsOpen(false)}
                    to={item.href}
                  >
                    <span className="home-search-result-icon">
                      <Icon aria-hidden="true" size={18} />
                    </span>
                    <span className="home-search-result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <ArrowRight aria-hidden="true" size={17} />
                  </Link>
                );
              })}
            </section>
          ))}

          {normalizedQuery && results.length === 0 ? (
            <Link
              className="home-search-ai"
              data-active={activeIndex === 0 ? "true" : undefined}
              onClick={() => setIsOpen(false)}
              to="/student/courses"
            >
              <span className="home-search-result-icon is-ai">
                <Sparkles aria-hidden="true" size={18} />
              </span>
              <span className="home-search-result-copy">
                <strong>浏览课程入口</strong>
                <small>从对应课程知识地图进入讲解、案例与训练</small>
              </span>
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
