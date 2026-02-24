export type { WalletAdapter, VmType, TransactionRequest, SignTypedDataRequest } from "./adapter.js";
export {
  pair,
  waitForApproval,
  isConnected,
  getSessionInfo,
  getAdapter,
} from "./evm-walletconnect.js";
