import { useEffect, useRef, useState } from "react";

type SelectOption = { value: string; label: string };

type CommonProps = {
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
  ariaLabel?: string;
};

type TextProps = CommonProps & {
  kind: "text" | "date" | "number";
  value: string;
  onCommit: (value: string) => void | Promise<void>;
  placeholder?: string;
};

type SelectProps = CommonProps & {
  kind: "select";
  value: string;
  options: SelectOption[];
  onCommit: (value: string) => void | Promise<void>;
};

type TextareaProps = CommonProps & {
  kind: "textarea";
  value: string;
  onCommit: (value: string) => void | Promise<void>;
  rows?: number;
  placeholder?: string;
};

type InlineEditFieldProps = TextProps | SelectProps | TextareaProps;

export function InlineEditField(props: InlineEditFieldProps) {
  const [draft, setDraft] = useState(props.value ?? "");
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(props.value ?? "");
  }, [props.value]);

  const commitIfChanged = (next: string) => {
    if (next === (props.value ?? "")) return;
    void props.onCommit(next);
  };

  const sharedProps = {
    disabled: props.disabled,
    title: props.disabled ? props.disabledReason : undefined,
    "aria-label": props.ariaLabel ?? props.label,
    onFocus: () => { focusedRef.current = true; },
  };

  let control;
  if (props.kind === "select") {
    control = (
      <select
        {...sharedProps}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          void props.onCommit(event.target.value);
        }}
        onBlur={() => { focusedRef.current = false; }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (props.kind === "textarea") {
    control = (
      <textarea
        {...sharedProps}
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          focusedRef.current = false;
          commitIfChanged(event.target.value);
        }}
      />
    );
  } else {
    const inputType = props.kind === "number" ? "number" : props.kind;
    control = (
      <input
        {...sharedProps}
        type={inputType}
        placeholder={props.placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          focusedRef.current = false;
          commitIfChanged(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  if (!props.label) return control;
  return <label>{props.label}{control}</label>;
}
