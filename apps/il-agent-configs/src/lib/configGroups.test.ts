import { describe, expect, it } from "vitest";
import { classify, humanizeLabel, formatValue, SECTION_ORDER, SECTIONS, isObserver, isBackoffice, showLatency, hiddenSections } from "./configGroups";

describe("isObserver", () => {
  it("matches the Observer agent type case-insensitively", () => {
    expect(isObserver("Observer")).toBe(true);
    expect(isObserver("observer")).toBe(true);
    expect(isObserver("OBSERVER")).toBe(true);
  });

  it("is false for other agent types and nullish values", () => {
    expect(isObserver("Backoffice")).toBe(false);
    expect(isObserver("Inbound Call")).toBe(false);
    expect(isObserver(null)).toBe(false);
    expect(isObserver(undefined)).toBe(false);
    expect(isObserver("")).toBe(false);
  });

  it("hides LLM and TTS / Voice for observers (STT is the only relevant model)", () => {
    expect(hiddenSections("Observer")).toEqual(["LLM", "TTS / Voice"]);
    expect(hiddenSections("Observer")).not.toContain("STT");
  });
});

describe("isBackoffice", () => {
  it("matches Backoffice case-insensitively and nothing else", () => {
    expect(isBackoffice("Backoffice")).toBe(true);
    expect(isBackoffice("backoffice")).toBe(true);
    expect(isBackoffice("Observer")).toBe(false);
    expect(isBackoffice(null)).toBe(false);
  });

  it("hides STT and TTS / Voice for backoffice (keeps LLM — the task model lives there)", () => {
    expect(hiddenSections("Backoffice")).toEqual(["STT", "TTS / Voice"]);
    expect(hiddenSections("Backoffice")).not.toContain("LLM");
  });
});

describe("showLatency", () => {
  it("is true only for live voice call types (and unknown)", () => {
    expect(showLatency("Inbound Call")).toBe(true);
    expect(showLatency("Outbound Call")).toBe(true);
    expect(showLatency(null)).toBe(true);
  });

  it("is false for observer, backoffice, and chat (no/negligible live turns)", () => {
    expect(showLatency("Observer")).toBe(false);
    expect(showLatency("Backoffice")).toBe(false);
    expect(showLatency("Chat")).toBe(false);
  });
});

describe("hiddenSections", () => {
  it("returns no hidden sections for call/chat/unknown types", () => {
    expect(hiddenSections("Inbound Call")).toEqual([]);
    expect(hiddenSections("Chat")).toEqual([]);
    expect(hiddenSections(null)).toEqual([]);
  });

  it("only ever hides real sections", () => {
    for (const t of ["Observer", "Backoffice"]) {
      for (const s of hiddenSections(t)) expect(SECTIONS).toContain(s);
    }
  });
});

describe("classify", () => {
  it("routes by ordered rules, specific before broad", () => {
    expect(classify("IS_MULTI_SKILL")).toBe("Skills Behavior");
    expect(classify("SWITCH_MODE")).toBe("Skills Behavior");
    expect(classify("LLM_MODEL")).toBe("LLM");
    expect(classify("TRANSCRIBER_PRIMARY_PROVIDER")).toBe("STT");
    expect(classify("VOICE_SELECTED_PROVIDER")).toBe("TTS / Voice");
    expect(classify("EOT_MODEL")).toBe("Turn-taking");
    expect(classify("INTERRUPT_MIN_WORDS_FOR_SUBSTANTIAL")).toBe("Turn-taking");
    expect(classify("ATTACHMENTS_LLM_MODEL")).toBe("Attachments");
    expect(classify("AGENT_NAME")).toBe("Details");
    expect(classify("SOMETHING_UNKNOWN")).toBe("Other");
  });

  it("resolves the translation/locale collisions deterministically", () => {
    // translation is a transcription concern -> STT, before Multilingual
    expect(classify("TRANSLATION_LANGUAGE")).toBe("STT");
    expect(classify("ENABLE_TRANSCRIPTION_TRANSLATION")).toBe("STT");
    // locale keys reach Multilingual because Details no longer claims bare LOCALE
    expect(classify("DEFAULT_LOCALE")).toBe("Multilingual");
    expect(classify("ENABLED_LOCALES")).toBe("Multilingual");
    expect(classify("LOCALE")).toBe("Multilingual");
  });
});

describe("humanizeLabel", () => {
  it("Title-cases the full key, no prefix stripping", () => {
    expect(humanizeLabel("TRANSCRIBER_PRIMARY_PROVIDER")).toBe("Transcriber Primary Provider");
    expect(humanizeLabel("MODE")).toBe("Mode");
  });
});

describe("formatValue", () => {
  it("renders scalars inline", () => {
    expect(formatValue("gpt-4o")).toEqual({ text: "gpt-4o", structured: false });
    expect(formatValue(true)).toEqual({ text: "true", structured: false });
    expect(formatValue(42)).toEqual({ text: "42", structured: false });
  });
  it("marks objects/arrays structured with a truncated preview", () => {
    const r = formatValue({ a: 1, b: 2 });
    expect(r.structured).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(120);
  });
});

describe("section invariants", () => {
  it("SECTION_ORDER contains exactly the classifiable sections", () => {
    expect([...SECTION_ORDER].sort()).toEqual([...SECTIONS].sort());
  });
});
