import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

function readContract(filename: string): string {
  return fs.readFileSync(path.join(CONTRACTS_DIR, filename), "utf-8");
}

console.log("=== Agent Mafia — Contract Compiler ===\n");

// Read all .sol sources
const sources: Record<string, { content: string }> = {};
const solFiles = fs
  .readdirSync(CONTRACTS_DIR)
  .filter((f) => f.endsWith(".sol"));

for (const file of solFiles) {
  sources[file] = { content: readContract(file) };
  console.log(`  Source: ${file}`);
}

if (solFiles.length === 0) {
  console.error("No .sol files found in contracts/");
  process.exit(1);
}

// Prepare solc standard JSON input
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

// Import callback — resolves local imports (e.g. "./MafiaGame.sol")
function findImports(importPath: string) {
  const resolved = path.join(CONTRACTS_DIR, importPath);
  if (fs.existsSync(resolved)) {
    return { contents: fs.readFileSync(resolved, "utf-8") };
  }
  return { error: `File not found: ${importPath}` };
}

console.log("\nCompiling...\n");

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImports }),
);

// Check for errors
if (output.errors) {
  let hasError = false;
  for (const err of output.errors) {
    if (err.severity === "error") {
      console.error(`ERROR: ${err.formattedMessage}`);
      hasError = true;
    } else {
      console.warn(`WARNING: ${err.formattedMessage}`);
    }
  }
  if (hasError) {
    console.error("\nCompilation failed.");
    process.exit(1);
  }
}

// Create artifacts directory
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

// Write artifacts
let count = 0;
for (const [sourceName, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [contractName, contractData] of Object.entries(
    contracts as Record<string, any>,
  )) {
    const artifact = {
      contractName,
      sourceName,
      abi: contractData.abi,
      bytecode: "0x" + contractData.evm.bytecode.object,
    };

    const outPath = path.join(ARTIFACTS_DIR, `${contractName}.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    console.log(
      `  Artifact: ${contractName}.json (${artifact.bytecode.length} bytes bytecode)`,
    );
    count++;
  }
}

console.log(`\nDone! ${count} contract(s) compiled to artifacts/`);
