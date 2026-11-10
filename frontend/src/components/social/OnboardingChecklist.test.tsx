import { fireEvent, render, screen } from "@testing-library/react";
import type { MyProfile } from "../../lib/socialTypes";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { ratio, units } from "./socialUi";

const me = (done: boolean[], dismissed = false) => ({
  onboarding: { dismissed, steps: ["profile", "follow", "alert", "pick"].map((key, index) => ({ key, label: `Step ${key}`, done: done[index]! })) },
}) as unknown as MyProfile;

describe("OnboardingChecklist", () => {
  it("shows progress and routes unfinished steps", () => {
    const onGo = jest.fn();
    render(<OnboardingChecklist me={me([true, false, false, false])} onGo={onGo} onDismiss={() => undefined} />);
    expect(screen.getByText(/1 of 4 done/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Step alert"));
    expect(onGo).toHaveBeenCalledWith("Odds screen");
  });

  it("hides when finished or dismissed", () => {
    const { container, rerender } = render(<OnboardingChecklist me={me([true, true, true, true])} onGo={() => undefined} onDismiss={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OnboardingChecklist me={me([false, false, false, false], true)} onGo={() => undefined} onDismiss={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("formats units and rates", () => {
    expect(units(1.5)).toBe("+1.50u");
    expect(units(-2)).toBe("-2.00u");
    expect(ratio(0.2733)).toBe("27.3%");
    expect(ratio(null)).toBe("—");
  });
});
