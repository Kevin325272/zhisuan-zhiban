import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GradientButton } from "./gradient-button";

describe("GradientButton", () => {
  it("supports the branded compact variant", () => {
    render(
      <GradientButton variant="variant" size="compact">
        提交评测
      </GradientButton>,
    );

    expect(screen.getByRole("button", { name: "提交评测" })).toHaveClass(
      "gradient-button",
      "gradient-button-variant",
      "gradient-button-compact",
      "min-h-[38px]",
    );
  });

  it("can pass its styling to a child element", () => {
    render(
      <GradientButton asChild>
        <a href="/student/ask">进入助教</a>
      </GradientButton>,
    );

    const link = screen.getByRole("link", { name: "进入助教" });
    expect(link).toHaveAttribute("href", "/student/ask");
    expect(link).toHaveClass("gradient-button");
  });
});
