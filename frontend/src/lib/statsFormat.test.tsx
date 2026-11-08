import { formatStat, formatUpdated, toCsv } from "./statsFormat";
import { matchesQuery } from "../components/stats/StatsSearch";

describe("stats formatting", () => {
  it("formats stat styles", () => {
    expect(formatStat(0.3125, "rate3")).toBe(".313");
    expect(formatStat(49.77, "pct1")).toBe("49.8%");
    expect(formatStat(-3, "signed")).toBe("-3");
    expect(formatStat(6 + 1 / 3, "innings")).toBe("6.1");
    expect(formatStat(23.5, "minutes")).toBe("23:30");
    expect(formatStat(null, "int")).toBe("—");
  });

  it("formats the last-updated stamp as MM/DD/YYYY HH:MM", () => {
    expect(formatUpdated(new Date(2026, 10, 8, 9, 5).toISOString())).toBe("11/08/2026 09:05");
    expect(formatUpdated(undefined)).toBe("—");
  });

  it("escapes CSV cells and neutralizes spreadsheet formulas", () => {
    expect(toCsv(["Name", "Note"], [["Smith, Jr.", "=HYPERLINK()"], ["A \"B\"", -3]])).toBe('Name,Note\n"Smith, Jr.",\'=HYPERLINK()\n"A ""B""",-3');
  });

  it("matches search queries across fields", () => {
    expect(matchesQuery("lak", "Luka Doncic", "Los Angeles Lakers")).toBe(true);
    expect(matchesQuery("  ", "anything")).toBe(true);
    expect(matchesQuery("bos", "Luka Doncic", "LAL")).toBe(false);
  });
});
