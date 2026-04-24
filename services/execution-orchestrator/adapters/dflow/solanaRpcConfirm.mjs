/**
 * Resilient Solana JSON-RPC calls for autobot live confirmation.
 * Replaces direct Connection.confirmTransaction when Helius returns transient fetch failures.
 */

export const RPC_FETCH_TIMEOUT_MS = 15_000;
/** One initial attempt plus three retries, with 1s / 2s / 4s delays before each retry. */
export const RPC_FETCH_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];
export const RPC_FETCH_MAX_ATTEMPTS = 1 + RPC_FETCH_RETRY_BACKOFF_MS.length;

/**
 * @param {number} [delayMs]
 */
function sleepMs(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * @param {string | null | undefined} rpcUrl
 */
export function isHttpRpcUrl(rpcUrl) {
  if (typeof rpcUrl !== "string") {
    return false;
  }
  const t = rpcUrl.trim();
  return t.startsWith("http://") || t.startsWith("https://");
}

/**
 * POST JSON-RPC with AbortController timeout and exponential backoff retries on transport failures.
 * @param {string} rpcUrl
 * @param {string} method
 * @param {unknown} params
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number[]} [options.retryBackoffMs] override delays (default 1s/2s/4s before retries 2–4)
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function rpcJsonRequestWithRetries(rpcUrl, method, params, options = {}) {
  const timeoutMs = options.timeoutMs ?? RPC_FETCH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const backoffs =
    Array.isArray(options.retryBackoffMs) && options.retryBackoffMs.length > 0
      ? options.retryBackoffMs
      : RPC_FETCH_RETRY_BACKOFF_MS;
  let lastError = new Error("RPC request did not run");

  for (let attempt = 0; attempt < RPC_FETCH_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      const b = backoffs[attempt - 1];
      const delay = Number.isFinite(b) ? b : 0;
      await sleepMs(delay);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload;
      try {
        payload = text.length > 0 ? JSON.parse(text) : {};
      } catch (parseErr) {
        const err = new Error(`RPC ${method} invalid JSON: ${String(parseErr)}`);
        err.retryable = true;
        lastError = err;
        if (attempt < RPC_FETCH_MAX_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }

      if (!response.ok) {
        const err = new Error(`RPC ${method} HTTP ${response.status}`);
        err.retryable = response.status >= 500;
        lastError = err;
        if (err.retryable && attempt < RPC_FETCH_MAX_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }

      if (payload.error) {
        const msg = payload.error.message ? String(payload.error.message) : JSON.stringify(payload.error);
        const err = new Error(`RPC ${method} error: ${msg}`);
        err.retryable = false;
        throw err;
      }

      return payload.result;
    } catch (error) {
      const isAbort = error?.name === "AbortError" || (typeof error?.message === "string" && error.message.includes("aborted"));
      const isNetworkish =
        isAbort ||
        error instanceof TypeError ||
        (typeof error?.message === "string" &&
          (error.message.includes("fetch failed") || error.message.includes("ECONNRESET")));
      lastError = error instanceof Error ? error : new Error(String(error));
      lastError.retryable = isNetworkish;
      if (isNetworkish && attempt < RPC_FETCH_MAX_ATTEMPTS - 1) {
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

const CONFIRMATION_COMMITTED = new Set(["confirmed", "finalized"]);

/**
 * @param {string} rpcUrl
 * @param {string} signature
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function getSignatureConfirmationRpc(rpcUrl, signature, options = {}) {
  const result = await rpcJsonRequestWithRetries(
    rpcUrl,
    "getSignatureStatuses",
    [signature, { searchTransactionHistory: true }],
    options,
  );
  const slotValue = result && typeof result === "object" && Array.isArray(result.value) ? result.value[0] : null;
  const value = slotValue ?? (Array.isArray(result) ? result[0] : null);
  if (value === null || value === undefined) {
    return { ok: false, reason: "pending", value, confirmationStatus: null };
  }
  const status = value?.confirmationStatus;
  if (value?.err) {
    return { ok: false, reason: "chain_err", value, confirmationStatus: status ?? null };
  }
  if (status && CONFIRMATION_COMMITTED.has(String(status).toLowerCase())) {
    return { ok: true, value, confirmationStatus: status };
  }
  return { ok: false, reason: "pending", value, confirmationStatus: status ?? null };
}

/**
 * @param {string} rpcUrl
 */
export async function getBlockHeightRpc(rpcUrl, options = {}) {
  return rpcJsonRequestWithRetries(rpcUrl, "getBlockHeight", [], options);
}

/**
 * Poll until signature reaches confirmed/finalized, or block height exceeds last valid, or max wall time.
 * @param {object} config
 * @param {string} config.rpcUrl
 * @param {string} config.signature
 * @param {number} [config.lastValidBlockHeight]
 * @param {number} [config.pollIntervalMs]
 * @param {number} [config.maxWaitMs]
 * @param {typeof fetch} [config.fetchImpl]
 */
export async function waitForSignatureConfirmedRpc(config) {
  const {
    rpcUrl,
    signature,
    lastValidBlockHeight = null,
    pollIntervalMs = 400,
    maxWaitMs = 90_000,
    fetchImpl,
  } = config;

  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    let r;
    try {
      r = await getSignatureConfirmationRpc(rpcUrl, signature, { fetchImpl });
    } catch {
      await sleepMs(pollIntervalMs);
      continue;
    }
    if (r.ok) {
      return { ...r, timedOut: false, blockHeightExceeded: false };
    }
    if (r.reason === "chain_err") {
      return { ...r, ok: false, timedOut: false, blockHeightExceeded: false };
    }

    if (lastValidBlockHeight != null && Number.isFinite(lastValidBlockHeight)) {
      try {
        const height = await getBlockHeightRpc(rpcUrl, { fetchImpl });
        if (Number.isFinite(height) && height > lastValidBlockHeight) {
          return { ok: false, reason: "block_height_exceeded", timedOut: true, blockHeightExceeded: true };
        }
      } catch {
        /* keep polling; block height is best-effort */
      }
    }

    await sleepMs(pollIntervalMs);
  }

  return { ok: false, reason: "wait_timeout", timedOut: true, blockHeightExceeded: false };
}

/**
 * @param {string} wallet
 * @param {string} usdcMint
 * @param {unknown} message
 */
function findWalletIndex(message, wallet) {
  const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  for (let i = 0; i < accountKeys.length; i += 1) {
    const key = accountKeys[i];
    const pubkey = typeof key === "string" ? key : key?.pubkey;
    if (pubkey === wallet) {
      return i;
    }
  }
  return -1;
}

/**
 * @param {unknown} entries
 * @param {string} wallet
 * @param {string} mint
 */
function sumTokenBalanceAtomic(entries, wallet, mint) {
  const balances = Array.isArray(entries) ? entries : [];
  let total = 0n;
  for (const entry of balances) {
    if (entry?.owner !== wallet) {
      continue;
    }
    if (entry?.mint !== mint) {
      continue;
    }
    const amountRaw = entry?.uiTokenAmount?.amount;
    if (typeof amountRaw !== "string") {
      continue;
    }
    try {
      total += BigInt(amountRaw);
    } catch {
      /* ignore */
    }
  }
  return total;
}

/**
 * @param {object} tx
 * @param {string} wallet
 * @param {string} usdcMint
 * @param {number | null} solUsd
 */
export function computeRealizedNetUsdFromJsonParsedTx(tx, wallet, usdcMint, solUsd) {
  if (!tx?.meta || !tx?.transaction?.message) {
    return { ok: false, reason: "missing_transaction_meta" };
  }
  const walletIndex = findWalletIndex(tx.transaction.message, wallet);
  if (walletIndex < 0) {
    return { ok: false, reason: "wallet_not_found_in_accounts" };
  }
  const preLamports = tx.meta.preBalances?.[walletIndex];
  const postLamports = tx.meta.postBalances?.[walletIndex];
  if (!Number.isFinite(preLamports) || !Number.isFinite(postLamports)) {
    return { ok: false, reason: "missing_sol_balances" };
  }
  const preUsdcAtomic = sumTokenBalanceAtomic(tx.meta.preTokenBalances, wallet, usdcMint);
  const postUsdcAtomic = sumTokenBalanceAtomic(tx.meta.postTokenBalances, wallet, usdcMint);
  const solDelta = (postLamports - preLamports) / 1_000_000_000;
  const usdcDelta = Number(postUsdcAtomic - preUsdcAtomic) / 1_000_000;
  if (typeof solUsd !== "number" || !Number.isFinite(solUsd)) {
    return { ok: true, realizedNetUsd: null, solDelta, usdcDelta };
  }
  const realizedNetUsd = usdcDelta + solDelta * solUsd;
  return { ok: true, realizedNetUsd, solDelta, usdcDelta };
}

/**
 * @param {string} rpcUrl
 * @param {string} signature
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function getTransactionJsonParsed(rpcUrl, signature, options = {}) {
  return rpcJsonRequestWithRetries(
    rpcUrl,
    "getTransaction",
    [
      signature,
      {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
      },
    ],
    options,
  );
}

/**
 * DFlow /order-status: treat these as "soft" on-chain success if RPC confirmation failed.
 * @param {string | null | undefined} state
 */
export function isDflowOrderStatusFilled(state) {
  if (typeof state !== "string") {
    return false;
  }
  const s = state.trim().toLowerCase();
  return (
    s === "filled" ||
    s === "succeeded" ||
    s === "success" ||
    s === "completed" ||
    s === "confirmed" ||
    s === "landed"
  );
}
