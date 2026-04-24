import test from "node:test";
import assert from "node:assert/strict";
import {
  RPC_FETCH_MAX_ATTEMPTS,
  getSignatureConfirmationRpc,
  isDflowOrderStatusFilled,
  isHttpRpcUrl,
  rpcJsonRequestWithRetries,
} from "../../../services/execution-orchestrator/adapters/dflow/solanaRpcConfirm.mjs";

test("isHttpRpcUrl accepts only http(s)", () => {
  assert.equal(isHttpRpcUrl("https://devnet.helius-rpc.com"), true);
  assert.equal(isHttpRpcUrl("  https://x "), true);
  assert.equal(isHttpRpcUrl("ws://x"), false);
  assert.equal(isHttpRpcUrl(null), false);
});

test("isDflowOrderStatusFilled normalizes case", () => {
  assert.equal(isDflowOrderStatusFilled("Filled"), true);
  assert.equal(isDflowOrderStatusFilled("SUCCEEDED"), true);
  assert.equal(isDflowOrderStatusFilled("failed"), false);
});

test("rpcJsonRequestWithRetries succeeds on first call when response ok", async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { slot: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await rpcJsonRequestWithRetries("https://example.invalid", "getSlot", [], { fetchImpl });
  assert.equal(result.slot, 1);
  assert.equal(calls, 1);
  assert.equal(RPC_FETCH_MAX_ATTEMPTS, 4);
});

test("rpcJsonRequestWithRetries retries on fetch failed and then succeeds", async () => {
  const delays = [];
  const fetchImpl = async () => {
    delays.push(Date.now());
    if (delays.length < 3) {
      throw new TypeError("fetch failed");
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await rpcJsonRequestWithRetries("https://example.invalid", "getVersion", [], {
    fetchImpl,
    retryBackoffMs: [0, 0, 0],
  });
  assert.equal(result, "ok");
  assert.equal(delays.length, 3);
});

test("getSignatureConfirmationRpc returns ok when status finalized", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 9 },
          value: [
            {
              err: null,
              confirmationStatus: "finalized",
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const r = await getSignatureConfirmationRpc("https://x", "abc", { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.confirmationStatus, "finalized");
});

test("getSignatureConfirmationRpc returns pending when not yet confirmed", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 2 },
          value: [
            {
              err: null,
              confirmationStatus: "processed",
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const r = await getSignatureConfirmationRpc("https://x", "sig1", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "pending");
});
