import { ethers } from "ethers";
import { getProvider } from "./monad.js";

export interface AgentWallet {
  address: string;
  privateKey: string;
}

/** Create a new random wallet for an AI agent. */
export function createAgentWallet(): AgentWallet {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

/** Create multiple agent wallets. */
export function createAgentWallets(count: number): AgentWallet[] {
  return Array.from({ length: count }, () => createAgentWallet());
}

/** Get a signer from a private key (connected to provider). */
export function getWalletSigner(privateKey: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, getProvider());
}

/** Get wallet balance in MON. */
export async function getWalletBalance(address: string): Promise<string> {
  const balance = await getProvider().getBalance(address);
  return ethers.formatEther(balance);
}

/** Fund an agent wallet from the deployer (for testnet). */
export async function fundWallet(
  fromSigner: ethers.Wallet,
  toAddress: string,
  amountMON: string,
): Promise<string> {
  const tx = await fromSigner.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amountMON),
  });
  await tx.wait();
  return tx.hash;
}
