import "dotenv/config";
import { z } from "zod";

export type AIProvider = "gemini" | "anthropic" | "openai" | "openrouter";

// ─── Validated env parsing ───────────────────────────────────

const envSchema = z.object({
  AI_PROVIDER: z.enum(["gemini", "anthropic", "openai", "openrouter"]).default("gemini"),
  GEMINI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default(""),
  AI_MAX_TOKENS: z.coerce.number().int().min(1).max(10000).default(500),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.8),
  MONAD_RPC_URL: z.string().default("https://testnet-rpc.monad.xyz"),
  MONAD_EXPLORER_URL: z.string().default(""),
  DEPLOYER_PRIVATE_KEY: z.string().default(""),
  GAME_CONTRACT_ADDRESS: z.string().default(""),
  FACTORY_CONTRACT_ADDRESS: z.string().default(""),
  NADFUN_API_KEY: z.string().default(""),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  DEFAULT_PLAYER_COUNT: z.coerce.number().int().min(3).max(20).default(5),
  DEFAULT_ENTRY_FEE: z.coerce.number().min(0).default(0.1),
  DB_PATH: z.string().default("data/agent-mafia.db"),
});

const env = envSchema.parse(process.env);

// ─── Config ──────────────────────────────────────────────────

const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: "gemini-2.0-flash",
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
  openrouter: "google/gemini-2.0-flash-001",
};

export const config = {
  ai: {
    provider: env.AI_PROVIDER,
    geminiApiKey: env.GEMINI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    model: env.AI_MODEL || DEFAULT_MODELS[env.AI_PROVIDER],
    maxTokens: env.AI_MAX_TOKENS,
    temperature: env.AI_TEMPERATURE,
  },
  blockchain: {
    rpcUrl: env.MONAD_RPC_URL,
    explorerUrl: env.MONAD_EXPLORER_URL ||
      (env.MONAD_RPC_URL.includes("testnet")
        ? "https://testnet.monadexplorer.com"
        : "https://monadvision.com"),
    deployerPrivateKey: env.DEPLOYER_PRIVATE_KEY,
    gameContractAddress: env.GAME_CONTRACT_ADDRESS,
    factoryContractAddress: env.FACTORY_CONTRACT_ADDRESS,
  },
  nadfun: {
    apiKey: env.NADFUN_API_KEY,
  },
  server: {
    port: env.PORT,
    host: env.HOST,
  },
  game: {
    defaultPlayerCount: env.DEFAULT_PLAYER_COUNT,
    defaultEntryFee: env.DEFAULT_ENTRY_FEE,
    maxRounds: 10,
    discussionTimeMs: 30_000,
    voteTimeMs: 15_000,
    nightTimeMs: 10_000,
    maxWordsPerStatement: 200,
  },
  db: {
    path: env.DB_PATH,
  },
} as const;
