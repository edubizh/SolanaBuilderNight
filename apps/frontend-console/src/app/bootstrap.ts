import { createConsoleShell } from "../lib/dashboard-shell.js";
import { connectAndSignForOperator } from "../lib/operator-auth.js";
import { createAuthorizedActionRequest } from "../lib/operator-controls.js";
import { createDashboardSnapshot } from "../lib/live-dashboard.js";
import { buildConfigApprovalTimeline } from "../lib/config-approvals.js";
import { resolveEntitlementState } from "../lib/commerce-entitlements.js";

export function bootstrapConsole() {
  return {
    shell: createConsoleShell(),
    auth: {
      connectAndSignForOperator
    },
    controls: {
      createAuthorizedActionRequest
    },
    dashboard: {
      createDashboardSnapshot
    },
    configuration: {
      buildConfigApprovalTimeline
    },
    commerce: {
      resolveEntitlementState
    }
  };
}
