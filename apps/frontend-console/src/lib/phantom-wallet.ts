export interface PhantomProvider {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (message: Uint8Array, display?: "hex" | "utf8") => Promise<{ signature: Uint8Array }>;
}

export interface PhantomWalletSession {
  walletAddress: string;
  challenge: string;
  signature: string;
  role: "operator";
}

export interface WalletConnectResult {
  walletAddress: string;
}

export function encodeToUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function encodeBase64(value: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < value.length; index += 3) {
    const byte1 = value[index] ?? 0;
    const byte2 = value[index + 1] ?? 0;
    const byte3 = value[index + 2] ?? 0;
    const triple = (byte1 << 16) | (byte2 << 8) | byte3;

    output += alphabet[(triple >> 18) & 0x3f];
    output += alphabet[(triple >> 12) & 0x3f];
    output += index + 1 < value.length ? alphabet[(triple >> 6) & 0x3f] : "=";
    output += index + 2 < value.length ? alphabet[triple & 0x3f] : "=";
  }

  return output;
}

export async function connectPhantomWallet(provider: PhantomProvider): Promise<WalletConnectResult> {
  if (!provider?.isPhantom) {
    throw new Error("Phantom provider is unavailable");
  }

  const connected = await provider.connect();
  const walletAddress = connected.publicKey.toString();
  if (walletAddress.trim().length === 0) {
    throw new Error("Connected wallet address is empty");
  }

  return { walletAddress };
}

export async function signOperatorChallenge(
  provider: PhantomProvider,
  walletAddress: string,
  challenge: string
): Promise<PhantomWalletSession> {
  const message = encodeToUtf8(challenge);
  const signed = await provider.signMessage(message, "utf8");

  return {
    walletAddress,
    challenge,
    signature: encodeBase64(signed.signature),
    role: "operator"
  };
}
