export {
  getProvider,
  getDeployerSigner,
  checkConnection,
  getBalance,
  resetProvider,
} from "./monad.js";

export {
  createAgentWallet,
  createAgentWallets,
  getWalletSigner,
  getWalletBalance,
  fundWallet,
} from "./wallet.js";
export type { AgentWallet } from "./wallet.js";

export {
  getFactoryContract,
  getGameContract,
  createOnChainGame,
  joinOnChainGame,
  startOnChainGame,
  finishOnChainGame,
  getOnChainGameStatus,
  GAME_FACTORY_ABI,
  MAFIA_GAME_ABI,
} from "./contracts.js";

export {
  WagerType,
  encodeTeamBet,
  encodeEliminationBet,
  encodeIdentityBet,
  placeWager,
  getWagerCount,
  getWagerPool,
  OffChainWagerSystem,
} from "./wagering.js";
export type { OffChainWager } from "./wagering.js";
