import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import "dotenv/config";

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
    console.error(
      `Artifact not found: ${filePath}\nRun 'npm run compile' first.`,
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function main() {
  console.log("=== Agent Mafia — Contract Deployer ===\n");

  // Validate env
  const rpcUrl = process.env.MONAD_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl) {
    console.error("MONAD_RPC_URL not set in .env");
    process.exit(1);
  }
  if (!privateKey || privateKey === "0x...") {
    console.error(
      "DEPLOYER_PRIVATE_KEY not set in .env\n" +
        "Generate a wallet and fund it with MON.",
    );
    process.exit(1);
  }

  // Connect
  console.log(`RPC: ${rpcUrl}`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    const network = await provider.getNetwork();
    console.log(`Chain ID: ${network.chainId}`);
  } catch (err) {
    console.error("Failed to connect to RPC. Check MONAD_RPC_URL.");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} MON\n`);

  if (balance === 0n) {
    console.error(
      "Deployer wallet has 0 MON. Fund the wallet before deploying.",
    );
    process.exit(1);
  }

  // Load artifact
  const factoryArtifact = loadArtifact("GameFactory");
  console.log("Deploying GameFactory...");

  // Deploy
  const factory = new ethers.ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    wallet,
  );

  const contract = await factory.deploy();
  console.log(`  Tx hash: ${contract.deploymentTransaction()?.hash}`);
  console.log("  Waiting for confirmation...");

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n=== DEPLOYMENT SUCCESSFUL ===`);
  console.log(`  GameFactory: ${address}`);
  console.log(`  Explorer: ${EXPLORER}/address/${address}`);
  console.log(`  Tx: ${EXPLORER}/tx/${contract.deploymentTransaction()?.hash}`);

  // Verify owner
  const owner = await contract.owner();
  console.log(`  Owner: ${owner}`);

  console.log(`\n--- Next Steps ---`);
  console.log(`1. Update .env with:`);
  console.log(`   FACTORY_CONTRACT_ADDRESS=${address}`);
  console.log(`2. Run 'npm run test:onchain' to verify deployment`);
  console.log(`3. Check explorer: ${EXPLORER}/address/${address}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err.message ?? err);
  process.exit(1);
});
