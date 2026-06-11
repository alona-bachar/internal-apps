import { useEffect, useMemo, useRef, useState } from "react";
import { useWonderful } from "@wonderful/app-sdk";
import "./style.css";
import { useStaffingState } from "./useStaffingState";
import { ClientCoverageTab } from "./ClientCoverageTab";
import { HumanPipelineTab } from "./HumanPipelineTab";
import { AddClientModal } from "./AddClientModal";
import { AddPersonModal } from "./AddPersonModal";
import { AssignModal } from "./AssignModal";
import type { AssignPrefill } from "./AssignModal";
import { EditAssignmentModal } from "./EditAssignmentModal";
import { EditPersonModal } from "./EditPersonModal";
import { PlanTransitionModal } from "./PlanTransitionModal";
import { OffboardModal } from "./OffboardModal";
import { GoLivesTab } from "./GoLivesTab";
import { fullName } from "./helpers";
import { EmptyState } from "./EmptyState";
import type { AssignableRole, AssignmentData, PersonData, PodData, Row } from "./types";

const TABS = [
  { key: "pods" as const, label: "Client Coverage" },
  { key: "pipeline" as const, label: "Human Pipeline" },
  { key: "golives" as const, label: "Go-lives" },
];

type TabKey = (typeof TABS)[number]["key"];

type ModalState =
  | { kind: "addClient" }
  | { kind: "addPerson" }
  | { kind: "assign"; prefill: AssignPrefill }
  | { kind: "editAssignment"; assignment: Row<AssignmentData> }
  | { kind: "editPerson"; person: Row<PersonData>; focusEmail?: boolean }
  | { kind: "planTransition"; person: Row<PersonData> }
  | { kind: "offboard"; person: Row<PersonData> }
  | null;

const VIEW_STATE_KEY = "pod-staffing/view";

type ViewState = {
  tab: TabKey;
  selectedPodId: string;
};

function loadViewState(): ViewState {
  try {
    const raw = window.localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return { tab: "pods", selectedPodId: "" };
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    const tab = parsed.tab === "pipeline" ? "pipeline" : parsed.tab === "golives" ? "golives" : "pods";
    return { tab, selectedPodId: String(parsed.selectedPodId ?? "") };
  } catch {
    return { tab: "pods", selectedPodId: "" };
  }
}

function saveViewState(state: ViewState) {
  try {
    window.localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export default function App() {
  const { api } = useWonderful();
  const store = useStaffingState(api);
  const initialView = useMemo(loadViewState, []);
  const [tab, setTab] = useState<TabKey>(initialView.tab);
  const [selectedPodId, setSelectedPodId] = useState(initialView.selectedPodId);
  const [modal, setModal] = useState<ModalState>(null);
  // When the user opens "+ Create new person" from inside the Assign modal,
  // we stash the assign context here so that after the person is created
  // we can return to the Assign modal pre-filled with the new person.
  const [pendingAssignAfterCreate, setPendingAssignAfterCreate] = useState<AssignPrefill | null>(null);

  useEffect(() => {
    saveViewState({ tab, selectedPodId });
  }, [tab, selectedPodId]);

  useEffect(() => {
    if (!selectedPodId && store.pods[0]) setSelectedPodId(store.pods[0].id);
  }, [store.pods, selectedPodId]);

  // Focus-reload guard — suppressed while a modal is open.
  const isEditingRef = useRef(false);
  isEditingRef.current = modal !== null;

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.hidden) return;
      if (isEditingRef.current) return;
      void store.load({ silent: true });
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [store.load]);

  // ---- Mutate handlers --------------------------------------------------

  const handleCreatePod = async (form: { pod_name: string; tier: string }) => {
    const result = await store.mutate<{ pod: Row<PodData> }>({
      action: "createPod",
      payload: form,
      successMessage: `Created ${form.pod_name}`,
    });
    return result.ok ? result.data.pod : null;
  };

  const handleCreatePerson = async (form: {
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    status: string;
  }) => {
    const result = await store.mutate<{ person: Row<PersonData> }>({
      action: "createPerson",
      payload: form,
      successMessage: `Created ${form.first_name}`,
    });
    return result.ok ? result.data.person : null;
  };

  const handleAssignSubmit = async (payload: {
    assignment_row_id?: string;
    pod_id: string;
    role: string;
    status: string;
    person_id: string;
    is_primary: boolean;
    notes: string;
    allocation_pct: string;
  }) => {
    if (payload.assignment_row_id) {
      const result = await store.mutate<{ assignment: Row<AssignmentData> }>({
        action: "updateAssignment",
        payload: {
          row_id: payload.assignment_row_id,
          pod_id: payload.pod_id,
          role: payload.role,
          status: payload.status,
          person_id: payload.person_id,
          is_primary: payload.is_primary,
          notes: payload.notes,
          allocation_pct: payload.allocation_pct,
        },
        successMessage: "Slot filled",
      });
      return result.ok ? result.data.assignment : null;
    }
    const result = await store.mutate<{ assignment: Row<AssignmentData> }>({
      action: "createAssignment",
      payload: {
        pod_id: payload.pod_id,
        role: payload.role,
        status: payload.status,
        person_id: payload.person_id,
        is_primary: payload.is_primary,
        notes: payload.notes,
        allocation_pct: payload.allocation_pct,
      },
      successMessage: "Assignment added",
    });
    return result.ok ? result.data.assignment : null;
  };

  const handleAddOpenSlot = async (podId: string, role: AssignableRole) => {
    await store.mutate<{ assignment: Row<AssignmentData> }>({
      action: "createAssignment",
      payload: {
        pod_id: podId,
        role,
        is_open_slot: true,
        allocation_pct: 100,
      },
      successMessage: `Open ${role} slot added`,
    });
  };

  const handleCommitAllocationPct = async (assignment: Row<AssignmentData>, value: string) => {
    const trimmed = value.trim();
    const num = Number(trimmed);
    const pct = trimmed === "" ? null : Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : null;
    await store.mutate({
      action: "updateAssignment",
      payload: { row_id: assignment.id, allocation_pct: pct },
    });
  };

  const handleEditAssignmentSave = async (payload: {
    row_id: string;
    pod_id: string;
    role: string;
    status: string;
    person_id: string | null;
    is_primary: boolean;
    notes: string;
    allocation_pct: string;
  }) => {
    const result = await store.mutate({
      action: "updateAssignment",
      payload,
      successMessage: "Assignment updated",
    });
    return result.ok;
  };

  const handleUpdatePod = async (podId: string, patch: { pod_name?: string; tier?: string }) => {
    await store.mutate({
      action: "updatePod",
      payload: { row_id: podId, ...patch },
      successMessage: "Client updated",
    });
  };

  const handleDeletePerson = async (person: Row<PersonData>) => {
    if (!window.confirm(`Delete ${fullName(person)}? This will also remove all of their assignments.`)) {
      return;
    }
    await store.mutate({
      action: "deletePerson",
      payload: { row_id: person.id },
      successMessage: `${fullName(person)} deleted`,
    });
  };

  const handleEditAssignmentDelete = async (rowId: string) => {
    const result = await store.mutate({
      action: "deleteAssignment",
      payload: { row_id: rowId },
      successMessage: "Assignment removed",
    });
    return result.ok;
  };

  const handleEditPersonSave = async (payload: Record<string, unknown>) => {
    const result = await store.mutate({
      action: "updatePerson",
      payload,
      successMessage: "Person updated",
    });
    return result.ok;
  };

  const handleCommitAssignmentStatus = async (assignment: Row<AssignmentData>, status: string) => {
    await store.mutate({
      action: "updateAssignment",
      payload: {
        row_id: assignment.id,
        pod_id: assignment.data.pod_id,
        role: assignment.data.role,
        status,
        person_id: assignment.data.person_id,
        is_primary: assignment.data.is_primary,
        notes: assignment.data.notes,
        allocation_pct: assignment.data.allocation_pct,
      },
    });
  };

  const handleCommitWeekly = async (podId: string, field: string, value: string) => {
    const weeklyRow = store.weekly.find((row) => (row.data.pod_id || row.id) === podId);
    if (!weeklyRow) return;
    await store.mutate({
      action: "updateWeekly",
      payload: { row_id: weeklyRow.id, [field]: value },
    });
  };

  const handleCommitPersonStatus = async (person: Row<PersonData>, status: string) => {
    await store.mutate({
      action: "updatePipelineField",
      payload: { row_id: person.id, field: "status", value: status },
    });
  };

  const handleCommitPersonField = async (
    person: Row<PersonData>,
    field: keyof PersonData,
    value: string,
  ) => {
    await store.mutate({
      action: "updatePipelineField",
      payload: { row_id: person.id, field, value },
    });
  };

  const handlePlanTransitionSubmit = async (payload: {
    row_id: string;
    target_pod_id: string;
    move_date: string;
    create_open_slot: boolean;
    source_pod_id?: string;
    source_role?: string;
  }) => {
    const result = await store.mutate({
      action: "planTransition",
      payload,
      successMessage: "Transition planned",
    });
    return result.ok;
  };

  const handleOffboardSubmit = async (payload: {
    row_id: string;
    assignment_actions: { row_id: string; choice: "leaving" | "leaving_and_open_slot" | "delete" }[];
  }) => {
    const result = await store.mutate({
      action: "offboardPerson",
      payload,
      successMessage: "Person offboarded",
    });
    return result.ok;
  };

  const handleReactivate = async (person: Row<PersonData>) => {
    await store.mutate({
      action: "reactivatePerson",
      payload: { row_id: person.id },
      successMessage: `${fullName(person)} reactivated`,
    });
  };

  const handleGraduate = async (person: Row<PersonData>) => {
    await store.mutate({
      action: "updatePipelineField",
      payload: { row_id: person.id, field: "status", value: "Active" },
      successMessage: `🎓 ${fullName(person)} graduated to Active`,
    });
  };

  // ---- Error handling — open Edit Person modal when EMAIL_REQUIRED ------

  useEffect(() => {
    if (!store.error) return;
    if (store.error.code !== "EMAIL_REQUIRED") return;
    if (modal?.kind === "editPerson") return;
    // We don't know which person caused it — surface error inline; user can re-open the row.
  }, [store.error, modal]);

  // ---- Render -----------------------------------------------------------

  return (
    <main className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <div>
            <p className="eyebrow">Pod Staffing</p>
            <h1>Coverage and pipeline workspace</h1>
          </div>
          <nav className="tab-bar" aria-label="Views">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? "active" : ""}
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void store.load()}
              disabled={store.isLoading || store.isMutating}
            >
              Refresh
            </button>
          </div>
        </header>

        {store.error ? (
          <div className="alert danger" role="alert">
            <span>
              <strong>{store.error.code === "EMAIL_REQUIRED" ? "Email required: " : "Error: "}</strong>
              {store.error.message}
            </span>
            <button className="ghost-button small" type="button" onClick={store.clearError}>Dismiss</button>
          </div>
        ) : null}
        {store.notice ? (
          <div className="alert success" role="status">
            <span>{store.notice}</span>
            <button className="ghost-button small" type="button" onClick={store.clearNotice}>×</button>
          </div>
        ) : null}

        {store.isLoading ? (
          <EmptyState title="Loading staffing tables…" />
        ) : store.pods.length === 0 && store.people.length === 0 ? (
          <EmptyState
            title="No clients or people yet"
            description="Create your first client to start tracking coverage."
            action={
              <button className="primary-button" type="button" onClick={() => setModal({ kind: "addClient" })}>
                + Create first client
              </button>
            }
          />
        ) : tab === "pods" ? (
          <ClientCoverageTab
            pods={store.pods}
            people={store.people}
            assignments={store.assignments}
            weekly={store.weekly}
            agents={store.agents}
            goLives={store.goLives}
            isMutating={store.isMutating}
            selectedPodId={selectedPodId}
            onSelectPod={setSelectedPodId}
            onNewClient={() => setModal({ kind: "addClient" })}
            onAssign={(prefill) => setModal({ kind: "assign", prefill })}
            onAddOpenSlot={handleAddOpenSlot}
            onDeleteAssignment={(assignment) => {
              if (window.confirm("Delete this open slot?")) {
                void handleEditAssignmentDelete(assignment.id);
              }
            }}
            onEditAssignment={(assignment) => setModal({ kind: "editAssignment", assignment })}
            onPlanTransitionForAssignment={(assignment) => {
              const person = assignment.data.person_id
                ? store.people.find((p) => p.id === assignment.data.person_id)
                : undefined;
              if (person) setModal({ kind: "planTransition", person });
            }}
            onEditPersonTransition={(person) => setModal({ kind: "planTransition", person })}
            onCommitAssignmentStatus={handleCommitAssignmentStatus}
            onCommitAllocationPct={handleCommitAllocationPct}
            onCommitWeekly={handleCommitWeekly}
            onUpdatePod={handleUpdatePod}
          />
        ) : tab === "golives" ? (
          <GoLivesTab goLives={store.goLives} pods={store.pods} />
        ) : (
          <HumanPipelineTab
            people={store.people}
            assignments={store.assignments}
            pods={store.pods}
            onNewPerson={() => setModal({ kind: "addPerson" })}
            onEditPerson={(person) => setModal({ kind: "editPerson", person })}
            onCommitPersonStatus={handleCommitPersonStatus}
            onCommitPersonField={handleCommitPersonField}
            onAssign={(person) =>
              setModal({ kind: "assign", prefill: { person_id: person.id, role: "FDE" } })
            }
            onPlanTransition={(person) => setModal({ kind: "planTransition", person })}
            onOffboard={(person) => setModal({ kind: "offboard", person })}
            onReactivate={handleReactivate}
            onGraduate={handleGraduate}
            onDelete={handleDeletePerson}
          />
        )}
      </div>

      <AddClientModal
        open={modal?.kind === "addClient"}
        onClose={() => setModal(null)}
        onSubmit={handleCreatePod}
        onCreated={(pod) => {
          setSelectedPodId(pod.id);
          setTab("pods");
          setModal(null);
        }}
        isMutating={store.isMutating}
      />
      <AddPersonModal
        open={modal?.kind === "addPerson"}
        onClose={() => {
          setPendingAssignAfterCreate(null);
          setModal(null);
        }}
        onSubmit={handleCreatePerson}
        onCreated={(person) => {
          if (pendingAssignAfterCreate) {
            const prefill = { ...pendingAssignAfterCreate, person_id: person.id };
            setPendingAssignAfterCreate(null);
            setModal({ kind: "assign", prefill });
          } else {
            setModal({ kind: "editPerson", person });
          }
        }}
        isMutating={store.isMutating}
      />
      <AssignModal
        open={modal?.kind === "assign"}
        onClose={() => setModal(null)}
        prefill={modal?.kind === "assign" ? modal.prefill : {}}
        pods={store.pods}
        people={store.people}
        isMutating={store.isMutating}
        onSubmit={handleAssignSubmit}
        onRequestNewPerson={(returnPrefill) => {
          setPendingAssignAfterCreate(returnPrefill);
          setModal({ kind: "addPerson" });
        }}
      />
      <EditAssignmentModal
        open={modal?.kind === "editAssignment"}
        onClose={() => setModal(null)}
        assignment={modal?.kind === "editAssignment" ? modal.assignment : null}
        pods={store.pods}
        people={store.people}
        isMutating={store.isMutating}
        onSave={handleEditAssignmentSave}
        onDelete={handleEditAssignmentDelete}
      />
      <EditPersonModal
        open={modal?.kind === "editPerson"}
        onClose={() => setModal(null)}
        person={modal?.kind === "editPerson" ? modal.person : null}
        pods={store.pods}
        isMutating={store.isMutating}
        focusEmail={modal?.kind === "editPerson" ? modal.focusEmail : undefined}
        onSave={handleEditPersonSave}
      />
      <PlanTransitionModal
        open={modal?.kind === "planTransition"}
        onClose={() => setModal(null)}
        person={modal?.kind === "planTransition" ? modal.person : null}
        pods={store.pods}
        assignments={store.assignments}
        isMutating={store.isMutating}
        onSubmit={handlePlanTransitionSubmit}
      />
      <OffboardModal
        open={modal?.kind === "offboard"}
        onClose={() => setModal(null)}
        person={modal?.kind === "offboard" ? modal.person : null}
        assignments={store.assignments}
        pods={store.pods}
        isMutating={store.isMutating}
        onSubmit={handleOffboardSubmit}
      />
    </main>
  );
}
