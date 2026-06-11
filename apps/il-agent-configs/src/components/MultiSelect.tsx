import { useEffect, useRef, useState } from "react";

// A compact multi-select dropdown used by the model filters (LLM/STT/TTS).
// Trigger button summarizes the selection ("LLM: all" / a single value / "N
// selected"); the popover lists options as checkboxes so several models can be
// active at once (OR within one kind). Closes on outside click or Escape.
//
// Positioning: the popover is position:absolute relative to this component's
// wrapper, so it anchors flush under the trigger natively — no JS coordinate
// math. (Earlier position:fixed attempts misbehaved because an app-shell
// ancestor has a CSS `transform`, which makes fixed resolve relative to that
// element, not the viewport.) For the popover not to be clipped, the toolbar
// must not have an overflow clip — see `.toolbar-card` in style.css.
export function MultiSelect(props: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { label, options, selected, onChange } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    // Focus the search box when the popover opens, matching native combobox UX.
    requestAnimationFrame(() => searchRef.current?.focus());
    // Use composedPath() rather than e.target: the app runs inside a Shadow DOM,
    // so document-level events have their target retargeted to the shadow host.
    // composedPath() pierces the boundary and lists the real clicked elements.
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !e.composedPath().includes(rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    selected.length === 0 ? "all"
    : selected.length === 1 ? selected[0]
    : `${selected.length} selected`;

  const toggle = (m: string) =>
    onChange(selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((m) => m.toLowerCase().includes(needle)) : options;

  return (
    <div className="multi-select" ref={rootRef}>
      <button
        type="button"
        className={`filter-select multi-select-trigger ${selected.length > 0 ? "is-active" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={selected.length > 1 ? selected.join(", ") : undefined}
      >
        <span className="multi-select-text">{label}: {summary}</span>
        <span className="multi-select-caret">▾</span>
      </button>
      {open && (
        <div className="multi-select-pop" role="listbox" aria-multiselectable="true">
          <input
            ref={searchRef}
            className="multi-select-search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="multi-select-list">
            {visible.length === 0 ? (
              <div className="multi-select-empty">{options.length === 0 ? "No options" : "No matches"}</div>
            ) : (
              visible.map((m) => (
                <label key={m} className="multi-select-opt">
                  <input
                    type="checkbox"
                    checked={selected.includes(m)}
                    onChange={() => toggle(m)}
                  />
                  <span className="multi-select-opt-text">{m}</span>
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <button type="button" className="multi-select-clear" onClick={() => onChange([])}>
              Clear ({selected.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
