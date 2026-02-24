/**
 * VM-agnostic wallet adapter interface.
 *
 * Each chain family (EVM, SVM, etc.) implements this interface to provide
 * transaction signing and message signing capabilities. The step executor
 * and MCP tools work against this interface — they never touch chain-specific
 * signing logic directly.
 */

export type VmType = "evm" | "svm" | "bvm" | "suivm" | "tvm";

export interface WalletAdapter {
  /** Which VM family this adapter handles. */
  readonly vmType: VmType;

  /** The connected wallet address (chain-native format). */
  address(): string;

  /**
   * Send a transaction and return its hash/signature.
   * The adapter is responsible for mapping the generic tx data
   * to the chain's native format and submitting it.
   */
  sendTransaction(tx: TransactionRequest): Promise<string>;

  /**
   * Sign EIP-712 typed data (EVM) or equivalent structured signing for other VMs.
   * Returns the signature string.
   */
  signTypedData(params: SignTypedDataRequest): Promise<string>;

  /**
   * Sign a plain message (EIP-191 personal_sign for EVM, equivalent for other VMs).
   * Returns the signature string.
   */
  signMessage(message: string): Promise<string>;

  /** Disconnect / clean up. */
  disconnect(): Promise<void>;
}

/** Generic transaction request — fields present depend on VM type. */
export interface TransactionRequest {
  to: string;
  data: string;
  value: string;
  chainId: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  // SVM fields (future)
  instructions?: unknown[];
  // BVM fields (future)
  psbt?: string;
}

/** EIP-712 / structured signing request. */
export interface SignTypedDataRequest {
  domain: any;
  types: any;
  primaryType: string;
  value: any;
  chainId: number;
}
