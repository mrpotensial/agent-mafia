// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MafiaGame
 * @notice Manages a single Mafia game's entry fees, wagers, and reward distribution.
 * @dev Deployed per-game by GameFactory. All values in native MON.
 */
contract MafiaGame {
    // ─── Types ──────────────────────────────────────────────

    enum GameStatus { Open, Running, Finished, Cancelled }
    enum Team { Village, Mafia }
    enum WagerType { TeamBet, EliminationBet, IdentityBet }

    struct Player {
        address addr;
        bool alive;
        bool isWinner;
    }

    struct Wager {
        address bettor;
        WagerType wagerType;
        uint256 amount;
        bytes32 prediction; // encoded prediction
        bool settled;
        bool won;
    }

    // ─── State ──────────────────────────────────────────────

    address public factory;
    address public host;
    uint256 public entryFee;
    uint256 public maxPlayers;
    GameStatus public status;
    Team public winner;

    Player[] public players;
    Wager[] public wagers;

    uint256 public totalEntryPool;
    uint256 public totalWagerPool;

    // ─── Commit-Reveal (role integrity) ──────────────────────
    bytes32[] public roleCommitments;    // keccak256(playerId, role, salt) per player
    bool public rolesCommitted;
    bool public rolesRevealed;
    bytes32 public revealSalt;           // published at game end
    string[] public revealedRoles;       // actual roles after reveal

    // Distribution percentages (basis points, 10000 = 100%)
    uint256 public constant WINNER_SHARE = 7000;      // 70%
    uint256 public constant CONSOLATION_SHARE = 1000;  // 10%
    uint256 public constant PLATFORM_SHARE = 1500;     // 15%
    uint256 public constant BURN_SHARE = 300;          // 3%
    uint256 public constant HOST_SHARE = 200;          // 2%

    // ─── Events ─────────────────────────────────────────────

    event PlayerJoined(address indexed player, uint256 index);
    event GameStarted(uint256 playerCount);
    event WagerPlaced(address indexed bettor, WagerType wagerType, uint256 amount);
    event GameFinished(Team winner);
    event RewardClaimed(address indexed player, uint256 amount);
    event WagerSettled(address indexed bettor, uint256 index, bool won, uint256 payout);
    event RolesCommitted(uint256 playerCount, bytes32 commitmentHash);
    event RolesRevealed(bytes32 salt, uint256 playerCount);

    // ─── Modifiers ──────────────────────────────────────────

    modifier onlyHost() {
        require(msg.sender == host, "Only host");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    modifier inStatus(GameStatus _status) {
        require(status == _status, "Wrong game status");
        _;
    }

    // ─── Constructor ────────────────────────────────────────

    constructor(
        address _host,
        uint256 _entryFee,
        uint256 _maxPlayers
    ) {
        require(_maxPlayers >= 5 && _maxPlayers <= 7, "5-7 players");
        factory = msg.sender;
        host = _host;
        entryFee = _entryFee;
        maxPlayers = _maxPlayers;
        status = GameStatus.Open;
    }

    // ─── Player Management ──────────────────────────────────

    /// @notice Join the game by paying the entry fee.
    function join() external payable inStatus(GameStatus.Open) {
        require(msg.value == entryFee, "Wrong entry fee");
        require(players.length < maxPlayers, "Game full");
        require(!_isPlayer(msg.sender), "Already joined");

        players.push(Player({
            addr: msg.sender,
            alive: true,
            isWinner: false
        }));

        totalEntryPool += msg.value;
        emit PlayerJoined(msg.sender, players.length - 1);
    }

    /// @notice Get total player count.
    function playerCount() external view returns (uint256) {
        return players.length;
    }

    // ─── Game Lifecycle ─────────────────────────────────────

    /// @notice Start the game. Only host can call when enough players joined.
    function startGame() external onlyHost inStatus(GameStatus.Open) {
        require(players.length == maxPlayers, "Not enough players");
        status = GameStatus.Running;
        emit GameStarted(players.length);
    }

    /// @notice End the game and set results. Only host can call.
    /// @param _winner Winning team
    /// @param _winnerIndices Indices of winning players
    function finishGame(
        Team _winner,
        uint256[] calldata _winnerIndices
    ) external onlyHost inStatus(GameStatus.Running) {
        winner = _winner;
        status = GameStatus.Finished;

        for (uint256 i = 0; i < _winnerIndices.length; i++) {
            require(_winnerIndices[i] < players.length, "Invalid index");
            players[_winnerIndices[i]].isWinner = true;
        }

        emit GameFinished(_winner);
    }

    /// @notice Cancel the game and allow refunds. Only host can call.
    function cancelGame() external onlyHost {
        require(status == GameStatus.Open || status == GameStatus.Running, "Cannot cancel");
        status = GameStatus.Cancelled;
    }

    // ─── Commit-Reveal (trustless role verification) ────────

    /// @notice Commit role hashes at game start. Proves roles were fixed before play.
    /// @param commitments Array of keccak256(abi.encodePacked(playerIndex, role, salt)) per player
    function commitRoles(
        bytes32[] calldata commitments
    ) external onlyHost inStatus(GameStatus.Running) {
        require(!rolesCommitted, "Already committed");
        require(commitments.length == players.length, "Wrong commitment count");

        for (uint256 i = 0; i < commitments.length; i++) {
            roleCommitments.push(commitments[i]);
        }
        rolesCommitted = true;

        // Emit a hash of all commitments for easy off-chain verification
        bytes32 commitmentHash = keccak256(abi.encodePacked(commitments));
        emit RolesCommitted(commitments.length, commitmentHash);
    }

    /// @notice Reveal roles and salt after game ends. Anyone can verify commitments match.
    /// @param roles Array of role strings ("mafia", "detective", "doctor", "villager")
    /// @param salt The secret salt used during commitment
    function revealRoles(
        string[] calldata roles,
        bytes32 salt
    ) external onlyHost inStatus(GameStatus.Finished) {
        require(rolesCommitted, "Not committed");
        require(!rolesRevealed, "Already revealed");
        require(roles.length == roleCommitments.length, "Wrong role count");

        // Verify each commitment matches
        for (uint256 i = 0; i < roles.length; i++) {
            bytes32 expected = keccak256(abi.encodePacked(i, roles[i], salt));
            require(expected == roleCommitments[i], "Commitment mismatch");
        }

        // Store revealed data
        for (uint256 i = 0; i < roles.length; i++) {
            revealedRoles.push(roles[i]);
        }
        revealSalt = salt;
        rolesRevealed = true;

        emit RolesRevealed(salt, roles.length);
    }

    /// @notice Verify a single player's role against the commitment. Anyone can call.
    /// @return valid True if the role matches the commitment
    function verifyRole(
        uint256 playerIndex,
        string calldata role,
        bytes32 salt
    ) external view returns (bool valid) {
        require(playerIndex < roleCommitments.length, "Invalid index");
        bytes32 expected = keccak256(abi.encodePacked(playerIndex, role, salt));
        return expected == roleCommitments[playerIndex];
    }

    /// @notice Get all role commitments.
    function getRoleCommitments() external view returns (bytes32[] memory) {
        return roleCommitments;
    }

    /// @notice Get all revealed roles (empty until revealed).
    function getRevealedRoles() external view returns (string[] memory) {
        return revealedRoles;
    }

    // ─── Wagering ───────────────────────────────────────────

    /// @notice Place a wager on the game outcome.
    /// @param wagerType Type of wager
    /// @param prediction Encoded prediction (e.g., keccak256 of team name)
    function placeWager(
        WagerType wagerType,
        bytes32 prediction
    ) external payable inStatus(GameStatus.Running) {
        require(msg.value > 0, "Wager must be > 0");

        wagers.push(Wager({
            bettor: msg.sender,
            wagerType: wagerType,
            amount: msg.value,
            prediction: prediction,
            settled: false,
            won: false
        }));

        totalWagerPool += msg.value;
        emit WagerPlaced(msg.sender, wagerType, msg.value);
    }

    /// @notice Get total wager count.
    function wagerCount() external view returns (uint256) {
        return wagers.length;
    }

    // ─── Rewards ────────────────────────────────────────────

    /// @notice Claim reward as a winning player.
    function claimReward() external inStatus(GameStatus.Finished) {
        (bool isWinner, uint256 idx) = _findPlayer(msg.sender);
        require(isWinner && players[idx].isWinner, "Not a winner");

        uint256 winnerPool = (totalEntryPool * WINNER_SHARE) / 10000;
        uint256 winnerCount = _countWinners();
        uint256 reward = winnerPool / winnerCount;

        // Mark as claimed by setting alive = false (reuse field)
        require(players[idx].alive, "Already claimed");
        players[idx].alive = false;

        (bool sent, ) = payable(msg.sender).call{value: reward}("");
        require(sent, "Transfer failed");

        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice Claim refund if game was cancelled (entry fee).
    function claimRefund() external inStatus(GameStatus.Cancelled) {
        (bool found, uint256 idx) = _findPlayer(msg.sender);
        require(found, "Not a player");
        require(players[idx].alive, "Already refunded");

        players[idx].alive = false;

        (bool sent, ) = payable(msg.sender).call{value: entryFee}("");
        require(sent, "Transfer failed");
    }

    /// @notice Claim wager refund if game was cancelled.
    function claimWagerRefund() external inStatus(GameStatus.Cancelled) {
        uint256 total = 0;
        for (uint256 i = 0; i < wagers.length; i++) {
            if (wagers[i].bettor == msg.sender && !wagers[i].settled) {
                wagers[i].settled = true;
                total += wagers[i].amount;
            }
        }
        require(total > 0, "No wagers to refund");

        (bool sent, ) = payable(msg.sender).call{value: total}("");
        require(sent, "Transfer failed");
    }

    /// @notice Host withdraws platform + host share after game finishes (once only).
    bool private platformFeesWithdrawn;

    function withdrawPlatformFees() external onlyHost inStatus(GameStatus.Finished) {
        require(!platformFeesWithdrawn, "Already withdrawn");
        platformFeesWithdrawn = true;

        uint256 platformAmount = (totalEntryPool * PLATFORM_SHARE) / 10000;
        uint256 hostAmount = (totalEntryPool * HOST_SHARE) / 10000;
        uint256 total = platformAmount + hostAmount;

        (bool sent, ) = payable(host).call{value: total}("");
        require(sent, "Transfer failed");
    }

    // ─── Internal ───────────────────────────────────────────

    function _isPlayer(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < players.length; i++) {
            if (players[i].addr == addr) return true;
        }
        return false;
    }

    function _findPlayer(address addr) internal view returns (bool, uint256) {
        for (uint256 i = 0; i < players.length; i++) {
            if (players[i].addr == addr) return (true, i);
        }
        return (false, 0);
    }

    function _countWinners() internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < players.length; i++) {
            if (players[i].isWinner) count++;
        }
        return count;
    }

    // Allow contract to receive MON
    receive() external payable {}
}
