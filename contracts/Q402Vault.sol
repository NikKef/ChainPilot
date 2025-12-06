// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Q402Vault
 * @notice Vault contract for gas-sponsored native BNB transfers via Q402 protocol
 * @dev Users deposit BNB into this vault, then sign authorizations for transfers.
 *      The facilitator pays gas to execute the transfer from the user's vault balance.
 *      This enables gasless native token transfers with full policy enforcement.
 * 
 * Flow:
 * 1. User deposits BNB into vault (one-time, pays gas)
 * 2. User requests transfer via ChainPilot (signs EIP-712 message)
 * 3. Policy engine evaluates the request
 * 4. If approved, facilitator calls executeTransfer (pays gas)
 * 5. BNB is transferred from user's vault balance to recipient
 * 
 * @custom:security-contact security@chainpilot.app
 */
contract Q402Vault is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Constants ============

    /// @notice EIP-712 type hash for Transfer authorization
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address owner,address recipient,uint256 amount,uint256 deadline,bytes32 transferId,uint256 nonce)"
    );

    // ============ State Variables ============

    /// @notice Mapping of user address to their deposited BNB balance
    mapping(address => uint256) public balances;

    /// @notice Mapping of user address to their current nonce (for replay protection)
    mapping(address => uint256) public nonces;

    /// @notice Mapping to track used transfer IDs (for replay protection)
    mapping(bytes32 => bool) public usedTransferIds;

    /// @notice Mapping of authorized facilitators who can execute transfers
    mapping(address => bool) public facilitators;

    /// @notice Whether the contract is paused
    bool public paused;

    /// @notice Total BNB deposited in the vault
    uint256 public totalDeposited;

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event TransferExecuted(
        address indexed owner,
        address indexed recipient,
        uint256 amount,
        bytes32 transferId,
        uint256 nonce,
        address facilitator
    );
    event FacilitatorUpdated(address indexed facilitator, bool authorized);
    event PausedStateChanged(bool paused);

    // ============ Errors ============

    error InvalidSignature();
    error ExpiredDeadline();
    error InvalidNonce();
    error TransferIdAlreadyUsed();
    error UnauthorizedFacilitator();
    error ContractPaused();
    error InvalidRecipient();
    error InvalidAmount();
    error InsufficientBalance();
    error TransferFailed();
    error ZeroDeposit();

    // ============ Constructor ============

    constructor(address _owner) 
        EIP712("Q402Vault", "1") 
        Ownable(_owner) 
    {
        facilitators[_owner] = true;
        emit FacilitatorUpdated(_owner, true);
    }

    // ============ User Functions ============

    /**
     * @notice Deposit BNB into the vault
     * @dev User must send BNB with this transaction
     */
    function deposit() external payable nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
        
        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }

    /**
     * @notice Withdraw BNB from the vault
     * @param amount Amount of BNB to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        
        balances[msg.sender] -= amount;
        totalDeposited -= amount;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    /**
     * @notice Withdraw all BNB from the vault
     */
    function withdrawAll() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert InsufficientBalance();
        
        balances[msg.sender] = 0;
        totalDeposited -= amount;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit Withdrawn(msg.sender, amount, 0);
    }

    // ============ Facilitator Functions ============

    /**
     * @notice Execute a transfer from a user's vault balance
     * @dev Only callable by authorized facilitators
     * @param owner The user who signed the transfer authorization
     * @param recipient The address to receive the BNB
     * @param amount The amount of BNB to transfer
     * @param deadline Timestamp after which the authorization expires
     * @param transferId Unique identifier for this transfer (for replay protection)
     * @param signature The user's EIP-712 signature authorizing the transfer
     */
    function executeTransfer(
        address owner,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes32 transferId,
        bytes calldata signature
    ) external nonReentrant {
        // Validate the transfer
        _validateTransfer(owner, recipient, amount, deadline, transferId);
        
        // Get and increment nonce
        uint256 nonce = nonces[owner];
        
        // Verify the signature
        _verifySignature(owner, recipient, amount, deadline, transferId, nonce, signature);
        
        // Mark transfer ID as used and increment nonce
        usedTransferIds[transferId] = true;
        nonces[owner] = nonce + 1;
        
        // Execute the transfer from user's vault balance
        balances[owner] -= amount;
        totalDeposited -= amount;
        
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit TransferExecuted(owner, recipient, amount, transferId, nonce, msg.sender);
    }

    // ============ Internal Functions ============

    function _validateTransfer(
        address owner,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes32 transferId
    ) internal view {
        if (paused) revert ContractPaused();
        if (!facilitators[msg.sender]) revert UnauthorizedFacilitator();
        if (block.timestamp > deadline) revert ExpiredDeadline();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (balances[owner] < amount) revert InsufficientBalance();
        if (usedTransferIds[transferId]) revert TransferIdAlreadyUsed();
    }

    function _verifySignature(
        address owner,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes32 transferId,
        uint256 nonce,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            owner,
            recipient,
            amount,
            deadline,
            transferId,
            nonce
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        if (signer != owner) revert InvalidSignature();
    }

    // ============ View Functions ============

    /**
     * @notice Get the vault balance for a user
     * @param user The user's address
     * @return The user's deposited BNB balance
     */
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /**
     * @notice Get the current nonce for a user
     * @param user The user's address
     * @return The user's current nonce
     */
    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    /**
     * @notice Check if a transfer ID has been used
     * @param transferId The transfer ID to check
     * @return Whether the transfer ID has been used
     */
    function isTransferIdUsed(bytes32 transferId) external view returns (bool) {
        return usedTransferIds[transferId];
    }

    /**
     * @notice Check if an address is an authorized facilitator
     * @param addr The address to check
     * @return Whether the address is a facilitator
     */
    function isFacilitator(address addr) external view returns (bool) {
        return facilitators[addr];
    }

    /**
     * @notice Get the EIP-712 domain separator
     * @return The domain separator hash
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Get the chain ID
     * @return The current chain ID
     */
    function getChainId() external view returns (uint256) {
        return block.chainid;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set or revoke facilitator authorization
     * @param facilitator The address to update
     * @param authorized Whether the address should be authorized
     */
    function setFacilitator(address facilitator, bool authorized) external onlyOwner {
        facilitators[facilitator] = authorized;
        emit FacilitatorUpdated(facilitator, authorized);
    }

    /**
     * @notice Pause or unpause the contract
     * @param _paused Whether the contract should be paused
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    /**
     * @notice Emergency withdraw for stuck funds (owner only)
     * @dev Only use in emergencies - this bypasses user balances
     * @param to The address to send funds to
     * @param amount The amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // ============ Receive Function ============

    /**
     * @notice Receive BNB - automatically deposits to sender's balance
     */
    receive() external payable {
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }
}

