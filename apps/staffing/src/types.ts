export type RoleKind = "DS" | "FDE" | "External FDE" | "GTM" | "SA";
export type AssignableRole = "DS" | "FDE" | "GTM" | "SA";
export type TabKey = "pods" | "pipeline";
export type FilterKey = "all" | "gaps" | "staffed";
export type PipelineStatusFilter = "all" | "Onboarding" | "Move to other client" | "Active" | "Leaving" | "Inactive";
export type SortKey = "tier" | "name" | "gaps";
export type CreateModal = "pod" | "person" | "assignment" | null;

export type Row<T> = { id: string; data: T };

export type PodData = {
  id?: string;
  pod_name?: string;
  tier?: string;
};

export type PersonData = {
  id?: string;
  first_name?: string;
  last_name?: string | null;
  email?: string | null;
  role?: string;
  status?: string;
  expected_start_date?: string | null;
  certification_status?: string | null;
  vacation_from?: string | null;
  vacation_until?: string | null;
  notes?: string | null;
  cert1_status?: string | null;
  cert1_date?: string | null;
  cert2_status?: string | null;
  cert2_date?: string | null;
  cert3_status?: string | null;
  cert3_date?: string | null;
  move_to_pod_id?: string | null;
  move_date?: string | null;
};

export type AssignmentData = {
  id?: string;
  pod_id?: string;
  person_id?: string | null;
  role?: string;
  status?: string;
  is_primary?: boolean | null;
  notes?: string | null;
  allocation_pct?: number | null;
  last_updated?: string | null;
};

export type WeeklyData = Record<string, string | number | boolean | null | undefined> & {
  id?: string;
  pod_id?: string;
  account_id?: string | null;
  deployment_strategist_goal?: string | null;
  fde_missing_count?: number | null;
  total_fde_needed?: number | null;
  notes?: string | null;
  last_updated?: string | null;
};

export type GoLiveData = {
  id?: string;
  pod_id?: string;
  agent_use_case?: string;
  target_date?: string | null;
  june_projection?: string | null;
  full_potential?: string | null;
  status?: string | null;
  notes?: string | null;
};

export const GO_LIVE_STATUSES = ["On Track", "Performance Pending", "At Risk", "Delayed"] as const;
export type GoLiveStatus = typeof GO_LIVE_STATUSES[number];

export type AgentData = {
  id?: string;
  pod_id?: string;
  agent_use_case?: string;
  live_pct?: string | null;
  april_consumption?: string | null;
  may_projection?: string | null;
  june_projection?: string | null;
  full_potential?: string | null;
  notes?: string | null;
};

export type PodSummary = {
  pod: Row<PodData>;
  assignments: Row<AssignmentData>[];
  weekly?: Row<WeeklyData>;
  ds: Row<AssignmentData>[];
  fde: Row<AssignmentData>[];
  externalFde: Row<AssignmentData>[];
  gtm: Row<AssignmentData>[];
  sa: Row<AssignmentData>[];
  openSlots: Row<AssignmentData>[];
  onboarding: Row<AssignmentData>[];
  leaving: Row<AssignmentData>[];
  vacation: Row<AssignmentData>[];
  gapCount: number;
  hasChanges: boolean;
  fullyStaffed: boolean;
  latestDsCoverage?: string;
  latestFdeCoverage?: string;
};

export type NewPodForm = {
  pod_name: string;
  tier: string;
};

export type NewPersonForm = {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  expected_start_date: string;
  certification_status: string;
  vacation_from: string;
  vacation_until: string;
  notes: string;
  cert1_status: string;
  cert1_date: string;
  cert2_status: string;
  cert2_date: string;
  cert3_status: string;
  cert3_date: string;
  move_to_pod_id: string;
  move_date: string;
  attach_pod_id: string;
  attach_role: string;
  attach_status: string;
  attach_is_primary: boolean;
  attach_notes: string;
};

export type NewAssignmentForm = {
  pod_id: string;
  person_id: string;
  role: string;
  status: string;
  is_open_slot: boolean;
  is_primary: boolean;
  notes: string;
  allocation_pct: string;
};

export type EditingAssignment = {
  rowId: string;
  pod_id: string;
  person_id: string;
  role: string;
  status: string;
  is_primary: boolean;
  notes: string;
  allocation_pct: string;
};

export type EditingPerson = {
  rowId: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  expected_start_date: string;
  certification_status: string;
  vacation_from: string;
  vacation_until: string;
  notes: string;
  cert1_status: string;
  cert1_date: string;
  cert2_status: string;
  cert2_date: string;
  cert3_status: string;
  cert3_date: string;
  move_to_pod_id: string;
  move_date: string;
  attach_assignment_row_id: string;
  attach_pod_id: string;
  attach_role: string;
  attach_status: string;
  attach_is_primary: boolean;
  attach_notes: string;
};

export type StaffingPayload = {
  pods: Row<PodData>[];
  people: Row<PersonData>[];
  assignments: Row<AssignmentData>[];
  weekly: Row<WeeklyData>[];
  go_lives: Row<GoLiveData>[];
  agents: Row<AgentData>[];
};

export type StaffingAction =
  | "load"
  | "createPod"
  | "createPerson"
  | "createAssignment"
  | "updateAssignment"
  | "deleteAssignment"
  | "updatePerson"
  | "updatePod"
  | "deletePerson"
  | "updatePipelineField"
  ;

export type StaffingAPI = {
  invokeFunction: <T = unknown>(
    slug: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; params?: Record<string, unknown> },
  ) => Promise<T>;
  get?: <T = unknown>(path: string) => Promise<T>;
};

export const STAFFING_FN_SLUG = "pod-staffing-data-v109";
