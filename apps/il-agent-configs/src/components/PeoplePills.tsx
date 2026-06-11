export function PeoplePills(props: { label: "DS" | "FDE"; people: string[] }) {
  if (props.people.length === 0) {
    return <span className="ppl-empty muted">no {props.label}</span>;
  }
  return (
    <div className="ppl-row">
      <span className="ppl-label">{props.label}</span>
      <div className="ppl-list">
        {props.people.map((p) => (
          <span key={p} className="ppl-pill">{p}</span>
        ))}
      </div>
    </div>
  );
}
