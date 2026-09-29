import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TestLabPage } from "./test-lab-page";

describe("TestLabPage", () => {
  it("redirects the retired static examples to the 3D virtual laboratory", async () => {
    render(
      <MemoryRouter initialEntries={["/student/test-lab"]}>
        <Routes>
          <Route element={<TestLabPage />} path="/student/test-lab" />
          <Route element={<h1>408 三门课程 3D 仿真中心</h1>} path="/student/programming-experiments" />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "408 三门课程 3D 仿真中心" })).toBeInTheDocument();
    expect(screen.queryByText("6 / 8")).not.toBeInTheDocument();
  });
});
