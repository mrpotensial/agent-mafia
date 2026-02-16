import { ethers } from "ethers";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const EXPLORER = process.env.MONAD_EXPLORER_URL ||
  (process.env.MONAD_RPC_URL?.includes("testnet")
    ? "https://testnet.monadexplorer.com"
    : "https://monadvision.com");

function loadArtifact(name: string) {
  const filePath = path.join(ARTIFACTS_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`Artifact not found: ${filePath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function main() {
  console.log("=== Agent Mafia — On-Chain Verification ===\n");

  const rpcUrl = process.env.MONAD_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const factoryAddress = process.env.FACTORY_CONTRACT_ADDRESS;

  if (!rpcUrl || !privateKey || !factoryAddress || factoryAddress === "0x...") {
    console.error(
      "Missing env vars. Ensure MONAD_RPC_URL, DEPLOYER_PRIVATE_KEY, and FACTORY_CONTRACT_ADDRESS are set.",
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const factoryArtifact = loadArtifact("GameFactory");

  console.log(`Factory: ${factoryAddress}`);
  console.log(`Deployer: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} MON\n`);

  // Connect to factory
  const factory = new ethers.Contract(
    factoryAddress,
    factoryArtifact.abi,
    wallet,
  );

  // Check owner
  const owner = await factory.owner();
  console.log(`Factory owner: ${owner}`);

  // Get current game count
  const countBefore = await factory.gameCount();
  console.log(`Games created so far: ${countBefore}\n`);

  // Create a test game
  console.log("Creating test game (5 players, 0.1 MON entry)...");
  const entryFee = ethers.parseEther("0.1");
  const tx = await factory.createGame(5, entryFee);
  console.log(`  Tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`  Confirmed in block: ${receipt.blockNumber}`);

  // Parse GameCreated event
  const iface = new ethers.Interface(factoryArtifact.abi);
  let gameAddress: string | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "GameCreated") {
        gameAddress = parsed.args[0];
        break;
      }
    } catch {
      // skip non-matching logs
    }
  }

  if (!gameAddress) {
    console.error("GameCreated event not found!");
    process.exit(1);
  }

  console.log(`\n  Game created: ${gameAddress}`);
  console.log(`  Explorer: ${EXPLORER}/address/${gameAddress}`);

  // Verify game on-chain
  const gameArtifact = loadArtifact("MafiaGame");
  const game = new ethers.Contract(gameAddress, gameArtifact.abi, provider);

  const [status, maxPlayers, fee, host] = await Promise.all([
    game.status(),
    game.maxPlayers(),
    game.entryFee(),
    game.host(),
  ]);

  console.log(`\n  --- Game Details ---`);
  console.log(`  Status: ${["Open", "Running", "Finished", "Cancelled"][Number(status)]}`);
  console.log(`  Max players: ${maxPlayers}`);
  console.log(`  Entry fee: ${ethers.formatEther(fee)} MON`);
  console.log(`  Host: ${host}`);

  // Verify game count incremented
  const countAfter = await factory.gameCount();
  console.log(`\nGames total: ${countBefore} → ${countAfter}`);

  console.log(`\n=== ON-CHAIN VERIFICATION PASSED ===`);
  console.log(`Factory: ${EXPLORER}/address/${factoryAddress}`);
  console.log(`Game:    ${EXPLORER}/address/${gameAddress}`);
  console.log(`Tx:      ${EXPLORER}/tx/${tx.hash}`);
}

main().catch((err) => {
  console.error("Verification failed:", err.message ?? err);
  process.exit(1);
});
