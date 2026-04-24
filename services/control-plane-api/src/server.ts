import { getHealthResponse } from "./routes/health.ts";

export function createServerDescriptor() {
  return {
    service: "control-plane-api",
    routes: {
      health: "/health",
      controls: "/v1/controls/actions",
      liveDashboard: "/v1/dashboard/live",
      configApprovals: "/v1/config/approvals",
      commerceHooks: "/v1/commerce/verify",
      promotionGate: "/v1/promotion/gate/evaluate",
      promotionBoardEnforcement: "/v1/promotion/gate/enforce-board"
    },
    healthSample: getHealthResponse(0)
  };
}
