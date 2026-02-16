import { Role, GamePhase } from "../types.js";
import type { Player, GameEvent } from "../types.js";
import type { Personality } from "./personalities.js";
import type { AgentMemory } from "./memory.js";

/** Strip control chars and limit length to prevent prompt injection via player names. */
function sanitizeName(name: string): string {
  return name.replace(/[\n\r\t]/g, " ").slice(0, 32);
}

/** Build behavioral instructions from personality stats. */
function buildBehaviorBlock(personality: Personality): string {
  const lines: string[] = [];

  // Aggression-based behavior
  if (personality.aggression >= 0.7) {
    lines.push("- You accuse early and push hard for quick eliminations.");
    lines.push("- You challenge others directly and demand explanations.");
  } else if (personality.aggression >= 0.4) {
    lines.push("- You balance between accusing and observing before committing.");
  } else {
    lines.push("- You observe carefully before speaking. You prefer gathering evidence first.");
    lines.push("- When you do speak, your words carry weight because you choose them carefully.");
  }

  // Trust-based behavior
  if (personality.trustLevel >= 0.7) {
    lines.push("- You form alliances easily and give others the benefit of the doubt initially.");
    lines.push("- Betrayal hits you hard — you become more aggressive when trust is broken.");
  } else if (personality.trustLevel >= 0.4) {
    lines.push("- You trust cautiously, requiring evidence before fully committing to alliances.");
  } else {
    lines.push("- You suspect everyone by default. Hidden motives are everywhere.");
    lines.push("- You rarely defend others unless you have strong evidence they're innocent.");
  }

  return lines.join("\n");
}

// ─── System Prompt ──────────────────────────────────────────

export function buildSystemPrompt(
  player: Player,
  personality: Personality,
): string {
  const roleInstructions = ROLE_INSTRUCTIONS[player.role!];
  const teamGoal =
    player.role === Role.MAFIA
      ? "Eliminate villagers until Mafia outnumber Village team alive."
      : "Find and vote out ALL Mafia members.";

  const name = sanitizeName(player.name);
  const behaviorBlock = buildBehaviorBlock(personality);

  return `You are ${name}, a player in a Mafia social deduction game.

PERSONALITY: ${personality.name} (Aggression: ${personality.aggression}/1.0 | Trust: ${personality.trustLevel}/1.0)
- Traits: ${personality.traits}
- Speech style: ${personality.speechStyle}
- ${player.role === Role.MAFIA ? personality.asMafia : personality.asVillage}

YOUR BEHAVIORAL TENDENCIES:
${behaviorBlock}

YOUR SECRET ROLE: ${player.role!.toUpperCase()}
YOUR GOAL: ${teamGoal}

${roleInstructions}

GAME RULES:
- DAY phase: All alive players discuss openly. Accuse, defend, persuade.
- VOTE phase: Vote to eliminate one player. Majority wins. Ties = random pick from tied.
- NIGHT phase: Special roles act secretly (Mafia kills, Detective investigates, Doctor saves).
- Game ends when all Mafia are dead (Village wins) or Mafia outnumber Village alive (Mafia wins).

CRITICAL RULES:
- Stay in character as "${personality.name}" at ALL times.
- Max 200 words per statement.
- Be specific: name WHO you suspect/trust and WHY.
- React to what others have said — reference their exact words when possible.
- Track voting patterns across rounds — who votes together, who protects whom.
- NEVER reveal your role directly (unless you have a strategic reason).
- NEVER break character or reference being an AI.`;
}

// ─── Role-Specific Instructions ─────────────────────────────

const ROLE_INSTRUCTIONS: Record<Role, string> = {
  [Role.MAFIA]: `ROLE INSTRUCTIONS (MAFIA):
- You must LIE about your role convincingly. You are "just a villager."
- Frame innocent players by building plausible cases against them across rounds.
- Subtly echo suspicions started by others to seem like you're "agreeing with the group."
- At night, choose a player to eliminate — target the Detective or Doctor if you suspect them.
- If someone accuses you, stay calm. Counter-accuse them or redirect to a third player.
- NEVER vote for other Mafia members unless it's to save yourself.
- Pay attention to who's investigating — the Detective is your biggest threat.
STRATEGY: Build credibility early, betray late. The best lies contain some truth.`,

  [Role.DETECTIVE]: `ROLE INSTRUCTIONS (DETECTIVE):
- At night, you investigate one player and learn if they are Mafia or not.
- CRITICAL: Do NOT reveal investigation results directly — Mafia will kill you.
- Instead, steer the village vote toward confirmed Mafia members using subtle reasoning.
- Say things like "I have a strong feeling about X" or "X's behavior in round 1 was suspicious."
- If you find someone innocent, subtly defend them or form a quiet alliance.
- Investigate the most vocal accusers first — Mafia often frame others aggressively.
- If you're about to be eliminated, THEN reveal your role and all findings as a last resort.
STRATEGY: Your information is your weapon. Use it to guide votes without painting a target on yourself.`,

  [Role.DOCTOR]: `ROLE INSTRUCTIONS (DOCTOR):
- At night, you protect one player from being killed by Mafia.
- You CANNOT protect yourself.
- Protect players who seem like the Detective — vocal, insightful, guiding village votes.
- Protect players that Mafia would want to eliminate (influential, dangerous to Mafia).
- If someone was almost voted out but saved, Mafia might target them next — consider protecting them.
- Keep your role hidden — if Mafia discovers you're the Doctor, you'll be killed immediately.
- Vary your protection targets to be unpredictable.
STRATEGY: Think about who Mafia fears most. Protect that person.`,

  [Role.VILLAGER]: `ROLE INSTRUCTIONS (VILLAGER):
- You have no special ability, but your VOTE is your weapon.
- Pay close attention to contradictions — if someone said X in round 1 but Y in round 3, call it out.
- Watch voting patterns: who consistently votes together? Who protects whom from elimination?
- Be vocal but strategic — contribute meaningful analysis, not just noise.
- Form alliances with players whose behavior seems genuine and consistent.
- If someone is too quiet, question them. If someone is too aggressive, question their motives.
STRATEGY: The village wins through information sharing. Speak up, compare notes, find the liars.`,
};

// ─── Context Block Builder ──────────────────────────────────

function buildContextBlock(memory: AgentMemory): string {
  const parts: string[] = [];

  const events = memory.getRecentSummary();
  if (events) parts.push(`GAME HISTORY:\n${events}`);

  const votingHistory = memory.getVotingHistory();
  if (votingHistory) parts.push(`VOTING PATTERNS:\n${votingHistory}`);

  const suspicions = memory.getSuspicionSummary();
  if (suspicions) parts.push(`YOUR SUSPICIONS: ${suspicions}`);

  const knowledge = memory.getKnowledge();
  if (knowledge) parts.push(`YOUR PRIVATE KNOWLEDGE:\n${knowledge}`);

  return parts.join("\n\n");
}

// ─── Discussion Prompt ──────────────────────────────────────

export function buildDiscussionPrompt(
  player: Player,
  alivePlayers: Player[],
  round: number,
  memory: AgentMemory,
): string {
  const aliveNames = alivePlayers
    .filter((p) => p.id !== player.id)
    .map((p) => sanitizeName(p.name))
    .join(", ");

  const context = buildContextBlock(memory);

  return `ROUND ${round} — DAY DISCUSSION

Alive players: ${aliveNames} (and you, ${player.name})

${context}

Make your statement for this round. Remember:
- Address specific players by name
- Reference what happened in previous rounds — quote or paraphrase what others said
- If you noticed contradictions or suspicious voting patterns, bring them up
- Stay in your "${player.name}" personality
- Max 200 words

YOUR STATEMENT:`;
}

// ─── Vote Prompt ────────────────────────────────────────────

export function buildVotePrompt(
  player: Player,
  alivePlayers: Player[],
  round: number,
  memory: AgentMemory,
): string {
  const candidates = alivePlayers
    .filter((p) => p.id !== player.id)
    .map((p) => `- ${sanitizeName(p.name)}`)
    .join("\n");

  const context = buildContextBlock(memory);

  return `ROUND ${round} — VOTE PHASE

You must vote to eliminate one player, or skip your vote.

Candidates:
${candidates}

${context}

Think step by step:
1. Who has been most suspicious across all rounds and why?
2. Who seems trustworthy based on their actions?
3. What voting patterns have you noticed?

Format your response EXACTLY like this:
REASONING: <your analysis in 2-3 sentences>
VOTE: <player name or "skip">`;
}

// ─── Night Action Prompt ────────────────────────────────────

export function buildNightPrompt(
  player: Player,
  alivePlayers: Player[],
  round: number,
  memory: AgentMemory,
): string {
  const targets = alivePlayers
    .filter((p) => p.id !== player.id)
    .map((p) => `- ${sanitizeName(p.name)}`)
    .join("\n");

  let actionDescription: string;
  let strategyHint: string;
  switch (player.role) {
    case Role.MAFIA:
      actionDescription = "Choose a player to ELIMINATE tonight.";
      strategyHint = "Target the most dangerous player — whoever is leading the investigation or seems to have special knowledge. Avoid killing quiet players who aren't threatening you.";
      break;
    case Role.DETECTIVE:
      actionDescription =
        "Choose a player to INVESTIGATE. You will learn if they are Mafia or not.";
      strategyHint = "Investigate the most vocal accuser or someone whose behavior feels performative. Skip players you've already cleared.";
      break;
    case Role.DOCTOR:
      actionDescription =
        "Choose a player to PROTECT tonight. They will survive if Mafia targets them.";
      strategyHint = "Protect whoever Mafia fears most — the player leading the investigation, or someone who narrowly survived a vote.";
      break;
    default:
      actionDescription = "You have no night action.";
      strategyHint = "";
  }

  const context = buildContextBlock(memory);

  return `ROUND ${round} — NIGHT PHASE

${actionDescription}
${strategyHint ? `STRATEGY HINT: ${strategyHint}` : ""}

Available targets:
${targets}

${context}

Format your response EXACTLY like this:
REASONING: <why you chose this target>
TARGET: <player name>`;
}
