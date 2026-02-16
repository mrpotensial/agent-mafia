import { describe, it, expect, beforeEach } from "vitest";
import { ethers } from "ethers";
import {
  createAgentWallet,
  createAgentWallets,
} from "../src/blockchain/wallet.js";
import {
  OffChainWagerSystem,
  WagerType,
  encodeTeamBet,
  encodeEliminationBet,
  encodeIdentityBet,
} from "../src/blockchain/wagering.js";
import {
  GAME_FACTORY_ABI,
  MAFIA_GAME_ABI,
  buildRoleCommitments,
} from "../src/blockchain/contracts.js";

// ─── Wallet ─────────────────────────────────────────────────

describe("Wallet", () => {
  it("creates a valid wallet", () => {
    const wallet = createAgentWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("creates unique wallets", () => {
    const wallets = createAgentWallets(5);
    expect(wallets).toHaveLength(5);
    const addresses = wallets.map((w) => w.address);
    expect(new Set(addresses).size).toBe(5);
  });

  it("wallet private key recovers same address", () => {
    const { address, privateKey } = createAgentWallet();
    const recovered = new ethers.Wallet(privateKey);
    expect(recovered.address).toBe(address);
  });
});

// ─── Prediction Encoding ────────────────────────────────────

describe("Prediction Encoding", () => {
  it("encodes team bet", () => {
    const village = encodeTeamBet("village");
    const mafia = encodeTeamBet("mafia");
    expect(village).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mafia).toMatch(/^0x[0-9a-f]{64}$/);
    expect(village).not.toBe(mafia);
  });

  it("encodes elimination bet", () => {
    const bet1 = encodeEliminationBet("p1");
    const bet2 = encodeEliminationBet("p2");
    expect(bet1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(bet1).not.toBe(bet2);
  });

  it("encodes identity bet", () => {
    const bet = encodeIdentityBet("p3");
    expect(bet).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("same input produces same hash", () => {
    expect(encodeTeamBet("village")).toBe(encodeTeamBet("village"));
  });
});

// ─── ABI Validity ───────────────────────────────────────────

describe("Contract ABIs", () => {
  it("factory ABI creates valid interface", () => {
    const iface = new ethers.Interface(GAME_FACTORY_ABI);
    expect(iface.getFunction("createGame")).toBeTruthy();
    expect(iface.getFunction("gameCount")).toBeTruthy();
    expect(iface.getFunction("getGames")).toBeTruthy();
  });

  it("game ABI creates valid interface", () => {
    const iface = new ethers.Interface(MAFIA_GAME_ABI);
    expect(iface.getFunction("join")).toBeTruthy();
    expect(iface.getFunction("startGame")).toBeTruthy();
    expect(iface.getFunction("finishGame")).toBeTruthy();
    expect(iface.getFunction("placeWager")).toBeTruthy();
    expect(iface.getFunction("claimReward")).toBeTruthy();
    expect(iface.getFunction("status")).toBeTruthy();
  });
});

// ─── Off-Chain Wager System ─────────────────────────────────

describe("OffChainWagerSystem", () => {
  let wagerSystem: OffChainWagerSystem;

  beforeEach(() => {
    wagerSystem = new OffChainWagerSystem();
  });

  it("places a team wager", () => {
    const wager = wagerSystem.place(
      "game-1",
      "spectator-1",
      WagerType.TeamBet,
      "village",
      0.5,
    );
    expect(wager.id).toBe("w1");
    expect(wager.amount).toBe(0.5);
    expect(wager.settled).toBe(false);
  });

  it("tracks multiple wagers", () => {
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 0.5);
    wagerSystem.place("game-1", "s2", WagerType.TeamBet, "mafia", 0.3);
    wagerSystem.place("game-1", "s3", WagerType.EliminationBet, "p2", 0.2);

    expect(wagerSystem.getByGame("game-1")).toHaveLength(3);
    expect(wagerSystem.getPool("game-1")).toBeCloseTo(1.0);
  });

  it("settles team bet - pool-based payout with winners and losers", () => {
    // s1 bets 0.6 on village, s2 bets 0.4 on mafia
    // Pool = 1.0, village wins
    // Platform fee = 10% = 0.1, Net pool = 0.9
    // s1 (only winner) gets 0.9
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 0.6);
    wagerSystem.place("game-1", "s2", WagerType.TeamBet, "mafia", 0.4);
    const settled = wagerSystem.settle("game-1", "village", [], []);
    expect(settled).toHaveLength(2);
    expect(settled[0].won).toBe(true);
    expect(settled[0].payout).toBe(0.9);
    expect(settled[0].settled).toBe(true);
    expect(settled[1].won).toBe(false);
    expect(settled[1].payout).toBe(0);
  });

  it("settles team bet - all bet same side (no losers)", () => {
    // Everyone bet village, village wins — return stakes, no profit
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 1.0);
    wagerSystem.place("game-1", "s2", WagerType.TeamBet, "village", 0.5);
    const settled = wagerSystem.settle("game-1", "village", [], []);
    expect(settled[0].payout).toBe(1.0); // stake returned
    expect(settled[1].payout).toBe(0.5); // stake returned
  });

  it("settles team bet - no winners (refund minus fee)", () => {
    // Everyone bet mafia, village wins — refund minus 10% platform fee
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "mafia", 1.0);
    const settled = wagerSystem.settle("game-1", "village", [], []);
    expect(settled[0].won).toBe(false);
    expect(settled[0].payout).toBe(0.9); // 1.0 - 10% fee
  });

  it("settles team bet - multiple winners share proportionally", () => {
    // s1 bets 0.3 village, s2 bets 0.1 village, s3 bets 0.6 mafia
    // Pool = 1.0, village wins
    // Net pool = 0.9 (after 10% fee)
    // s1 share = 0.3/0.4 * 0.9 = 0.675
    // s2 share = 0.1/0.4 * 0.9 = 0.225
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 0.3);
    wagerSystem.place("game-1", "s2", WagerType.TeamBet, "village", 0.1);
    wagerSystem.place("game-1", "s3", WagerType.TeamBet, "mafia", 0.6);
    const settled = wagerSystem.settle("game-1", "village", [], []);
    expect(settled[0].payout).toBeCloseTo(0.675, 3);
    expect(settled[1].payout).toBeCloseTo(0.225, 3);
    expect(settled[2].payout).toBe(0);
  });

  it("settles elimination bet", () => {
    wagerSystem.place("game-1", "s1", WagerType.EliminationBet, "p3", 0.5);
    wagerSystem.place("game-1", "s2", WagerType.EliminationBet, "p1", 0.5);
    const settled = wagerSystem.settle("game-1", "village", ["p3", "p4"], []);
    expect(settled[0].won).toBe(true); // predicted p3, p3 was eliminated
    expect(settled[1].won).toBe(false); // predicted p1, not eliminated
    // Pool = 1.0, net = 0.9, s1 gets 0.9
    expect(settled[0].payout).toBe(0.9);
    expect(settled[1].payout).toBe(0);
  });

  it("settles identity bet", () => {
    wagerSystem.place("game-1", "s1", WagerType.IdentityBet, "p2", 0.5);
    wagerSystem.place("game-1", "s2", WagerType.IdentityBet, "p3", 0.5);
    const settled = wagerSystem.settle("game-1", "village", [], ["p2", "p5"]);
    expect(settled[0].won).toBe(true); // p2 was indeed mafia
    expect(settled[1].won).toBe(false); // p3 was not mafia
    expect(settled[0].payout).toBe(0.9);
  });

  it("does not re-settle already settled wagers", () => {
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 1.0);
    wagerSystem.settle("game-1", "village", [], []);

    const secondSettle = wagerSystem.settle("game-1", "mafia", [], []);
    expect(secondSettle).toHaveLength(0); // Already settled
  });

  it("isolates wagers between games", () => {
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 1.0);
    wagerSystem.place("game-2", "s1", WagerType.TeamBet, "mafia", 2.0);

    expect(wagerSystem.getByGame("game-1")).toHaveLength(1);
    expect(wagerSystem.getByGame("game-2")).toHaveLength(1);
    expect(wagerSystem.getPool("game-1")).toBe(1.0);
    expect(wagerSystem.getPool("game-2")).toBe(2.0);
  });

  it("resets correctly", () => {
    wagerSystem.place("game-1", "s1", WagerType.TeamBet, "village", 1.0);
    wagerSystem.reset();
    expect(wagerSystem.getByGame("game-1")).toHaveLength(0);
  });
});

// ─── Commit-Reveal ──────────────────────────────────────────

describe("buildRoleCommitments", () => {
  it("generates salt and commitments for each role", () => {
    const roles = ["mafia", "detective", "doctor", "villager", "villager"];
    const { salt, commitments } = buildRoleCommitments(roles);

    expect(salt).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(commitments).toHaveLength(5);
    for (const c of commitments) {
      expect(c).toMatch(/^0x[0-9a-fA-F]{64}$/);
    }
  });

  it("produces unique commitments per role", () => {
    const roles = ["mafia", "detective", "doctor", "villager", "villager"];
    const { commitments } = buildRoleCommitments(roles);
    const unique = new Set(commitments);
    // At minimum mafia/detective/doctor/villager are different roles at different indices
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it("produces different salt each call", () => {
    const r1 = buildRoleCommitments(["mafia", "villager"]);
    const r2 = buildRoleCommitments(["mafia", "villager"]);
    expect(r1.salt).not.toBe(r2.salt);
    expect(r1.commitments[0]).not.toBe(r2.commitments[0]);
  });

  it("can verify commitment matches keccak256(index, role, salt)", () => {
    const roles = ["mafia", "detective"];
    const { salt, commitments } = buildRoleCommitments(roles);

    // Verify manually: commitment[0] = keccak256(abi.encodePacked(0, "mafia", salt))
    const expected = ethers.solidityPackedKeccak256(
      ["uint256", "string", "bytes32"],
      [0, "mafia", salt],
    );
    expect(commitments[0]).toBe(expected);
  });
});
