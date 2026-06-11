import { describe, expect, it } from "vitest";
import {
  isDsRole,
  isExternalFdeRole,
  isFdeRole,
  isOnboardingStatus,
  isMoveStatus,
  isVacationActive,
  parseTier,
  roleShort,
  safeText,
  statusClass,
} from "./helpers";

describe("role classification (exact match, not substring)", () => {
  it("recognizes literal FDE strings", () => {
    expect(isFdeRole("Forward Deployed Engineer")).toBe(true);
    expect(isFdeRole("FDE")).toBe(true);
    expect(isFdeRole("Forward Deployed Engineer - Solution")).toBe(true);
  });

  it("does NOT match unrelated 'engineer' strings", () => {
    expect(isFdeRole("Sales Engineer")).toBe(false);
    expect(isFdeRole("Customer Engineer")).toBe(false);
    expect(isFdeRole("Engineer")).toBe(false);
  });

  it("recognizes External FDE", () => {
    expect(isExternalFdeRole("External Forward Deployed Engineer")).toBe(true);
    expect(isExternalFdeRole("External FDE")).toBe(true);
    expect(isExternalFdeRole("Forward Deployed Engineer")).toBe(false);
  });

  it("recognizes DS", () => {
    expect(isDsRole("Deployment Strategist")).toBe(true);
    expect(isDsRole("DS")).toBe(true);
    expect(isDsRole("Strategist")).toBe(false);
  });

  it("roleShort short-codes the known roles", () => {
    expect(roleShort("Deployment Strategist")).toBe("DS");
    expect(roleShort("Forward Deployed Engineer")).toBe("FDE");
    expect(roleShort("External Forward Deployed Engineer")).toBe("External FDE");
    expect(roleShort("Field CTO, Israel")).toBe("Field CTO, Israel");
  });
});

describe("isVacationActive — string comparison, timezone-safe", () => {
  it("returns false for empty / missing", () => {
    expect(isVacationActive(null)).toBe(false);
    expect(isVacationActive("")).toBe(false);
    expect(isVacationActive(undefined)).toBe(false);
  });

  it("returns false for malformed strings", () => {
    expect(isVacationActive("not a date")).toBe(false);
  });

  it("compares the date prefix lexicographically", () => {
    expect(isVacationActive("2999-01-01", "2026-05-19")).toBe(true);
    expect(isVacationActive("2020-01-01", "2026-05-19")).toBe(false);
    expect(isVacationActive("2026-05-19", "2026-05-19")).toBe(true);
  });

  it("tolerates ISO timestamps by slicing", () => {
    expect(isVacationActive("2999-01-01T12:34:56Z", "2026-05-19")).toBe(true);
  });
});

describe("status / pipeline helpers", () => {
  it("isOnboardingStatus is case-insensitive exact match", () => {
    expect(isOnboardingStatus("Onboarding")).toBe(true);
    expect(isOnboardingStatus("ONBOARDING")).toBe(true);
    expect(isOnboardingStatus("active")).toBe(false);
  });

  it("isMoveStatus checks the literal move phrase", () => {
    expect(isMoveStatus("Move to other client")).toBe(true);
    expect(isMoveStatus("Moving")).toBe(false);
  });
});

describe("misc", () => {
  it("safeText falls back when empty", () => {
    expect(safeText("")).toBe("—");
    expect(safeText("  ")).toBe("—");
    expect(safeText("hi")).toBe("hi");
    expect(safeText(null, "n/a")).toBe("n/a");
  });

  it("parseTier extracts the first integer", () => {
    expect(parseTier("Tier 1")).toBe(1);
    expect(parseTier("Tier 12")).toBe(12);
    expect(parseTier("Unspecified")).toBe(999);
    expect(parseTier(null)).toBe(999);
  });

  it("statusClass maps known states", () => {
    expect(statusClass("Open")).toBe("danger");
    expect(statusClass("Onboarding")).toBe("warning");
    expect(statusClass("Active")).toBe("success");
    expect(statusClass("Mystery")).toBe("neutral");
  });
});
