export type ConsoleSection =
  | "opportunities"
  | "positions"
  | "risk"
  | "execution"
  | "configuration"
  | "billing";

export interface ConsoleRoute {
  id: ConsoleSection;
  label: string;
  path: string;
  requiresAuth: boolean;
}

export const consoleRoutes: ConsoleRoute[] = [
  { id: "opportunities", label: "Opportunity Tape", path: "/opportunities", requiresAuth: true },
  { id: "positions", label: "Positions", path: "/positions", requiresAuth: true },
  { id: "risk", label: "Risk Controls", path: "/risk", requiresAuth: true },
  { id: "execution", label: "Execution Replay", path: "/execution", requiresAuth: true },
  { id: "configuration", label: "Configuration", path: "/configuration", requiresAuth: true },
  { id: "billing", label: "Billing", path: "/billing", requiresAuth: true }
];

export function createConsoleShell(appName = "Solana Opportunity Console") {
  return {
    appName,
    routes: consoleRoutes,
    version: "0.1.0"
  };
}
