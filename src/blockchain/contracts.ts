import { ethers } from "ethers";
import { getProvider, getDeployerSigner } from "./monad.js";
import { config } from "../config.js";

// ─── ABI fragments (minimal for interaction) ────────────────
// Full ABIs would come from Hardhat compilation artifacts.
// These are the essential function signatures we need.

export const GAME_FACTORY_ABI = [
  "function createGame(uint256 maxPlayers, uint256 entryFee) external returns (address)",
  "function gameCount() external view returns (uint256)",
  "function getGames(uint256 offset, uint256 limit) external view returns (address[])",
  "function defaultEntryFee() external view returns (uint256)",
  "function owner() external view returns (address)",
  "event GameCreated(address indexed gameAddress, address indexed host, uint256 entryFee, uint256 maxPlayers)",
];

export const MAFIA_GAME_ABI = [
  "function join() external payable",
  "function startGame() external",
  "function finishGame(uint8 winner, uint256[] calldata winnerIndices) external",
  "function cancelGame() external",
  "function placeWager(uint8 wagerType, bytes32 prediction) external payable",
  "function claimReward() external",
  "function claimRefund() external",
  "function withdrawPlatformFees() external",
  "function commitRoles(bytes32[] calldata commitments) external",
  "function revealRoles(string[] calldata roles, bytes32 salt) external",
  "function verifyRole(uint256 playerIndex, string calldata role, bytes32 salt) external view returns (bool)",
  "function getRoleCommitments() external view returns (bytes32[])",
  "function getRevealedRoles() external view returns (string[])",
  "function rolesCommitted() external view returns (bool)",
  "function rolesRevealed() external view returns (bool)",
  "function revealSalt() external view returns (bytes32)",
  "function playerCount() external view returns (uint256)",
  "function wagerCount() external view returns (uint256)",
  "function status() external view returns (uint8)",
  "function entryFee() external view returns (uint256)",
  "function maxPlayers() external view returns (uint256)",
  "function totalEntryPool() external view returns (uint256)",
  "function totalWagerPool() external view returns (uint256)",
  "function winner() external view returns (uint8)",
  "event PlayerJoined(address indexed player, uint256 index)",
  "event GameStarted(uint256 playerCount)",
  "event WagerPlaced(address indexed bettor, uint8 wagerType, uint256 amount)",
  "event GameFinished(uint8 winner)",
  "event RewardClaimed(address indexed player, uint256 amount)",
  "event RolesCommitted(uint256 playerCount, bytes32 commitmentHash)",
  "event RolesRevealed(bytes32 salt, uint256 playerCount)",
];

// ─── Contract Instances ─────────────────────────────────────

/** Get a GameFactory contract instance. */
export function getFactoryContract(
  signerOrProvider?: ethers.Signer | ethers.Provider,
): ethers.Contract {
  const address = config.blockchain.factoryContractAddress;
  if (!address) throw new Error("FACTORY_CONTRACT_ADDRESS not set");
  return new ethers.Contract(
    address,
    GAME_FACTORY_ABI,
    signerOrProvider ?? getProvider(),
  );
}

/** Get a MafiaGame contract instance. */
export function getGameContract(
  gameAddress: string,
  signerOrProvider?: ethers.Signer | ethers.Provider,
): ethers.Contract {
  return new ethers.Contract(
    gameAddress,
    MAFIA_GAME_ABI,
    signerOrProvider ?? getProvider(),
  );
}

// ─── Factory Operations ─────────────────────────────────────

/** Create a new game on-chain via the factory. */
export async function createOnChainGame(
  maxPlayers: number,
  entryFeeInMON: string,
): Promise<{ gameAddress: string; txHash: string }> {
  const signer = getDeployerSigner();
  const factory = getFactoryContract(signer);

  const entryFee = ethers.parseEther(entryFeeInMON);
  const tx = await factory.createGame(maxPlayers, entryFee);
  const receipt = await tx.wait();

  // Parse the GameCreated event to get the game address
  const event = receipt.logs
    .map((log: ethers.Log) => {
      try {
        return factory.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
      } catch {
        return null;
      }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "GameCreated");

  if (!event) throw new Error("GameCreated event not found in receipt");

  return {
    gameAddress: event.args[0],
    txHash: receipt.hash,
  };
}

// ─── Game Operations ────────────────────────────────────────

/** Join a game by paying entry fee. */
export async function joinOnChainGame(
  gameAddress: string,
  playerSigner: ethers.Wallet,
): Promise<string> {
  const game = getGameContract(gameAddress, playerSigner);
  const entryFee: bigint = await game.entryFee();
  const tx = await game.join({ value: entryFee });
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Start a game on-chain. */
export async function startOnChainGame(
  gameAddress: string,
): Promise<string> {
  const signer = getDeployerSigner();
  const game = getGameContract(gameAddress, signer);
  const tx = await game.startGame();
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Finish a game and record winners. */
export async function finishOnChainGame(
  gameAddress: string,
  winner: "village" | "mafia",
  winnerIndices: number[],
): Promise<string> {
  const signer = getDeployerSigner();
  const game = getGameContract(gameAddress, signer);
  const winnerEnum = winner === "village" ? 0 : 1;
  const tx = await game.finishGame(winnerEnum, winnerIndices);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ─── Commit-Reveal ─────────────────────────────────────────

/**
 * Generate a random salt and compute role commitment hashes.
 * commitment[i] = keccak256(abi.encodePacked(i, role, salt))
 *
 * This mirrors the Solidity logic exactly so on-chain verification works.
 */
export function buildRoleCommitments(
  roles: string[],
): { salt: string; commitments: string[] } {
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const commitments = roles.map((role, i) =>
    ethers.solidityPackedKeccak256(
      ["uint256", "string", "bytes32"],
      [i, role, salt],
    ),
  );
  return { salt, commitments };
}

/** Commit role hashes on-chain after roles are assigned. */
export async function commitRolesOnChain(
  gameAddress: string,
  commitments: string[],
): Promise<string> {
  const signer = getDeployerSigner();
  const game = getGameContract(gameAddress, signer);
  const tx = await game.commitRoles(commitments);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Reveal roles and salt on-chain after game ends. */
export async function revealRolesOnChain(
  gameAddress: string,
  roles: string[],
  salt: string,
): Promise<string> {
  const signer = getDeployerSigner();
  const game = getGameContract(gameAddress, signer);
  const tx = await game.revealRoles(roles, salt);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Verify a single role on-chain (read-only). */
export async function verifyRoleOnChain(
  gameAddress: string,
  playerIndex: number,
  role: string,
  salt: string,
): Promise<boolean> {
  const game = getGameContract(gameAddress);
  return game.verifyRole(playerIndex, role, salt);
}

/** Get on-chain game status. */
export async function getOnChainGameStatus(
  gameAddress: string,
): Promise<{
  status: number;
  playerCount: bigint;
  entryFee: string;
  totalPool: string;
  wagerCount: bigint;
}> {
  const game = getGameContract(gameAddress);
  const [status, playerCount, entryFee, totalPool, wagerCount] =
    await Promise.all([
      game.status(),
      game.playerCount(),
      game.entryFee(),
      game.totalEntryPool(),
      game.wagerCount(),
    ]);

  return {
    status: Number(status),
    playerCount,
    entryFee: ethers.formatEther(entryFee),
    totalPool: ethers.formatEther(totalPool),
    wagerCount,
  };
}
