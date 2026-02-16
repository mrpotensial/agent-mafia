import type { Player } from "../types.js";
import { config } from "../config.js";

/**
 * Shared parsing utilities for all LLM agent implementations.
 * Handles vote extraction, target extraction, and word limiting.
 */

/** Enforce word limit on a statement. */
export function enforceWordLimit(text: string): string {
  const words = text.split(/\s+/);
  if (words.length <= config.game.maxWordsPerStatement) return text;
  return words.slice(0, config.game.maxWordsPerStatement).join(" ") + "...";
}

/**
 * Extract structured response from chain-of-thought format.
 * Looks for "VOTE: <name>" or "TARGET: <name>" lines.
 * Returns { reasoning, value } where value is the extracted name/skip.
 */
export function extractStructuredResponse(
  response: string,
  tag: "VOTE" | "TARGET",
): { reasoning: string; value: string } {
  const lines = response.split("\n");
  let reasoning = "";
  let value = "";

  for (const line of lines) {
    const trimmed = line.trim();
    // Match REASONING: ...
    const reasonMatch = trimmed.match(/^REASONING:\s*(.+)/i);
    if (reasonMatch) {
      reasoning = reasonMatch[1].trim();
    }
    // Match VOTE: ... or TARGET: ...
    const tagPattern = new RegExp(`^${tag}:\\s*(.+)`, "i");
    const tagMatch = trimmed.match(tagPattern);
    if (tagMatch) {
      value = tagMatch[1].trim().replace(/^["']|["']$/g, ""); // strip quotes
    }
  }

  return { reasoning, value };
}

/**
 * Parse a vote response from LLM output.
 * Handles chain-of-thought format (VOTE: name) and fallback plain text.
 * Returns player ID or null for skip.
 */
export function parseVoteResponse(
  response: string,
  alivePlayers: Player[],
  selfId: string,
): string | null {
  // Try structured format first
  const { value } = extractStructuredResponse(response, "VOTE");
  const textToSearch = value || response;
  const cleaned = textToSearch.toLowerCase().trim();

  // Check for skip
  if (cleaned === "skip" || cleaned.includes("skip")) {
    return null;
  }

  // Try exact name match (case-insensitive)
  for (const p of alivePlayers) {
    if (p.id === selfId) continue;
    if (cleaned === p.name.toLowerCase()) {
      return p.id;
    }
  }

  // Try partial name match (name appears in text)
  for (const p of alivePlayers) {
    if (p.id === selfId) continue;
    if (cleaned.includes(p.name.toLowerCase())) {
      return p.id;
    }
  }

  // Fallback: try player id pattern (p1, p2, etc.)
  const idMatch = cleaned.match(/p\d+/);
  if (idMatch) {
    const targetId = idMatch[0];
    if (alivePlayers.some((p) => p.id === targetId && p.id !== selfId)) {
      return targetId;
    }
  }

  // Last resort: random vote (log for debugging)
  console.warn(
    `[parseVote] Could not parse vote from "${response.slice(0, 100)}", falling back to random`,
  );
  const targets = alivePlayers.filter((p) => p.id !== selfId);
  return targets.length > 0
    ? targets[Math.floor(Math.random() * targets.length)].id
    : null;
}

/**
 * Parse a night action target from LLM output.
 * Handles chain-of-thought format (TARGET: name) and fallback plain text.
 * Returns player ID.
 */
export function parseTargetResponse(
  response: string,
  alivePlayers: Player[],
  selfId: string,
): string {
  // Try structured format first
  const { value } = extractStructuredResponse(response, "TARGET");
  const textToSearch = value || response;
  const cleaned = textToSearch.toLowerCase().trim();

  // Try exact name match
  for (const p of alivePlayers) {
    if (p.id === selfId) continue;
    if (cleaned === p.name.toLowerCase()) {
      return p.id;
    }
  }

  // Try partial name match
  for (const p of alivePlayers) {
    if (p.id === selfId) continue;
    if (cleaned.includes(p.name.toLowerCase())) {
      return p.id;
    }
  }

  // Fallback: try player id
  const idMatch = cleaned.match(/p\d+/);
  if (idMatch) {
    const targetId = idMatch[0];
    if (alivePlayers.some((p) => p.id === targetId && p.id !== selfId)) {
      return targetId;
    }
  }

  // Last resort: random target
  console.warn(
    `[parseTarget] Could not parse target from "${response.slice(0, 100)}", falling back to random`,
  );
  const targets = alivePlayers.filter((p) => p.id !== selfId);
  return targets[Math.floor(Math.random() * targets.length)].id;
}
