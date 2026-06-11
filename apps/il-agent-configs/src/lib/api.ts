// React hook wrapping the Wonderful SDK's `invokeFunction` for the IL Agent
// Configs app. Centralises function slugs + payload shapes so callers never
// touch the SDK directly.
//
// The `useRef(api)`-then-mutate pattern is required because `useWonderful().api`
// is recreated on every render — using it directly in `useCallback` deps would
// cause infinite fetch loops. See `apps/il-agent-configs/AGENTS.md` ("Preventing
// Infinite Fetch Loops") and `apps/staffing/src/useStaffingState.ts` for the
// established pattern.
//
// SDK shape: `invokeFunction(slug, { method, params })`. The Wonderful
// Functions runtime calls a top-level `userFunction(context)` and exposes the
// request body on `context.data.{action,payload}` per each function's
// `param_mapping.body_params`. We therefore send `action` flat and nest all
// other call-specific keys into `payload`.

import { useWonderful } from "@wonderful/app-sdk";
import { useCallback, useRef } from "react";
import type {
  OverviewResponse,
  AgentDetailResponse,
  SlackPostResponse,
  ChangesResponse,
} from "./types";

export const DATA_FN_SLUG = "il-agent-configs-data-v1";
export const SLACK_FN_SLUG = "il-pod-slack-poster-v1";

export function useConfigsApi() {
  const { api } = useWonderful();
  const apiRef = useRef(api);
  apiRef.current = api;

  const getOverview = useCallback(async (): Promise<OverviewResponse> => {
    return await apiRef.current.invokeFunction<OverviewResponse>(DATA_FN_SLUG, {
      method: "POST",
      params: { action: "get_overview", payload: {} },
    });
  }, []);

  const getAgentDetail = useCallback(
    async (
      platform_agent_id: string,
      use_case: string,
    ): Promise<AgentDetailResponse> => {
      return await apiRef.current.invokeFunction<AgentDetailResponse>(DATA_FN_SLUG, {
        method: "POST",
        params: {
          action: "get_agent_detail",
          payload: { platform_agent_id, use_case },
        },
      });
    },
    [],
  );

  const postSlack = useCallback(
    async (pod_ids: string[], message: string): Promise<SlackPostResponse> => {
      return await apiRef.current.invokeFunction<SlackPostResponse>(SLACK_FN_SLUG, {
        method: "POST",
        params: {
          action: "post",
          payload: { pod_ids, message },
        },
      });
    },
    [],
  );

  const listChanges = useCallback(async (): Promise<ChangesResponse> => {
    return await apiRef.current.invokeFunction<ChangesResponse>(DATA_FN_SLUG, {
      method: "POST",
      params: { action: "list_changes", payload: { limit: 200 } },
    });
  }, []);

  return { getOverview, getAgentDetail, postSlack, listChanges };
}
