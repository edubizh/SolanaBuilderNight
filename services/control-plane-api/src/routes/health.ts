export interface HealthResponse {
  service: string;
  status: "ok";
  timestamp: number;
}

export function getHealthResponse(now = Date.now()): HealthResponse {
  return {
    service: "control-plane-api",
    status: "ok",
    timestamp: now
  };
}
