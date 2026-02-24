/**
 * EVM wallet adapter backed by WalletConnect v2.
 *
 * The user scans a QR code with their mobile wallet (MetaMask, Rainbow, etc.)
 * to connect. Private keys never leave the device — all signing happens
 * on the phone and only the result (tx hash / signature) comes back.
 */

import { SignClient } from "@walletconnect/sign-client";
import type {
  WalletAdapter,
  TransactionRequest,
  SignTypedDataRequest,
} from "./adapter.js";

const PROJECT_ID = process.env.WALLETCONNECT_PROJECT_ID || "";

interface WcSession {
  client: InstanceType<typeof SignClient>;
  topic: string;
  accounts: string[]; // CAIP-10: eip155:1:0x...
  chains: number[];
}

let wcClient: InstanceType<typeof SignClient> | null = null;
let wcSession: WcSession | null = null;

async function getClient(): Promise<InstanceType<typeof SignClient>> {
  if (wcClient) return wcClient;
  if (!PROJECT_ID) {
    throw new Error(
      "WALLETCONNECT_PROJECT_ID env var is required. Get one free at https://cloud.walletconnect.com"
    );
  }
  wcClient = await SignClient.init({
    projectId: PROJECT_ID,
    metadata: {
      name: "Relay MCP",
      description: "Cross-chain bridge and swap tools for AI agents",
      url: "https://relay.link",
      icons: ["https://relay.link/relay-icon.png"],
    },
  });

  wcClient.on("session_delete", () => {
    wcSession = null;
  });

  return wcClient;
}

// ---------------------------------------------------------------------------
// Connection management (not part of WalletAdapter — these are WC-specific)
// ---------------------------------------------------------------------------

/**
 * Create a WalletConnect pairing URI for the user to scan.
 * Returns the URI and a promise that resolves when the wallet approves.
 */
export async function pair(
  chainIds: number[]
): Promise<{ uri: string; approval: Promise<void> }> {
  const client = await getClient();

  // Tear down existing session
  if (wcSession) {
    try {
      await client.disconnect({
        topic: wcSession.topic,
        reason: { code: 6000, message: "New pairing requested" },
      });
    } catch {
      // ignore
    }
    wcSession = null;
  }

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      eip155: {
        chains: chainIds.map((id) => `eip155:${id}`),
        methods: [
          "eth_sendTransaction",
          "personal_sign",
          "eth_signTypedData",
          "eth_signTypedData_v4",
        ],
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });

  if (!uri) {
    throw new Error("WalletConnect failed to generate pairing URI");
  }

  const approvalPromise = approval().then((approved) => {
    const eip155 = approved.namespaces.eip155;
    if (!eip155) throw new Error("Wallet did not approve eip155 namespace");
    wcSession = {
      client,
      topic: approved.topic,
      accounts: eip155.accounts || [],
      chains: (eip155.chains || []).map((c) =>
        Number(c.replace("eip155:", ""))
      ),
    };
  });

  return { uri, approval: approvalPromise };
}

/**
 * Block until the pending approval resolves or times out.
 */
export async function waitForApproval(
  approvalPromise: Promise<void>,
  timeoutMs = 120_000
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(new Error("WalletConnect pairing timed out")),
      timeoutMs
    )
  );
  await Promise.race([approvalPromise, timeout]);
  if (!wcSession) {
    throw new Error("Session was not established after approval");
  }
}

/**
 * Quick check: is there an active session?
 */
export function isConnected(): boolean {
  return wcSession !== null;
}

/**
 * Return session metadata (address + chains) without needing a full adapter.
 * Useful for the MCP tool's `status` action and for `execute_bridge` to
 * auto-detect the sender address.
 */
export function getSessionInfo(): {
  connected: boolean;
  address: string | null;
  chains: number[];
} {
  if (!wcSession) return { connected: false, address: null, chains: [] };
  const addr = wcSession.accounts[0]?.split(":")[2] || null;
  return { connected: true, address: addr, chains: wcSession.chains };
}

// ---------------------------------------------------------------------------
// WalletAdapter implementation
// ---------------------------------------------------------------------------

/**
 * Build a `WalletAdapter` from the current WalletConnect session.
 * Throws if no session is active — call `pair` + `waitForApproval` first.
 */
export function getAdapter(): WalletAdapter {
  if (!wcSession) {
    throw new Error("No WalletConnect session. Pair a wallet first.");
  }

  // Capture the session ref so the adapter stays bound to it
  const session = wcSession;
  const addr = session.accounts[0]?.split(":")[2];
  if (!addr) throw new Error("No account in WalletConnect session");

  const adapter: WalletAdapter = {
    vmType: "evm",

    address() {
      return addr;
    },

    async sendTransaction(tx: TransactionRequest): Promise<string> {
      return session.client.request<string>({
        topic: session.topic,
        chainId: `eip155:${tx.chainId}`,
        request: {
          method: "eth_sendTransaction",
          params: [
            {
              from: addr,
              to: tx.to,
              data: tx.data,
              value: tx.value,
              gas: tx.gas,
              maxFeePerGas: tx.maxFeePerGas,
              maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
            },
          ],
        },
      });
    },

    async signTypedData(params: SignTypedDataRequest): Promise<string> {
      const typedData = JSON.stringify({
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.value,
      });

      return session.client.request<string>({
        topic: session.topic,
        chainId: `eip155:${params.chainId}`,
        request: {
          method: "eth_signTypedData_v4",
          params: [addr, typedData],
        },
      });
    },

    async signMessage(message: string): Promise<string> {
      return session.client.request<string>({
        topic: session.topic,
        chainId: `eip155:${session.chains[0] || 1}`,
        request: {
          method: "personal_sign",
          params: [message, addr],
        },
      });
    },

    async disconnect(): Promise<void> {
      try {
        await session.client.disconnect({
          topic: session.topic,
          reason: { code: 6000, message: "User disconnected" },
        });
      } catch {
        // ignore
      }
      wcSession = null;
    },
  };

  return adapter;
}
