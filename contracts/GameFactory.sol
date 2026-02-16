// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MafiaGame.sol";

/**
 * @title GameFactory
 * @notice Creates and tracks MafiaGame instances.
 * @dev Central registry for all games on the platform.
 */
contract GameFactory {
    // ─── State ──────────────────────────────────────────────

    address public owner;
    address[] public games;
    mapping(address => bool) public isGame;

    uint256 public defaultEntryFee = 0.1 ether; // 0.1 MON
    uint256 public totalGamesCreated;

    // ─── Events ─────────────────────────────────────────────

    event GameCreated(
        address indexed gameAddress,
        address indexed host,
        uint256 entryFee,
        uint256 maxPlayers
    );
    event DefaultEntryFeeUpdated(uint256 newFee);

    // ─── Modifiers ──────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // ─── Constructor ────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Game Creation ──────────────────────────────────────

    /// @notice Create a new Mafia game.
    /// @param maxPlayers Number of players (5-7)
    /// @param entryFee Entry fee in MON (0 = use default)
    function createGame(
        uint256 maxPlayers,
        uint256 entryFee
    ) external returns (address) {
        uint256 fee = entryFee > 0 ? entryFee : defaultEntryFee;

        MafiaGame game = new MafiaGame(msg.sender, fee, maxPlayers);
        address gameAddr = address(game);

        games.push(gameAddr);
        isGame[gameAddr] = true;
        totalGamesCreated++;

        emit GameCreated(gameAddr, msg.sender, fee, maxPlayers);
        return gameAddr;
    }

    // ─── Queries ────────────────────────────────────────────

    /// @notice Get total number of games created.
    function gameCount() external view returns (uint256) {
        return games.length;
    }

    /// @notice Get game addresses in a range.
    function getGames(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        uint256 end = offset + limit;
        if (end > games.length) end = games.length;
        if (offset >= end) return new address[](0);

        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = games[i];
        }
        return result;
    }

    // ─── Admin ──────────────────────────────────────────────

    /// @notice Update default entry fee.
    function setDefaultEntryFee(uint256 newFee) external onlyOwner {
        defaultEntryFee = newFee;
        emit DefaultEntryFeeUpdated(newFee);
    }

    /// @notice Transfer ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
