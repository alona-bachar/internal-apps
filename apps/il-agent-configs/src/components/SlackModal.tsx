import { useState } from "react";
import { TIER_ORDER, ALL_TIERS_ORDER } from "../lib/types";
import type { OverviewResponse, PodOverview, Tier as ApiTier } from "../lib/types";
import { TierBadge } from "./TierBadge";

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Client-side preview of the message for one pod. Mirrors the server's
// token resolution (il-pod-slack-poster) but renders people as "@Name"
// stand-ins — the real <@SlackID> mentions are resolved per channel on send.
function previewFor(
  pod: PodOverview,
  message: string,
  podByToken: Map<string, PodOverview>,
): string {
  const names = (list: string[] | null | undefined) => (list ?? []).map((n) => `@${n}`).join(", ");
  return message.replace(/\{([a-z0-9_]+)\}/gi, (whole, token: string) => {
    const t = token.toLowerCase();
    if (t === "fde") return names(pod.fde);
    if (t === "ds") return names(pod.ds);
    if (t === "tier") return pod.tier ?? whole;
    if (t === "customer") return pod.customer ?? whole;
    const m = t.match(/^(.+)_(fde|ds|tier|name)$/);
    if (m) {
      const target = podByToken.get(m[1]);
      if (!target) return whole;
      if (m[2] === "fde") return names(target.fde);
      if (m[2] === "ds") return names(target.ds);
      if (m[2] === "tier") return target.tier ?? whole;
      if (m[2] === "name") return target.customer ?? whole;
    }
    return whole;
  });
}

export function SlackModal(props: {
  overview: OverviewResponse | null;
  preselected: string[];
  onClose: () => void;
  onSend: (pod_ids: string[], message: string) => void;
}) {
  const [selectedPodIds, setSelectedPodIds] = useState<Set<string>>(
    new Set(props.preselected),
  );
  const [message, setMessage] = useState("");

  // Build the flat pod list grouped by tier from the live overview.
  // Tier ordering mirrors the Overview tab: TIER_ORDER ("Tier 1/2/3") plus
  // the API-only tiers appended.
  const tiersToShow: ApiTier[] = [
    ...TIER_ORDER,
    ...ALL_TIERS_ORDER.filter((t) => !(TIER_ORDER as ApiTier[]).includes(t)),
  ];

  const tiers: Partial<Record<ApiTier, PodOverview[]>> =
    props.overview && props.overview.ok === true ? props.overview.tiers : {};

  // Map from pod_id to its PodOverview for fast lookups.
  const podById = new Map<string, PodOverview>();
  for (const tier of tiersToShow) {
    for (const pod of tiers[tier] ?? []) {
      podById.set(pod.pod_id, pod);
    }
  }

  // CTO Office now comes from the overview data (pods row id "cto_office",
  // tier Strategic) so it appears in the tier list below like any other pod.

  const togglePod = (pod_id: string, hasChannel: boolean) => {
    if (!hasChannel) return;
    const s = new Set(selectedPodIds);
    if (s.has(pod_id)) s.delete(pod_id);
    else s.add(pod_id);
    setSelectedPodIds(s);
  };

  // Selected pods (resolved from overview), filtered to only those with a real
  // channel — pods without a channel are visually disabled and can't be picked.
  const selectedPods: PodOverview[] = Array.from(selectedPodIds)
    .map((id) => podById.get(id))
    .filter((p): p is PodOverview => p != null && p.slack_channel_id != null);

  const channels = selectedPods
    .map((p) => p.slack_channel_name ?? p.slack_channel_id ?? "(unknown)")
    .filter((c, i, arr) => arr.indexOf(c) === i);

  // Customer-token -> pod, for previewing absolute {customer_fde} references.
  const podByToken = new Map<string, PodOverview>();
  for (const p of podById.values()) if (p.customer) podByToken.set(norm(p.customer), p);

  // The message is sent raw; the server resolves tokens per channel.
  const composedMessage = message;
  const hasTokens = /\{[a-z0-9_]+\}/i.test(message);
  const previewPod = selectedPods[0] ?? null;

  const podIdsToSend = selectedPods.map((p) => p.pod_id);
  const canSend = podIdsToSend.length > 0 && composedMessage.trim().length > 0;

  return (
    <>
      <div className="modal-scrim" onClick={props.onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send Slack update">
        <header className="modal-head">
          <div>
            <div className="modal-title">Send Slack update</div>
            <div className="modal-sub muted">
              Pick pods, compose your note, optionally include the auto-generated gap summary.
            </div>
          </div>
          <button className="drawer-close" onClick={props.onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          <h4 className="modal-section">Pods</h4>
          <div className="modal-pods">
            {tiersToShow.map((tier) => {
              const podsInTier = tiers[tier] ?? [];
              if (podsInTier.length === 0) return null;
              const selectablePodsInTier = podsInTier.filter(
                (p) => p.slack_channel_id != null,
              );
              return (
                <div key={tier} className="modal-tier">
                  <div className="modal-tier-head">
                    <TierBadge tier={tier} />
                    <button
                      className="link"
                      onClick={() => {
                        const next = new Set(selectedPodIds);
                        const allOn = selectablePodsInTier.every((p) =>
                          next.has(p.pod_id),
                        );
                        selectablePodsInTier.forEach((p) =>
                          allOn ? next.delete(p.pod_id) : next.add(p.pod_id),
                        );
                        setSelectedPodIds(next);
                      }}
                    >
                      toggle all
                    </button>
                  </div>
                  {podsInTier.map((p) => {
                    const hasChannel = p.slack_channel_id != null;
                    const channelLabel = p.slack_channel_name ?? "(no channel)";
                    return (
                      <label
                        key={p.pod_id}
                        className={`modal-pod ${hasChannel ? "" : "modal-pod-disabled"}`}
                        style={hasChannel ? undefined : { opacity: 0.5, cursor: "not-allowed" }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPodIds.has(p.pod_id) && hasChannel}
                          disabled={!hasChannel}
                          onChange={() => togglePod(p.pod_id, hasChannel)}
                        />
                        <span className="modal-pod-name">{p.customer ?? p.pod_id}</span>
                        <span className="modal-pod-channel mono">{channelLabel}</span>
                        {!hasChannel && (
                          <span className="muted modal-pod-meta">no channel</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              );
            })}
            {Object.keys(tiers).length === 0 && (
              <div className="muted">Loading pods…</div>
            )}
          </div>

          <h4 className="modal-section">Message</h4>
          <textarea
            className="modal-textarea"
            placeholder="e.g. Heads up {fde} — please review the open issues before standup."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
          />
          <div className="modal-vars muted">
            Variables (replaced per channel with real @mentions on send):{" "}
            <code>{"{fde}"}</code> <code>{"{ds}"}</code> <code>{"{tier}"}</code> <code>{"{customer}"}</code>
            {" — or "}<code>{"{maccabi_fde}"}</code> for a specific customer.
          </div>

          <h4 className="modal-section">Preview</h4>
          <div className="modal-preview">
            <div className="modal-preview-head">
              {channels.length === 0
                ? "No channels selected"
                : `Will post to: ${channels.join(", ")}`}
            </div>
            <pre className="modal-preview-body">
              {previewPod ? previewFor(previewPod, composedMessage, podByToken) : composedMessage || "(empty)"}
            </pre>
            {hasTokens && previewPod && (
              <div className="modal-preview-note muted">
                Showing <strong>{previewPod.customer ?? previewPod.pod_id}</strong> as an example — each channel gets its
                own people. Names shown as <code>@Name</code>; real Slack tags resolve on send.
              </div>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          <button className="btn-secondary" onClick={props.onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!canSend}
            onClick={() => props.onSend(podIdsToSend, composedMessage)}
          >
            Send to {podIdsToSend.length} channel{podIdsToSend.length === 1 ? "" : "s"}
          </button>
        </footer>
      </div>
    </>
  );
}
