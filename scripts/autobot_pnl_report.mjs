import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_LOG_DIR = ".artifacts/autobot";
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getArgValue(prefix) {
  const arg = process.argv.find((entry) => entry.startsWith(`${prefix}=`));
  if (!arg) {
    return null;
  }
  return arg.slice(prefix.length + 1);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toHttpUrlOrNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function parseJsonLine(line, filePath, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return {
      _parseError: true,
      _filePath: filePath,
      _lineNumber: lineNumber,
      _raw: trimmed,
    };
  }
}

async function readLogRecords(logDir, dayFilter) {
  const files = await readdir(logDir);
  const candidates = files
    .filter((name) => name.startsWith("profit-loop-") && name.endsWith(".jsonl"))
    .sort();

  const selected = dayFilter
    ? candidates.filter((name) => name.includes(dayFilter))
    : candidates;

  const records = [];
  for (const name of selected) {
    const path = resolve(logDir, name);
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const parsed = parseJsonLine(lines[index], path, index + 1);
      if (!parsed) {
        continue;
      }
      parsed._file = name;
      records.push(parsed);
    }
  }

  records.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  return { records, selectedFiles: selected };
}

function uniqueExecutedTrades(records) {
  const seen = new Set();
  const output = [];

  for (const record of records) {
    const signature = record?.liveExecution?.signature;
    if (!signature || typeof signature !== "string") {
      continue;
    }

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    output.push(record);
  }

  return output;
}

function summarizeEstimated(records, executedTrades) {
  let expectedNetUsdSum = 0;
  let expectedNetUsdCount = 0;
  let expectedNetUsdPositiveCount = 0;
  let expectedNetUsdNegativeCount = 0;

  const failureCounts = new Map();
  for (const record of records) {
    const failures = Array.isArray(record?.guardrails?.failures)
      ? record.guardrails.failures
      : [];
    for (const reason of failures) {
      failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
    }
  }

  for (const trade of executedTrades) {
    const value = toFiniteNumber(trade?.profitGate?.expectedNetUsd);
    if (value === null) {
      continue;
    }

    expectedNetUsdSum += value;
    expectedNetUsdCount += 1;
    if (value >= 0) {
      expectedNetUsdPositiveCount += 1;
    } else {
      expectedNetUsdNegativeCount += 1;
    }
  }

  return {
    expectedNetUsdSum,
    expectedNetUsdCount,
    expectedNetUsdPositiveCount,
    expectedNetUsdNegativeCount,
    guardrailFailureCounts: Object.fromEntries(
      [...failureCounts.entries()].sort((a, b) => b[1] - a[1]),
    ),
  };
}

async function rpcRequest(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed (${response.status})`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`RPC ${method} error: ${payload.error.message}`);
  }

  return payload.result;
}

function findWalletIndex(message, wallet) {
  const accountKeys = Array.isArray(message?.accountKeys) ? message.accountKeys : [];
  for (let index = 0; index < accountKeys.length; index += 1) {
    const key = accountKeys[index];
    const pubkey = typeof key === "string" ? key : key?.pubkey;
    if (pubkey === wallet) {
      return index;
    }
  }
  return -1;
}

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
      continue;
    }
  }

  return total;
}

async function summarizeRealized(executedTrades, rpcUrl, usdcMint) {
  const results = [];

  for (const record of executedTrades) {
    const signature = record?.liveExecution?.signature;
    const wallet = record?.liveExecution?.wallet ?? record?.orderParams?.userPublicKey;
    if (!signature || !wallet) {
      continue;
    }

    try {
      const tx = await rpcRequest(rpcUrl, "getTransaction", [
        signature,
        {
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ]);

      if (!tx?.meta || !tx?.transaction?.message) {
        results.push({ signature, wallet, status: "missing_transaction_meta" });
        continue;
      }

      const walletIndex = findWalletIndex(tx.transaction.message, wallet);
      if (walletIndex < 0) {
        results.push({ signature, wallet, status: "wallet_not_found_in_accounts" });
        continue;
      }

      const preLamports = tx.meta.preBalances?.[walletIndex];
      const postLamports = tx.meta.postBalances?.[walletIndex];
      if (!Number.isFinite(preLamports) || !Number.isFinite(postLamports)) {
        results.push({ signature, wallet, status: "missing_sol_balances" });
        continue;
      }

      const preUsdcAtomic = sumTokenBalanceAtomic(tx.meta.preTokenBalances, wallet, usdcMint);
      const postUsdcAtomic = sumTokenBalanceAtomic(tx.meta.postTokenBalances, wallet, usdcMint);

      const solDelta = (postLamports - preLamports) / 1_000_000_000;
      const usdcDelta = Number(postUsdcAtomic - preUsdcAtomic) / 1_000_000;
      const feeLamports = Number(tx.meta.fee ?? 0);
      const solUsd = toFiniteNumber(record?.profitGate?.referencePrice?.solUsd);
      const realizedUsd =
        solUsd === null ? null : usdcDelta + solDelta * solUsd;

      results.push({
        signature,
        wallet,
        status: "ok",
        timestamp: record?.timestamp ?? null,
        solDelta,
        usdcDelta,
        feeLamports,
        solUsd,
        realizedUsd,
      });
    } catch (error) {
      results.push({
        signature,
        wallet,
        status: "rpc_error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let sumSolDelta = 0;
  let sumUsdcDelta = 0;
  let sumRealizedUsd = 0;
  let realizedUsdCount = 0;

  for (const row of results) {
    if (row.status !== "ok") {
      continue;
    }

    sumSolDelta += row.solDelta;
    sumUsdcDelta += row.usdcDelta;
    if (toFiniteNumber(row.realizedUsd) !== null) {
      sumRealizedUsd += row.realizedUsd;
      realizedUsdCount += 1;
    }
  }

  return {
    realizedRows: results,
    summary: {
      sumSolDelta,
      sumUsdcDelta,
      sumRealizedUsd,
      realizedUsdCount,
      nonOkRows: results.filter((row) => row.status !== "ok").length,
    },
  };
}

async function main() {
  const logDir = getArgValue("--log-dir") ?? DEFAULT_LOG_DIR;
  const day = getArgValue("--day");
  const realizedMode = hasFlag("--realized");
  const usdcMint = getArgValue("--usdc-mint") ?? DEFAULT_USDC_MINT;

  const { records, selectedFiles } = await readLogRecords(logDir, day);
  const parseErrors = records.filter((row) => row?._parseError === true);
  const normalRecords = records.filter((row) => row?._parseError !== true);

  const executedTrades = uniqueExecutedTrades(normalRecords);
  const estimated = summarizeEstimated(normalRecords, executedTrades);

  const baseReport = {
    generatedAt: new Date().toISOString(),
    logDir,
    selectedFiles,
    filters: {
      day: day ?? null,
      realizedMode,
    },
    totals: {
      records: normalRecords.length,
      parseErrors: parseErrors.length,
      executedTrades: executedTrades.length,
      skippedOrRejectedCycles: normalRecords.filter((row) => !row?.liveExecution?.signature).length,
    },
    estimated,
  };

  if (!realizedMode) {
    console.log(JSON.stringify(baseReport, null, 2));
    return;
  }

  const rpcUrlFromEnv = toHttpUrlOrNull(process.env.SOLANA_RPC_URL ?? null);
  const rpcUrlFromLogs = normalRecords
    .map((row) => toHttpUrlOrNull(row?.endpoints?.rpcUrl))
    .find(Boolean);
  const rpcUrl = rpcUrlFromEnv ?? rpcUrlFromLogs;
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL is required and must start with http:// or https:// for --realized");
  }

  const realized = await summarizeRealized(executedTrades, rpcUrl, usdcMint);
  console.log(
    JSON.stringify(
      {
        ...baseReport,
        realized: realized.summary,
        realizedRowsPreview: realized.realizedRows.slice(-20),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
