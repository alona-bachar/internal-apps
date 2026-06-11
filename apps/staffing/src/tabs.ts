import type { ComponentType } from "react";

export type TabKey = "pods" | "pipeline";

export type TabDef = {
  key: TabKey;
  label: string;
  Component: ComponentType;
};

export type TabBarItem = Pick<TabDef, "key" | "label">;

export function getTabBarItems(tabs: TabDef[]): TabBarItem[] {
  return tabs.map(({ key, label }) => ({ key, label }));
}
