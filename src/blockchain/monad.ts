import { ethers } from "ethers";
import { config } from "../config.js";

let provider: ethers.JsonRpcProvider | null = null;

/** Get or create the Monad JSON-RPC provider. */
export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
  }
  return provider;
}

/** Get the deployer signer (for contract deployment and game hosting). */
export function getDeployerSigner(): ethers.Wallet {
  if (!config.blockchain.deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY not set in environment");
  }
  return new ethers.Wallet(config.blockchain.deployerPrivateKey, getProvider());
}

/** Check if the provider is connected. */
export async function checkConnection(): Promise<{
  connected: boolean;
  chainId?: bigint;
  blockNumber?: number;
}> {
  try {
    const network = await getProvider().getNetwork();
    const blockNumber = await getProvider().getBlockNumber();
    return {
      connected: true,
      chainId: network.chainId,
      blockNumber,
    };
  } catch {
    return { connected: false };
  }
}

/** Get balance of an address in MON. */
export async function getBalance(address: string): Promise<string> {
  const balance = await getProvider().getBalance(address);
  return ethers.formatEther(balance);
}

/** Reset provider (useful for tests). */
export function resetProvider(): void {
  provider = null;
}
