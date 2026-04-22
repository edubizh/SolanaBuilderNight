import type { OperatorControlAction } from "./operator-auth.ts";
import type { PhantomProvider } from "./phantom-wallet.ts";
import { connectAndSignForOperator } from "./operator-auth.ts";

export interface AuthorizedActionRequest {
  action: OperatorControlAction;
  actorWallet: string;
  requestedAtMs: number;
  authorization: {
    wallet: string;
    role: "operator";
    challenge: string;
    signature: string;
  };
}

export async function createAuthorizedActionRequest(
  provider: PhantomProvider,
  action: OperatorControlAction,
  requestedAtMs = Date.now()
): Promise<AuthorizedActionRequest> {
  const session = await connectAndSignForOperator(provider, action, requestedAtMs);

  return {
    action,
    actorWallet: session.walletAddress,
    requestedAtMs,
    authorization: {
      wallet: session.walletAddress,
      role: session.role,
      challenge: session.challenge,
      signature: session.signature
    }
  };
}
