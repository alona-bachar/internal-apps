import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SearchableOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
};

// In production the host mounts the app inside a Shadow DOM, so portaling to
// document.body escapes the scoped stylesheet. Anchor the portal to .app-root
// instead — it's inside the shadow root and owns the --app-* custom properties.
function getPortalTarget(node: Element | null): Element {
  if (!node) return document.body;
  return node.closest(".app-root") ?? document.body;
}

type SearchableSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyOption?: { value: string; label: string } | null;
  ariaLabel?: string;
  disabled?: boolean;
  extraTopOption?: { value: string; label: string };
};

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  emptyOption,
  ariaLabel,
  disabled,
  extraTopOption,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((o) => o.value === value);
  const displayText = selected?.label ?? emptyOption?.label ?? placeholder;
  const showsMuted = !selected;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q),
    );
  }, [query, options]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const node = triggerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      // Inside a Shadow DOM, listeners on `document` see event.target retargeted
      // to the shadow host. Use composedPath() to walk the true path so we can
      // detect clicks inside the popover (which is portaled to .app-root).
      const path = event.composedPath();
      if (triggerRef.current && path.includes(triggerRef.current)) return;
      if (popoverRef.current && path.includes(popoverRef.current)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const handlePick = (next: string, isDisabled?: boolean) => {
    if (isDisabled) return;
    onChange(next);
    setOpen(false);
  };

  const popover = open ? (
    <div
      ref={popoverRef}
      className="searchable-select-popover"
      role="listbox"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <input
        ref={searchRef}
        type="text"
        className="searchable-select-search"
        placeholder="Search…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && filtered.length > 0) {
            const first = filtered.find((o) => !o.disabled);
            if (first) handlePick(first.value);
          }
        }}
      />
      <div className="searchable-select-options">
        {extraTopOption ? (
          <button
            type="button"
            className="searchable-select-option extra"
            onClick={() => handlePick(extraTopOption.value)}
          >
            {extraTopOption.label}
          </button>
        ) : null}
        {emptyOption ? (
          <button
            type="button"
            className={`searchable-select-option${value === emptyOption.value ? " selected" : ""}`}
            onClick={() => handlePick(emptyOption.value)}
          >
            {emptyOption.label}
          </button>
        ) : null}
        {filtered.length === 0 ? (
          <div className="searchable-select-empty muted">No matches</div>
        ) : (
          filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`searchable-select-option${option.disabled ? " disabled" : ""}${value === option.value ? " selected" : ""}`}
              disabled={option.disabled}
              title={option.disabled ? option.disabledReason : undefined}
              onClick={() => handlePick(option.value, option.disabled)}
            >
              <span className="searchable-select-option-label">{option.label}</span>
              {option.hint ? <span className="searchable-select-option-hint muted">{option.hint}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={`searchable-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="searchable-select-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className={showsMuted ? "muted" : ""}>{displayText}</span>
        <span className="searchable-caret" aria-hidden>▾</span>
      </button>
      {popover ? createPortal(popover, getPortalTarget(triggerRef.current)) : null}
    </div>
  );
}
