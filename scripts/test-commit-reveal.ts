import { ethers } from "ethers";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadArtifact(name: string) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", `${name}.json`), "utf-8"),
  );
}

async function main() {
  console.log("=== Commit-Reveal On-Chain Test ===\n");

  const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  const factoryArtifact = loadArtifact("GameFactory");
  const gameArtifact = loadArtifact("MafiaGame");

  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} MON\n`);

  // Step 1: Create game via factory
  console.log("1. Creating game via factory...");
  const factory = new ethers.Contract(
    process.env.FACTORY_CONTRACT_ADDRESS!,
    factoryArtifact.abi,
    wallet,
  );
  const entryFee = ethers.parseEther("0.01"); // small fee for test
  const createTx = await factory.createGame(5, entryFee);
  const createReceipt = await createTx.wait();

  const iface = new ethers.Interface(factoryArtifact.abi);
  let gameAddress: string | null = null;
  for (const log of createReceipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "GameCreated") {
        gameAddress = parsed.args[0];
        break;
      }
    } catch {}
  }
  if (!gameAddress) throw new Error("GameCreated event not found");
  console.log(`   Game: ${gameAddress}\n`);

  const game = new ethers.Contract(gameAddress, gameArtifact.abi, wallet);

  // Step 2: Join 5 players
  console.log("2. Joining 5 players...");
  const fee = await game.entryFee();
  for (let i = 0; i < 5; i++) {
    const pw = ethers.Wallet.createRandom().connect(provider);
    const fundTx = await wallet.sendTransaction({
      to: pw.address,
      value: fee + ethers.parseEther("0.05"),
    });
    await fundTx.wait();
    const joinTx = await game.connect(pw).join({ value: fee });
    await joinTx.wait();
    console.log(`   Player ${i + 1} joined`);
  }

  // Step 3: Start game
  console.log("\n3. Starting game...");
  const startTx = await game.startGame();
  await startTx.wait();
  console.log("   Game started!");

  // Step 4: Commit roles
  const roles = ["mafia", "detective", "doctor", "villager", "villager"];
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const commitments = roles.map((role, i) =>
    ethers.solidityPackedKeccak256(
      ["uint256", "string", "bytes32"],
      [i, role, salt],
    ),
  );

  console.log("\n4. Committing roles on-chain...");
  const commitTx = await game.commitRoles(commitments);
  const commitReceipt = await commitTx.wait();
  console.log(`   Tx: ${commitReceipt.hash}`);

  const committed = await game.rolesCommitted();
  console.log(`   rolesCommitted: ${committed}`);

  const onChainCommitments = await game.getRoleCommitments();
  console.log(`   Commitments stored: ${onChainCommitments.length}`);

  // Step 5: Finish game
  console.log("\n5. Finishing game...");
  const finishTx = await game.finishGame(0, [1, 2, 3, 4]); // village wins
  await finishTx.wait();
  console.log("   Game finished!");

  // Step 6: Reveal roles
  console.log("\n6. Revealing roles on-chain...");
  const revealTx = await game.revealRoles(roles, salt);
  const revealReceipt = await revealTx.wait();
  console.log(`   Tx: ${revealReceipt.hash}`);

  const revealed = await game.rolesRevealed();
  const onChainSalt = await game.revealSalt();
  const revealedRoles = await game.getRevealedRoles();
  console.log(`   rolesRevealed: ${revealed}`);
  console.log(`   salt: ${onChainSalt}`);
  console.log(`   roles: ${JSON.stringify(revealedRoles)}`);

  // Step 7: Verify individual roles
  console.log("\n7. Verifying roles...");
  const valid0 = await game.verifyRole(0, "mafia", salt);
  const valid1 = await game.verifyRole(1, "detective", salt);
  const invalid0 = await game.verifyRole(0, "villager", salt);
  console.log(`   verifyRole(0, "mafia"):    ${valid0} (expect true)`);
  console.log(`   verifyRole(1, "detective"): ${valid1} (expect true)`);
  console.log(`   verifyRole(0, "villager"):  ${invalid0} (expect false)`);

  if (!valid0 || !valid1 || invalid0) {
    throw new Error("Role verification mismatch!");
  }

  const EXPLORER = process.env.MONAD_EXPLORER_URL ||
    (process.env.MONAD_RPC_URL?.includes("testnet")
      ? "https://testnet.monadexplorer.com"
      : "https://monadvision.com");

  console.log("\n=== COMMIT-REVEAL ON-CHAIN TEST PASSED ===");
  console.log(`Game: ${EXPLORER}/address/${gameAddress}`);
  console.log(`Commit Tx: ${EXPLORER}/tx/${commitReceipt.hash}`);
  console.log(`Reveal Tx: ${EXPLORER}/tx/${revealReceipt.hash}`);
}

main().catch((err) => {
  console.error("Test failed:", err.message ?? err);
  process.exit(1);
});
