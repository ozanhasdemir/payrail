// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {InvoiceRegistry} from "./InvoiceRegistry.sol";
import {ReceivableToken} from "./ReceivableToken.sol";
import {IReceivableReceiver} from "./interfaces/IReceivableReceiver.sol";

/// @title EarlyPayPool
/// @notice A native-USDC vault that buys approved receivables at a discount so suppliers get
///         paid before the due date. Depositors hold shares; NAV = cash + face value of
///         receivables held. The discount is realised when the buyer settles.
///
///         Pricing: discount = amount * annualRateBps * secondsToDue / (365 days * 10_000).
contract EarlyPayPool is ERC20, IReceivableReceiver, IERC721Receiver {
    InvoiceRegistry public immutable registry;
    ReceivableToken public immutable receivable;

    uint256 public annualRateBps; // e.g. 1200 = 12% APR
    uint256 public outstandingFace; // sum of face value of receivables we hold
    address public owner;

    event Deposited(address indexed from, uint256 assets, uint256 shares);
    event Withdrawn(address indexed to, uint256 assets, uint256 shares);
    event ReceivableBought(uint256 indexed invoiceId, address indexed seller, uint256 face, uint256 payout, uint256 discount);
    event ReceivableSettled(uint256 indexed invoiceId, uint256 face);
    event RateUpdated(uint256 annualRateBps);

    error OnlyOwner();
    error OnlyRegistry();
    error NotApproved();
    error PastDue();
    error InsufficientLiquidity(uint256 needed, uint256 available);
    error ZeroAmount();
    error TransferFailed();

    constructor(InvoiceRegistry registry_, uint256 annualRateBps_) ERC20("PayRail Pool Share", "prUSDC") {
        registry = registry_;
        receivable = registry_.receivable();
        annualRateBps = annualRateBps_;
        owner = msg.sender;
    }

    // ------------------------------------------------------------------ admin

    function setRate(uint256 bps) external {
        if (msg.sender != owner) revert OnlyOwner();
        annualRateBps = bps;
        emit RateUpdated(bps);
    }

    // ------------------------------------------------------------- accounting

    function totalAssets() public view returns (uint256) {
        return address(this).balance + outstandingFace;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 assetsBefore = totalAssets();
        if (supply == 0 || assetsBefore == 0) return assets;
        return (assets * supply) / assetsBefore;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    // ------------------------------------------------------------- depositors

    function deposit() external payable returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        // Shares are priced on assets *before* this deposit landed.
        uint256 supply = totalSupply();
        uint256 assetsBefore = totalAssets() - msg.value;
        shares = (supply == 0 || assetsBefore == 0) ? msg.value : (msg.value * supply) / assetsBefore;
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, msg.value, shares);
    }

    function withdraw(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        assets = convertToAssets(shares);
        if (assets > address(this).balance) revert InsufficientLiquidity(assets, address(this).balance);
        _burn(msg.sender, shares);
        (bool ok,) = msg.sender.call{value: assets}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, assets, shares);
    }

    // -------------------------------------------------------------- suppliers

    /// @notice What the pool would pay right now for this receivable.
    function quote(uint256 invoiceId) public view returns (uint256 payout, uint256 discount) {
        InvoiceRegistry.Invoice memory inv = registry.getInvoice(invoiceId);
        if (inv.status != InvoiceRegistry.Status.Approved) revert NotApproved();
        if (inv.dueDate <= block.timestamp) revert PastDue();
        uint256 secondsToDue = inv.dueDate - block.timestamp;
        discount = (inv.amount * annualRateBps * secondsToDue) / (365 days * 10_000);
        payout = inv.amount - discount;
    }

    /// @notice Supplier sells the receivable. Caller must have approved this pool on the
    ///         ReceivableToken (approve or setApprovalForAll) beforehand.
    function sell(uint256 invoiceId) external returns (uint256 payout) {
        (uint256 p, uint256 discount) = quote(invoiceId);
        payout = p;
        if (payout > address(this).balance) revert InsufficientLiquidity(payout, address(this).balance);

        InvoiceRegistry.Invoice memory inv = registry.getInvoice(invoiceId);
        receivable.safeTransferFrom(msg.sender, address(this), invoiceId);
        outstandingFace += inv.amount;

        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit ReceivableBought(invoiceId, msg.sender, inv.amount, payout, discount);
    }

    // --------------------------------------------------------------- registry

    /// @inheritdoc IReceivableReceiver
    function onReceivablePaid(uint256 invoiceId) external payable override {
        if (msg.sender != address(registry)) revert OnlyRegistry();
        outstandingFace -= msg.value;
        emit ReceivableSettled(invoiceId, msg.value);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
