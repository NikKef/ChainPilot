// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Q402Implementation
 * @notice Gas-sponsored payment execution contract for Q402 protocol
 * @dev Implements EIP-712 typed signatures for secure payment authorization
 * 
 * @custom:security-contact security@chainpilot.app
 */
contract Q402Implementation is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // EIP-712 type hash for Witness struct
    bytes32 public constant WITNESS_TYPEHASH = keccak256(
        "Witness(address owner,address token,uint256 amount,address to,uint256 deadline,bytes32 paymentId,uint256 nonce)"
    );

    /// @notice Mapping of user address to their current nonce
    mapping(address => uint256) public nonces;

    /// @notice Mapping to track used payment IDs
    mapping(bytes32 => bool) public usedPaymentIds;

    /// @notice Mapping of authorized facilitators
    mapping(address => bool) public facilitators;

    /// @notice Whether the contract is paused
    bool public paused;

    event PaymentExecuted(
        address indexed owner,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        bytes32 paymentId,
        uint256 nonce,
        address facilitator
    );

    event FacilitatorUpdated(address indexed facilitator, bool authorized);
    event PausedStateChanged(bool paused);

    error InvalidSignature();
    error ExpiredDeadline();
    error InvalidNonce();
    error PaymentIdAlreadyUsed();
    error UnauthorizedFacilitator();
    error ContractPaused();
    error InvalidRecipient();
    error InvalidAmount();
    error TransferFailed();

    constructor(address _owner) 
        EIP712("q402", "1") 
        Ownable(_owner) 
    {
        facilitators[_owner] = true;
        emit FacilitatorUpdated(_owner, true);
    }

    /**
     * @notice Execute a payment transfer using a signed witness
     */
    function executeTransfer(
        address owner,
        address facilitator,
        address token,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        _validateTransfer(owner, facilitator, recipient, amount, nonce, deadline);
        
        bytes32 paymentId = _computePaymentId(owner, token, recipient, amount, nonce, deadline);
        
        _verifySignature(owner, token, amount, recipient, deadline, paymentId, nonce, signature);
        
        _executeTransfer(owner, token, recipient, amount, paymentId, nonce);
    }

    function _validateTransfer(
        address owner,
        address facilitator,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view {
        if (paused) revert ContractPaused();
        if (!facilitators[msg.sender] && msg.sender != facilitator) revert UnauthorizedFacilitator();
        if (block.timestamp > deadline) revert ExpiredDeadline();
        if (nonce != nonces[owner]) revert InvalidNonce();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
    }

    function _computePaymentId(
        address owner,
        address token,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 paymentId = keccak256(abi.encodePacked(owner, token, recipient, amount, nonce, deadline));
        if (usedPaymentIds[paymentId]) revert PaymentIdAlreadyUsed();
        return paymentId;
    }

    function _verifySignature(
        address owner,
        address token,
        uint256 amount,
        address recipient,
        uint256 deadline,
        bytes32 paymentId,
        uint256 nonce,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(abi.encode(
            WITNESS_TYPEHASH,
            owner,
            token,
            amount,
            recipient,
            deadline,
            paymentId,
            nonce
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        if (signer != owner) revert InvalidSignature();
    }

    function _executeTransfer(
        address owner,
        address token,
        address recipient,
        uint256 amount,
        bytes32 paymentId,
        uint256 nonce
    ) internal {
        usedPaymentIds[paymentId] = true;
        nonces[owner] = nonce + 1;

        if (token == address(0)) {
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransferFrom(owner, recipient, amount);
        }

        emit PaymentExecuted(owner, token, recipient, amount, paymentId, nonce, msg.sender);
    }

    // View functions
    function getNonce(address owner) external view returns (uint256) {
        return nonces[owner];
    }

    function isPaymentIdUsed(bytes32 paymentId) external view returns (bool) {
        return usedPaymentIds[paymentId];
    }

    function isFacilitator(address addr) external view returns (bool) {
        return facilitators[addr];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // Admin functions
    function setFacilitator(address facilitator, bool authorized) external onlyOwner {
        facilitators[facilitator] = authorized;
        emit FacilitatorUpdated(facilitator, authorized);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    receive() external payable {}
}
