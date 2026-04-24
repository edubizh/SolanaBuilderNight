import test from "node:test";
import assert from "node:assert/strict";
import { waitForSignatureConfirmedRpc } from "../../../services/execution-orchestrator/adapters/dflow/solanaRpcConfirm.mjs";

test("waitForSignatureConfirmedRpc confirms after brief pending (mocked RPC)", async () => {
  let poll = 0;
  const fetchImpl = async () => {
    poll += 1;
    if (poll < 2) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            context: { slot: 1 },
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
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 3 },
          value: [
            {
              err: null,
              confirmationStatus: "confirmed",
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const r = await waitForSignatureConfirmedRpc({
    rpcUrl: "https://mock-rpc.test",
    signature: "5".repeat(88),
    lastValidBlockHeight: null,
    pollIntervalMs: 0,
    maxWaitMs: 5_000,
    fetchImpl,
  });
  assert.equal(r.ok, true);
  assert.equal(poll >= 2, true);
});

test("waitForSignatureConfirmedRpc exits on block height exceeded", async () => {
  let bhCalls = 0;
  const fetchImpl = async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body.method === "getBlockHeight") {
      bhCalls += 1;
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: 100 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 1 },
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
  };

  const r = await waitForSignatureConfirmedRpc({
    rpcUrl: "https://mock-rpc.test",
    signature: "3".repeat(88),
    lastValidBlockHeight: 50,
    pollIntervalMs: 0,
    maxWaitMs: 2_000,
    fetchImpl,
  });
  assert.equal(r.blockHeightExceeded, true);
  assert.equal(r.ok, false);
  assert.equal(bhCalls >= 1, true);
});
