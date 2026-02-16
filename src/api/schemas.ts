import { z } from "zod";

// ─── Request Schemas ────────────────────────────────────────

export const CreateGameSchema = z.object({
  playerCount: z.number().int().min(5).max(7).default(5),
  entryFee: z.number().min(0).max(1000).default(0.1),
  maxRounds: z.number().int().min(3).max(20).default(10),
  useLLM: z.boolean().default(false),
});

export const JoinGameSchema = z.object({
  gameId: z.string().min(1),
  playerName: z.string().min(1).max(32),
  personality: z.string().optional(),
});

export const StartGameSchema = z.object({
  gameId: z.string().min(1),
});

export const GameIdParamSchema = z.object({
  gameId: z.string().min(1).max(100),
});

export const AddPlayerSchema = z.object({
  name: z.string().min(1).max(32).default("Agent"),
  personality: z.string().max(32).optional(),
});

export const PlaceWagerSchema = z.object({
  bettor: z.string().min(1).max(64).default("anonymous"),
  type: z.enum(["team", "elimination", "identity"]).default("team"),
  prediction: z.string().min(1).max(64),
  amount: z.number().min(0.001).max(10000).default(0.1),
});

// ─── Types ──────────────────────────────────────────────────

export type CreateGameInput = z.infer<typeof CreateGameSchema>;
export type JoinGameInput = z.infer<typeof JoinGameSchema>;
export type StartGameInput = z.infer<typeof StartGameSchema>;
export type AddPlayerInput = z.infer<typeof AddPlayerSchema>;
export type PlaceWagerInput = z.infer<typeof PlaceWagerSchema>;
