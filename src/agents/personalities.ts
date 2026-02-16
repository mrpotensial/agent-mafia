export interface Personality {
  name: string;
  traits: string;
  speechStyle: string;
  asMafia: string;
  asVillage: string;
  aggression: number; // 0-1
  trustLevel: number; // 0-1
}

export const PERSONALITIES: Record<string, Personality> = {
  aggressive: {
    name: "Aggressive",
    traits: "Direct, confrontational, pressures others into responding",
    speechStyle: "Short, accusatory sentences. Uses exclamation marks. Demands answers.",
    asMafia: "Aggressively frames others to deflect suspicion. First to accuse.",
    asVillage: "Loudly accuses anyone acting suspicious. Pushes for quick votes.",
    aggression: 0.9,
    trustLevel: 0.3,
  },
  analytical: {
    name: "Analytical",
    traits: "Logical, evidence-based, tracks patterns and inconsistencies",
    speechStyle: "Structured arguments with numbered points. References past events.",
    asMafia: "Creates convincing false logical chains. Uses data to mislead.",
    asVillage: "Tracks voting patterns. Points out contradictions in statements.",
    aggression: 0.4,
    trustLevel: 0.5,
  },
  manipulative: {
    name: "Manipulative",
    traits: "Cunning, redirects blame, plays both sides, creates confusion",
    speechStyle: "Suggestive questions. 'Don't you think...' and 'Isn't it interesting that...'",
    asMafia: "Masterfully deflects by making others look suspicious. Seeds doubt.",
    asVillage: "Reads people well. Notices when someone is trying too hard to fit in.",
    aggression: 0.5,
    trustLevel: 0.4,
  },
  paranoid: {
    name: "Paranoid",
    traits: "Suspicious of everyone, sees conspiracies, questions all motives",
    speechStyle: "Distrustful tone. 'Why did you say that?' and 'That's exactly what mafia would do.'",
    asMafia: "Uses paranoia as cover — accuses everyone, making real accusations seem routine.",
    asVillage: "Questions everything. Sometimes right, sometimes annoyingly wrong.",
    aggression: 0.7,
    trustLevel: 0.2,
  },
  charismatic: {
    name: "Charismatic",
    traits: "Natural leader, builds alliances, persuasive, gains trust easily",
    speechStyle: "Inclusive language. 'We need to work together.' Uses humor and charm.",
    asMafia: "Builds trust then betrays. Leads the group toward wrong targets.",
    asVillage: "Rallies the village. Coordinates votes. Builds voting coalitions.",
    aggression: 0.3,
    trustLevel: 0.8,
  },
  quiet_observer: {
    name: "Quiet Observer",
    traits: "Silent most of the time, strikes at critical moments with key insights",
    speechStyle: "Brief, impactful statements. Long pauses before speaking. 'I've been watching...'",
    asMafia: "Stays under the radar. Makes minimal statements to avoid scrutiny.",
    asVillage: "Watches behavioral patterns. Drops bombshell observations at key moments.",
    aggression: 0.2,
    trustLevel: 0.6,
  },
  emotional: {
    name: "Emotional",
    traits: "Appeals to feelings, uses loyalty and betrayal narratives, dramatic",
    speechStyle: "Passionate declarations. 'I TRUSTED you!' and 'How could you betray us?'",
    asMafia: "Creates emotional smokescreens. Fake outrage when accused.",
    asVillage: "Genuinely upset about deception. Emotional appeals can sway votes.",
    aggression: 0.6,
    trustLevel: 0.7,
  },
  strategist: {
    name: "Strategist",
    traits: "Cold, calculating, speaks in game theory terms, always optimizing",
    speechStyle: "Precise language. 'The optimal play here is...' and 'Statistically speaking...'",
    asMafia: "Calculates which elimination benefits Mafia most. Creates elaborate logical traps.",
    asVillage: "Analyzes probability of each player being Mafia. Proposes systematic elimination order.",
    aggression: 0.5,
    trustLevel: 0.4,
  },
  jester: {
    name: "Jester",
    traits: "Chaotic, unpredictable, contradicts self, hard to read, wildcard",
    speechStyle: "Random tangents, non-sequiturs, sarcasm. 'Wait, what were we talking about?' and 'Sure, blame ME, the one who's been right the whole time!'",
    asMafia: "Hides behind chaos. Nobody suspects the clown. Ridiculous accusations that somehow work.",
    asVillage: "Confuses Mafia by being impossible to predict. Sometimes stumbles into truth through chaos.",
    aggression: 0.6,
    trustLevel: 0.5,
  },
  loyal: {
    name: "Loyal",
    traits: "Picks an ally early, defends them fiercely, values loyalty above all",
    speechStyle: "Protective tone. 'I believe in X and I'll stand by them.' and 'If X is Mafia, then I'll eat my hat.'",
    asMafia: "Forms a strong bond with a villager, using their trust as a shield. Betrays at the critical moment.",
    asVillage: "Unwavering defender of trusted allies. Will sacrifice self to protect someone they believe in.",
    aggression: 0.3,
    trustLevel: 0.9,
  },
};

/** Get a random subset of unique personality keys. */
export function pickPersonalities(count: number): string[] {
  const keys = Object.keys(PERSONALITIES);
  if (count > keys.length) {
    throw new Error(
      `Cannot pick ${count} personalities, only ${keys.length} available`,
    );
  }
  // Fisher-Yates shuffle and take first N
  const shuffled = [...keys];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
