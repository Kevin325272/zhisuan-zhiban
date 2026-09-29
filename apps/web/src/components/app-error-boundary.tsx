import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Keep the diagnostic in the browser console without exposing internals in the UI.
    console.error("智算智伴页面渲染失败", error, errorInfo);
  }

  private reloadPage = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-error-page" role="alert">
        <div className="app-error-panel">
          <span className="app-error-kicker">智算智伴</span>
          <h1>页面暂时无法显示</h1>
          <p>刚才的页面遇到了一点问题，请重新加载后继续。</p>
          <button onClick={this.reloadPage} type="button">
            重新加载页面
          </button>
        </div>
      </main>
    );
  }
}
