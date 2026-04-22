export type ControlAction = "pause" | "resume" | "kill_switch";
export type ControlRole = "operator" | "viewer";

export interface SignedActionAuthorization {
  wallet: string;
  role: ControlRole;
  challenge: string;
  signature: string;
}

export interface ActionRequest {
  action: ControlAction;
  actorWallet: string;
  requestedAtMs?: number;
  authorization?: SignedActionAuthorization;
}

export interface ActionResult {
  accepted: boolean;
  requiresAuthorization: boolean;
  reason?:
    | "missing_wallet"
    | "missing_signature"
    | "wallet_mismatch"
    | "forbidden_action"
    | "invalid_challenge"
    | "stale_challenge";
}

const actionRolePolicy: Record<ControlAction, ControlRole[]> = {
  pause: ["operator"],
  resume: ["operator"],
  kill_switch: ["operator"]
};
const MAX_CHALLENGE_AGE_MS = 60_000;

function isAuthorizedAction(action: ControlAction, role: ControlRole): boolean {
  return actionRolePolicy[action].includes(role);
}

function parseChallenge(challenge: string): { wallet: string; action: ControlAction; issuedAtMs: number } | null {
  const [prefix, wallet, action, issuedAtRaw] = challenge.split(":");
  const issuedAtMs = Number(issuedAtRaw);
  if (prefix !== "control-plane-auth" || !wallet || !action || !Number.isFinite(issuedAtMs)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(actionRolePolicy, action)) {
    return null;
  }

  return { wallet, action: action as ControlAction, issuedAtMs };
}

export function evaluateActionRequest(request: ActionRequest): ActionResult {
  const isWalletProvided = request.actorWallet.trim().length > 0;
  if (!isWalletProvided) {
    return {
      accepted: false,
      requiresAuthorization: true,
      reason: "missing_wallet"
    };
  }

  const authorization = request.authorization;
  if (!authorization || authorization.signature.trim().length === 0) {
    return {
      accepted: false,
      requiresAuthorization: true,
      reason: "missing_signature"
    };
  }

  if (authorization.wallet !== request.actorWallet) {
    return {
      accepted: false,
      requiresAuthorization: true,
      reason: "wallet_mismatch"
    };
  }

  const parsedChallenge = parseChallenge(authorization.challenge);
  if (!parsedChallenge || parsedChallenge.wallet !== request.actorWallet || parsedChallenge.action !== request.action) {
    return {
      accepted: false,
      requiresAuthorization: true,
      reason: "invalid_challenge"
    };
  }

  const requestedAtMs = request.requestedAtMs ?? Date.now();
  if (requestedAtMs - parsedChallenge.issuedAtMs > MAX_CHALLENGE_AGE_MS) {
    return {
      accepted: false,
      requiresAuthorization: true,
      reason: "stale_challenge"
    };
  }

  if (!isAuthorizedAction(request.action, authorization.role)) {
    return {
      accepted: false,
      requiresAuthorization: true,
      reason: "forbidden_action"
    };
  }

  return {
    accepted: true,
    requiresAuthorization: true
  };
}
