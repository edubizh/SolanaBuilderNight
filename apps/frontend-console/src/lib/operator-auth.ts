import {
  type PhantomProvider,
  type PhantomWalletSession,
  connectPhantomWallet,
  signOperatorChallenge
} from "./phantom-wallet.ts";
export type OperatorControlAction = "pause" | "resume" | "kill_switch";

export function createOperatorChallenge(
  walletAddress: string,
  action: OperatorControlAction,
  now = Date.now()
): string {
  return `control-plane-auth:${walletAddress}:${action}:${now}`;
}

export async function connectAndSignForOperator(
  provider: PhantomProvider,
  action: OperatorControlAction,
  now = Date.now()
): Promise<PhantomWalletSession> {
  const connection = await connectPhantomWallet(provider);
  const challenge = createOperatorChallenge(connection.walletAddress, action, now);
  return signOperatorChallenge(provider, connection.walletAddress, challenge);
}
