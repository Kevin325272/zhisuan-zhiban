import { render, screen } from "@testing-library/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./app-error-boundary";

class BrokenChild extends Component {
  render(): ReactNode {
    throw new Error("render failed");
  }
}

describe("AppErrorBoundary", () => {
  it("shows a recoverable page instead of leaving the app blank", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "页面暂时无法显示" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载页面" })).toBeInTheDocument();
    expect(screen.getByText("刚才的页面遇到了一点问题，请重新加载后继续。")).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
