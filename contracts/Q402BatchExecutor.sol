// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Q402BatchExecutor
 * @notice Gas-sponsored batch execution contract for Q402 protocol
 * @dev Enables bundling multiple operations (transfers, swaps, calls) into a single
 *      sign-to-pay flow. The facilitator pays gas while users only sign once.
 * 
 * Key features:
 * - Batch execution of multiple operations in one transaction
 * - Support for transfers, DEX swaps, and arbitrary contract calls
 * - EIP-712 typed signatures for secure batch authorization
 * - Gas sponsorship by facilitator
 * 
 * @custom:security-contact security@chainpilot.app
 */
contract Q402BatchExecutor is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // =============================================================================
    // CONSTANTS
    // =============================================================================

    /// @notice Operation type: ERC20 or native token transfer
    uint8 public constant OP_TRANSFER = 0;
    
    /// @notice Operation type: DEX swap (PancakeSwap compatible)
    uint8 public constant OP_SWAP = 1;
    
    /// @notice Operation type: Arbitrary contract call
    uint8 public constant OP_CALL = 2;

    /// @notice EIP-712 type hash for Operation struct
    bytes32 public constant OPERATION_TYPEHASH = keccak256(
        "Operation(uint8 opType,address tokenIn,uint256 amountIn,address tokenOut,uint256 minAmountOut,address target,bytes data)"
    );

    /// @notice EIP-712 type hash for BatchWitness struct
    bytes32 public constant BATCH_WITNESS_TYPEHASH = keccak256(
        "BatchWitness(address owner,bytes32 operationsHash,uint256 deadline,bytes32 batchId,uint256 nonce)"
    );

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================

    /// @notice Mapping of user address to their current nonce
    mapping(address => uint256) public nonces;

    /// @notice Mapping to track used batch IDs
    mapping(bytes32 => bool) public usedBatchIds;

    /// @notice Mapping of authorized facilitators
    mapping(address => bool) public facilitators;

    /// @notice Whitelisted DEX routers for swap operations
    mapping(address => bool) public whitelistedRouters;

    /// @notice Whitelisted contracts for call operations
    mapping(address => bool) public whitelistedTargets;

    /// @notice Whether the contract is paused
    bool public paused;

    /// @notice Maximum operations allowed per batch
    uint256 public maxOperationsPerBatch = 10;

    // =============================================================================
    // STRUCTS
    // =============================================================================

    /**
     * @notice Represents a single operation in a batch
     * @param opType Operation type (0=transfer, 1=swap, 2=call)
     * @param tokenIn Input token address (address(0) for native BNB)
     * @param amountIn Input amount
     * @param tokenOut Output token address (for swaps, address(0) for native)
     * @param minAmountOut Minimum output amount (for swaps, 0 for transfers)
     * @param target Target address (recipient for transfers, router for swaps, contract for calls)
     * @param data Calldata for swaps and calls (empty for transfers)
     */
    struct Operation {
        uint8 opType;
        address tokenIn;
        uint256 amountIn;
        address tokenOut;
        uint256 minAmountOut;
        address target;
        bytes data;
    }

    /**
     * @notice Witness structure that the user signs
     * @param owner User's wallet address
     * @param operationsHash Keccak256 hash of encoded operations array
     * @param deadline Unix timestamp after which signature is invalid
     * @param batchId Unique identifier for this batch
     * @param nonce Prevents replay attacks
     */
    struct BatchWitness {
        address owner;
        bytes32 operationsHash;
        uint256 deadline;
        bytes32 batchId;
        uint256 nonce;
    }

    // =============================================================================
    // EVENTS
    // =============================================================================

    event BatchExecuted(
        address indexed owner,
        bytes32 indexed batchId,
        uint256 operationCount,
        uint256 nonce,
        address facilitator
    );

    event OperationExecuted(
        bytes32 indexed batchId,
        uint256 indexed operationIndex,
        uint8 opType,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        address target
    );

    event FacilitatorUpdated(address indexed facilitator, bool authorized);
    event RouterWhitelisted(address indexed router, bool whitelisted);
    event TargetWhitelisted(address indexed target, bool whitelisted);
    event PausedStateChanged(bool paused);
    event MaxOperationsUpdated(uint256 newMax);

    // =============================================================================
    // ERRORS
    // =============================================================================

    error InvalidSignature();
    error ExpiredDeadline();
    error InvalidNonce();
    error BatchIdAlreadyUsed();
    error UnauthorizedFacilitator();
    error ContractPaused();
    error InvalidTarget();
    error InvalidAmount();
    error TooManyOperations();
    error RouterNotWhitelisted();
    error TargetNotWhitelisted();
    error SwapFailed();
    error TransferFailed();
    error CallFailed();
    error InsufficientOutput();
    error InvalidOperationType();
    error OperationsHashMismatch();

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    constructor(address _owner, address _pancakeRouter) 
        EIP712("q402-batch", "1") 
        Ownable(_owner) 
    {
        facilitators[_owner] = true;
        emit FacilitatorUpdated(_owner, true);

        // Whitelist PancakeSwap router by default
        if (_pancakeRouter != address(0)) {
            whitelistedRouters[_pancakeRouter] = true;
            emit RouterWhitelisted(_pancakeRouter, true);
        }
    }

    // =============================================================================
    // MAIN EXECUTION FUNCTION
    // =============================================================================

    /**
     * @notice Execute a batch of operations with a single signature
     * @param witness The batch witness containing metadata
     * @param operations Array of operations to execute
     * @param signature EIP-712 signature from the owner
     */
    function executeBatch(
        BatchWitness calldata witness,
        Operation[] calldata operations,
        bytes calldata signature
    ) external nonReentrant {
        // Validations
        if (paused) revert ContractPaused();
        if (!facilitators[msg.sender]) revert UnauthorizedFacilitator();
        if (block.timestamp > witness.deadline) revert ExpiredDeadline();
        if (witness.nonce != nonces[witness.owner]) revert InvalidNonce();
        if (usedBatchIds[witness.batchId]) revert BatchIdAlreadyUsed();
        if (operations.length == 0 || operations.length > maxOperationsPerBatch) revert TooManyOperations();

        // Verify operations hash matches what was signed
        bytes32 computedOperationsHash = _hashOperations(operations);
        if (computedOperationsHash != witness.operationsHash) revert OperationsHashMismatch();

        // Verify signature
        _verifySignature(witness, signature);

        // Mark batch as used and increment nonce
        usedBatchIds[witness.batchId] = true;
        nonces[witness.owner] = witness.nonce + 1;

        // Execute each operation
        for (uint256 i = 0; i < operations.length; i++) {
            _executeOperation(witness.owner, witness.batchId, i, operations[i]);
        }

        emit BatchExecuted(
            witness.owner,
            witness.batchId,
            operations.length,
            witness.nonce,
            msg.sender
        );
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @notice Hash an array of operations for signature verification
     */
    function _hashOperations(Operation[] calldata operations) internal pure returns (bytes32) {
        bytes32[] memory operationHashes = new bytes32[](operations.length);
        
        for (uint256 i = 0; i < operations.length; i++) {
            operationHashes[i] = keccak256(abi.encode(
                OPERATION_TYPEHASH,
                operations[i].opType,
                operations[i].tokenIn,
                operations[i].amountIn,
                operations[i].tokenOut,
                operations[i].minAmountOut,
                operations[i].target,
                keccak256(operations[i].data)
            ));
        }
        
        return keccak256(abi.encodePacked(operationHashes));
    }

    /**
     * @notice Verify the EIP-712 signature
     */
    function _verifySignature(
        BatchWitness calldata witness,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(abi.encode(
            BATCH_WITNESS_TYPEHASH,
            witness.owner,
            witness.operationsHash,
            witness.deadline,
            witness.batchId,
            witness.nonce
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        if (signer != witness.owner) revert InvalidSignature();
    }

    /**
     * @notice Execute a single operation
     */
    function _executeOperation(
        address owner,
        bytes32 batchId,
        uint256 index,
        Operation calldata op
    ) internal {
        uint256 amountOut;

        if (op.opType == OP_TRANSFER) {
            amountOut = _executeTransfer(owner, op);
        } else if (op.opType == OP_SWAP) {
            amountOut = _executeSwap(owner, op);
        } else if (op.opType == OP_CALL) {
            amountOut = _executeCall(owner, op);
        } else {
            revert InvalidOperationType();
        }

        emit OperationExecuted(
            batchId,
            index,
            op.opType,
            op.tokenIn,
            op.amountIn,
            op.tokenOut,
            amountOut,
            op.target
        );
    }

    /**
     * @notice Execute a transfer operation
     */
    function _executeTransfer(
        address owner,
        Operation calldata op
    ) internal returns (uint256) {
        if (op.target == address(0)) revert InvalidTarget();
        if (op.amountIn == 0) revert InvalidAmount();

        if (op.tokenIn == address(0)) {
            // Native BNB transfer - must be pre-funded to this contract
            (bool success, ) = op.target.call{value: op.amountIn}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 transfer - pull from owner
            IERC20(op.tokenIn).safeTransferFrom(owner, op.target, op.amountIn);
        }

        return op.amountIn;
    }

    /**
     * @notice Execute a swap operation via whitelisted DEX router
     */
    function _executeSwap(
        address owner,
        Operation calldata op
    ) internal returns (uint256) {
        if (!whitelistedRouters[op.target]) revert RouterNotWhitelisted();
        if (op.amountIn == 0) revert InvalidAmount();

        uint256 balanceBefore;
        uint256 balanceAfter;

        // Track output balance
        if (op.tokenOut == address(0)) {
            balanceBefore = owner.balance;
        } else {
            balanceBefore = IERC20(op.tokenOut).balanceOf(owner);
        }

        if (op.tokenIn == address(0)) {
            // Native BNB to token swap
            // BNB must be pre-funded to this contract for native swaps
            (bool success, ) = op.target.call{value: op.amountIn}(op.data);
            if (!success) revert SwapFailed();
        } else {
            // Token to token/BNB swap
            // Pull tokens from owner
            IERC20(op.tokenIn).safeTransferFrom(owner, address(this), op.amountIn);
            
            // Approve router
            IERC20(op.tokenIn).approve(op.target, op.amountIn);
            
            // Execute swap
            (bool success, ) = op.target.call(op.data);
            if (!success) revert SwapFailed();
            
            // Reset approval
            IERC20(op.tokenIn).approve(op.target, 0);
        }

        // Check output balance
        if (op.tokenOut == address(0)) {
            balanceAfter = owner.balance;
        } else {
            balanceAfter = IERC20(op.tokenOut).balanceOf(owner);
        }

        uint256 amountOut = balanceAfter - balanceBefore;
        if (amountOut < op.minAmountOut) revert InsufficientOutput();

        return amountOut;
    }

    /**
     * @notice Execute an arbitrary contract call
     */
    function _executeCall(
        address owner,
        Operation calldata op
    ) internal returns (uint256) {
        if (!whitelistedTargets[op.target]) revert TargetNotWhitelisted();

        // Pull tokens if needed
        if (op.tokenIn != address(0) && op.amountIn > 0) {
            IERC20(op.tokenIn).safeTransferFrom(owner, address(this), op.amountIn);
            IERC20(op.tokenIn).approve(op.target, op.amountIn);
        }

        // Execute call
        uint256 value = (op.tokenIn == address(0)) ? op.amountIn : 0;
        (bool success, ) = op.target.call{value: value}(op.data);
        if (!success) revert CallFailed();

        // Reset approval if tokens were used
        if (op.tokenIn != address(0) && op.amountIn > 0) {
            IERC20(op.tokenIn).approve(op.target, 0);
        }

        return op.amountIn;
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get the current nonce for an owner
     */
    function getNonce(address owner) external view returns (uint256) {
        return nonces[owner];
    }

    /**
     * @notice Check if a batch ID has been used
     */
    function isBatchIdUsed(bytes32 batchId) external view returns (bool) {
        return usedBatchIds[batchId];
    }

    /**
     * @notice Check if an address is an authorized facilitator
     */
    function isFacilitator(address addr) external view returns (bool) {
        return facilitators[addr];
    }

    /**
     * @notice Check if a router is whitelisted
     */
    function isRouterWhitelisted(address router) external view returns (bool) {
        return whitelistedRouters[router];
    }

    /**
     * @notice Check if a target is whitelisted for calls
     */
    function isTargetWhitelisted(address target) external view returns (bool) {
        return whitelistedTargets[target];
    }

    /**
     * @notice Get the EIP-712 domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Compute the hash of operations for frontend use
     */
    function computeOperationsHash(Operation[] calldata operations) external pure returns (bytes32) {
        return _hashOperations(operations);
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Set facilitator authorization
     */
    function setFacilitator(address facilitator, bool authorized) external onlyOwner {
        facilitators[facilitator] = authorized;
        emit FacilitatorUpdated(facilitator, authorized);
    }

    /**
     * @notice Whitelist or remove a DEX router
     */
    function setRouterWhitelist(address router, bool whitelisted) external onlyOwner {
        whitelistedRouters[router] = whitelisted;
        emit RouterWhitelisted(router, whitelisted);
    }

    /**
     * @notice Whitelist or remove a target contract for calls
     */
    function setTargetWhitelist(address target, bool whitelisted) external onlyOwner {
        whitelistedTargets[target] = whitelisted;
        emit TargetWhitelisted(target, whitelisted);
    }

    /**
     * @notice Set maximum operations per batch
     */
    function setMaxOperationsPerBatch(uint256 _max) external onlyOwner {
        maxOperationsPerBatch = _max;
        emit MaxOperationsUpdated(_max);
    }

    /**
     * @notice Pause or unpause the contract
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    /**
     * @notice Emergency withdraw stuck funds
     */
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /**
     * @notice Receive native BNB (needed for swap operations)
     */
    receive() external payable {}
}

