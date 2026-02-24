/**
 * Step executor — walks through Relay quote steps sequentially,
 * signing transactions and messages via a WalletAdapter.
 *
 * This module is VM-agnostic: it delegates all chain-specific work
 * to the adapter. When SVM/BVM support is added, only the adapter
 * implementation changes — this file stays the same.
 */

import type { WalletAdapter } from "./wallet/adapter.js";
import type { Step } from "./relay-api.js";
import { relayApi, pollStepCheck } from "./relay-api.js";

export interface ExecutionResult {
  success: boolean;
  requestId: string;
  log: string[];
  error?: string;
}

/**
 * Execute all steps from a Relay quote in order.
 *
 * For each step:
 *   - kind "transaction": send via adapter.sendTransaction, poll check endpoint
 *   - kind "signature": sign via adapter.signTypedData/signMessage, POST if needed, poll check
 *
 * Approval steps block on full confirmation before proceeding to the next step.
 * Deposit steps return once the relay network has picked up the request.
 */
export async function executeSteps(
  adapter: WalletAdapter,
  steps: Step[]
): Promise<ExecutionResult> {
  const log: string[] = [];
  let lastRequestId = "";

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    lastRequestId = step.requestId || lastRequestId;

    log.push(
      `\n--- Step ${stepIdx + 1}/${steps.length}: ${step.action} (${step.kind}) ---`
    );

    for (let itemIdx = 0; itemIdx < step.items.length; itemIdx++) {
      const item = step.items[itemIdx];

      if (item.status === "complete") {
        log.push(`  Item ${itemIdx + 1}: already complete, skipping.`);
        continue;
      }

      try {
        if (step.kind === "transaction") {
          await executeTransactionItem(adapter, step, item, log);
        } else if (step.kind === "signature") {
          await executeSignatureItem(adapter, step, item, steps, log);
        } else {
          log.push(`  WARNING: Unknown step kind "${step.kind}", skipping.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.push(`  ERROR: ${msg}`);
        return {
          success: false,
          requestId: lastRequestId,
          log,
          error: `Failed at step ${stepIdx + 1} (${step.action}): ${msg}`,
        };
      }
    }
  }

  log.push(`\nAll steps executed successfully!`);
  return { success: true, requestId: lastRequestId, log };
}

// ---------------------------------------------------------------------------
// Transaction steps
// ---------------------------------------------------------------------------

async function executeTransactionItem(
  adapter: WalletAdapter,
  step: Step,
  item: Step["items"][0],
  log: string[]
): Promise<void> {
  const txData = item.data;
  log.push(`  Sending transaction to wallet (chain ${txData.chainId})...`);

  const txHash = await adapter.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: txData.value,
    chainId: txData.chainId,
    gas: txData.gas,
    maxFeePerGas: txData.maxFeePerGas,
    maxPriorityFeePerGas: txData.maxPriorityFeePerGas,
  });

  log.push(`  Transaction signed! Tx hash: ${txHash}`);

  if (item.check) {
    log.push(`  Waiting for on-chain confirmation...`);
    const result = await pollStepCheck(item.check, step.id, {
      intervalMs: 3000,
    });
    log.push(`  Confirmed! Status: ${result.status}`);
  }
}

// ---------------------------------------------------------------------------
// Signature steps
// ---------------------------------------------------------------------------

async function executeSignatureItem(
  adapter: WalletAdapter,
  step: Step,
  item: Step["items"][0],
  allSteps: Step[],
  log: string[]
): Promise<void> {
  const signData = item.data?.sign;
  const postData = item.data?.post;
  let signature: string | undefined;

  if (signData) {
    log.push(`  Requesting signature from wallet...`);

    if (signData.signatureKind === "eip712") {
      signature = await adapter.signTypedData({
        domain: signData.domain,
        types: signData.types,
        primaryType: signData.primaryType,
        value: signData.value,
        chainId: item.data?.chainId || 1,
      });
    } else if (signData.signatureKind === "eip191") {
      signature = await adapter.signMessage(signData.message || "");
    } else {
      throw new Error(
        `Unsupported signatureKind: ${signData.signatureKind}`
      );
    }

    log.push(`  Signature obtained!`);
  }

  if (postData) {
    log.push(`  Posting to ${postData.endpoint}...`);

    const params: Record<string, string> = {};
    if (signature) params.signature = signature;

    const res = await relayApi<any>(postData.endpoint, {
      method: postData.method as "POST",
      body: postData.body || {},
      params: Object.keys(params).length > 0 ? params : undefined,
    });

    // The API may return additional steps to execute (dynamic step injection)
    if (res?.steps && Array.isArray(res.steps)) {
      log.push(`  Post returned ${res.steps.length} additional step(s).`);
      allSteps.push(...res.steps);
    }

    log.push(`  Posted successfully!`);
  }

  if (item.check) {
    log.push(`  Waiting for validation...`);
    const result = await pollStepCheck(item.check, step.id, {
      intervalMs: 3000,
    });
    log.push(`  Validated! Status: ${result.status}`);
  }
}
