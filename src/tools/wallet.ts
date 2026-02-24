import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  pair,
  waitForApproval,
  getSessionInfo,
  getAdapter,
} from "../wallet/index.js";
import { executeSteps } from "../execute-steps.js";
import type { Step } from "../relay-api.js";

// Module-level ref to the pending approval promise from the most recent `pair` call.
let pendingApproval: Promise<void> | null = null;

export function register(server: McpServer) {
  server.tool(
    "wallet",
    `Connect a user's wallet via WalletConnect. The user scans a QR code with their mobile wallet (MetaMask, Rainbow, etc.) to approve transactions — private keys never leave their device.

Actions:
  pair      — Returns a WalletConnect URI. You MUST then display it as a QR code (see below), then IMMEDIATELY call status to wait for connection.
  status    — Waits up to 60s for the wallet to connect. Blocks until connected or timeout. Call this right after rendering the QR.
  execute   — Execute ALL steps from execute_bridge in order. Handles multi-step flows (approval + deposit) and both transaction and signature steps automatically.
  disconnect — End the wallet session.

IMPORTANT: After calling pair, you must:
1. Render the returned URI as a QR code using the bash command below.
2. Immediately call wallet with action 'status' — it will block until the user scans and connects (up to 60s).

Run this bash command to render the QR as an image, substituting the URI:

python3 -c "
import qrcode, tempfile, os
qr = qrcode.QRCode(border=3, box_size=10, error_correction=qrcode.constants.ERROR_CORRECT_L)
qr.add_data('WALLETCONNECT_URI_HERE')
qr.make()
img = qr.make_image(fill_color='black', back_color='white')
p = os.path.join(tempfile.gettempdir(), 'relay-wc-qr.png')
img.save(p)
os.system(f'open {p}')
print(f'QR code opened: {p}')
"

If python3 qrcode is not installed, run: pip3 install "qrcode[pil]"

Typical flow: pair → render QR via bash → (user scans) → status → execute_bridge → execute → get_transaction_status`,
    {
      action: z
        .enum(["pair", "status", "execute", "disconnect"])
        .describe("The wallet action to perform."),
      chainIds: z
        .array(z.number())
        .optional()
        .describe(
          'Chain IDs to request access to. Required for "pair". E.g. [1, 8453] for Ethereum + Base.'
        ),
      steps: z
        .array(
          z.object({
            id: z.string(),
            action: z.string(),
            description: z.string(),
            kind: z.enum(["transaction", "signature"]),
            requestId: z.string(),
            items: z.array(
              z.object({
                status: z.string(),
                data: z.any(),
                check: z
                  .object({
                    endpoint: z.string(),
                    method: z.string(),
                  })
                  .optional(),
              })
            ),
          })
        )
        .optional()
        .describe(
          'The steps array from execute_bridge. Required for "execute". Contains all steps (approval, deposit, signatures) to execute in order.'
        ),
    },
    async ({ action, chainIds, steps }) => {
      switch (action) {
        case "pair": {
          if (!chainIds || chainIds.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: 'Error: chainIds is required for the "pair" action. Provide the chain IDs you need (e.g. [1, 8453]).',
                },
              ],
              isError: true,
            };
          }

          const { uri, approval } = await pair(chainIds);
          pendingApproval = approval;

          return {
            content: [
              {
                type: "text",
                text: `WalletConnect URI:\n${uri}`,
              },
              {
                type: "text",
                text: "Display the URI above as a QR code for the user (see tool description for bash command), then IMMEDIATELY call wallet with action 'status' to wait for the connection.",
              },
            ],
          };
        }

        case "status": {
          if (pendingApproval) {
            try {
              await waitForApproval(pendingApproval, 60_000);
              pendingApproval = null;
            } catch {
              // Timed out — fall through to check state
            }
          }

          const state = getSessionInfo();
          if (!state.connected) {
            return {
              content: [
                {
                  type: "text",
                  text: pendingApproval
                    ? "Wallet not connected yet — the user may still be scanning. Call status again to keep waiting."
                    : 'No wallet connected. Use wallet with action "pair" to start.',
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Wallet connected! Address: ${state.address}, chains: ${JSON.stringify(state.chains)}`,
              },
            ],
          };
        }

        case "execute": {
          if (!steps || steps.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: 'Error: steps is required for the "execute" action. Pass the steps array from execute_bridge.',
                },
              ],
              isError: true,
            };
          }

          // If pairing is still pending, wait for it
          if (pendingApproval) {
            try {
              await waitForApproval(pendingApproval, 120_000);
              pendingApproval = null;
            } catch (err) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: Wallet pairing not completed. ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                isError: true,
              };
            }
          }

          const adapter = getAdapter();
          const result = await executeSteps(adapter, steps as Step[]);

          if (!result.success) {
            return {
              content: [
                { type: "text", text: result.error || "Execution failed." },
                { type: "text", text: result.log.join("\n") },
              ],
              isError: true,
            };
          }

          const trackingUrl = `https://relay.link/transaction/${result.requestId}`;

          return {
            content: [
              {
                type: "text",
                text: `All ${steps.length} step(s) executed successfully! Poll get_transaction_status with requestId "${result.requestId}" every ~5s until "success". The user does NOT need to do anything else — Relay handles the rest.\n\nTracking URL: ${trackingUrl}\nShow this link to the user so they can follow along. Once status is "success", present the link as the final confirmation.`,
              },
              { type: "text", text: result.log.join("\n") },
            ],
          };
        }

        case "disconnect": {
          const adapter = (() => {
            try {
              return getAdapter();
            } catch {
              return null;
            }
          })();
          if (adapter) {
            await adapter.disconnect();
          }
          pendingApproval = null;
          return {
            content: [{ type: "text", text: "Wallet disconnected." }],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown action: ${action}. Use one of: pair, status, execute, disconnect.`,
              },
            ],
            isError: true,
          };
      }
    }
  );
}
