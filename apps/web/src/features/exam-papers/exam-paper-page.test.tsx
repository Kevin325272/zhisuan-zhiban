import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getExamPapers: vi.fn(),
  getExamPaperDetail: vi.fn(),
  getExamPaperPdf: vi.fn(),
}));

vi.mock("./exam-paper-client", () => apiMocks);

import { ExamPaperPage } from "./exam-paper-page";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe("ExamPaperPage", () => {
  beforeEach(() => {
    apiMocks.getExamPapers.mockReset();
    apiMocks.getExamPaperDetail.mockReset();
    apiMocks.getExamPaperPdf.mockReset();
  });

  it("redirects the retired student URL to the real past-exam library", async () => {
    render(
      <MemoryRouter initialEntries={["/student/exam-papers"]}>
        <ExamPaperPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/student/practice?mode=past_exam",
      );
    });
    expect(apiMocks.getExamPapers).not.toHaveBeenCalled();
    expect(apiMocks.getExamPaperDetail).not.toHaveBeenCalled();
    expect(apiMocks.getExamPaperPdf).not.toHaveBeenCalled();
  });
});
