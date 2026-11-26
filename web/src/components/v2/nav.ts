// The menu's pages, by role. Shared by the shell (sidebar, breadcrumbs, Go to) and by App's routes.
import type { Role } from "../ui";

export type NavItem = [icon: string, label: string, to: string];

// The Risk Manager's menu follows the day: what needs me, what AMIRI Agent found, what it watches, who I am, and the what-if tool.
export const GROUPS: [string, string[]][] = [
  ["Today", ["/home", "/alerts"]],
  ["What it found", ["/events", "/findings"]],
  ["What it watches", ["/radar", "/monitors", "/series"]],
  ["Your institution", ["/institution", "/spec"]],
  ["Try it", ["/studio"]],
];

export const NAV: Record<Role, NavItem[]> = {
  risk_manager: [
    ["home", "Overview", "/home"], ["alert", "Alerts", "/alerts"], ["search", "Findings", "/findings"], ["events", "Events", "/events"],
    ["radar", "Radar", "/radar"], ["monitor", "Monitors", "/monitors"], ["series", "Market series", "/series"],
    ["bank", "Institution", "/institution"], ["studio", "Scenario Studio", "/studio"], ["book", "Metrics Spec", "/spec"],
  ],
  platform_admin: [
    ["health", "Health", "/admin/health"], ["usage", "Usage", "/admin/usage"], ["cost", "Costs", "/admin/costs"],
    ["data", "Data connections", "/admin/data"], ["series", "Market series", "/series"], ["bank", "Institution", "/institution"],
    ["jobs", "Schedules and queues", "/admin/jobs"], ["studio", "Scenario Studio", "/studio"],
    ["users", "Users and roles", "/admin/users"], ["audit", "Audit log", "/admin/audit"], ["settings", "Settings", "/admin/settings"],
    ["book", "Metrics Spec", "/spec"],
  ],
};

/** The pages that exist; a page that isn't built isn't offered. */
export const BUILT = new Set(["/home", "/events", "/radar", "/monitors", "/series", "/studio", "/alerts", "/institution", "/admin/data", "/admin/settings", "/spec", "/findings"]);

/** What the menu offers a role. */
export const navFor = (role: Role): NavItem[] => NAV[role].filter(([, , to]) => BUILT.has(to));

/** The page a path belongs to ("/events/abc" is Events): the longest menu path that starts it. */
export function pageOf(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const n of [...NAV.risk_manager, ...NAV.platform_admin]) {
    if ((pathname === n[2] || pathname.startsWith(n[2] + "/")) && (!best || n[2].length > best[2].length)) best = n;
  }
  return best;
}
