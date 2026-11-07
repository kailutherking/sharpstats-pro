import { render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("shows a formatted metric label and context", () => {
    render(<StatCard title="Return on investment" value="+12.4%" note="Yield on settled stake" icon={<span />} positive />);

    expect(screen.getByText("Return on investment")).toBeInTheDocument();
    expect(screen.getByText("+12.4%")).toBeInTheDocument();
    expect(screen.getByText("Yield on settled stake")).toBeInTheDocument();
  });
});
