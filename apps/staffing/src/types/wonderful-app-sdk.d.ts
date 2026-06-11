declare module "@wonderful/app-sdk" {
  export interface WonderfulAPI {
    fetch(path: string, options?: RequestInit): Promise<Response>;
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body?: unknown): Promise<T>;
    put<T = unknown>(path: string, body?: unknown): Promise<T>;
    del(path: string): Promise<void>;
    invokeFunction<T = unknown>(slug: string, options?: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; params?: Record<string, unknown> }): Promise<T>;
  }

  export interface WonderfulContext {
    tenantId: string;
    userId: string;
    userName: string;
    theme: "light" | "dark";
    apiBaseUrl: string;
    /** Base URL for function invocation in external mode (e.g. "/app-functions/TOKEN"). */
    functionBaseUrl?: string;
  }

  export interface WonderfulSDK {
    context: WonderfulContext;
    api: WonderfulAPI;
  }

  export function useWonderful(): WonderfulSDK;
}
