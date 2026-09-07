// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceivableToken} from "./ReceivableToken.sol";
import {IReceivableReceiver} from "./interfaces/IReceivableReceiver.sol";

/// @title InvoiceRegistry
/// @notice Lifecycle of a B2B invoice on Arc. Amounts are native USDC (18 decimals on Arc,
///         so 1 USDC = 1e18). Payment is sent with the call and forwarded to whoever holds
///         the receivable token, which lets a supplier sell the receivable before due date.
///
///         Submitted --approve--> Approved --pay--> Settled
///                   \--reject--> Rejected
contract InvoiceRegistry {
    enum Status {
        None,
        Submitted,
        Approved,
        Settled,
        Rejected
    }

    struct Invoice {
        bytes32 docHash; // keccak256 of the canonical invoice JSON
        address buyer;
        address supplier;
        uint256 amount; // native USDC, 18 decimals
        uint64 dueDate; // unix seconds
        uint64 submittedAt;
        Status status;
        string invoiceNumber; // supplier invoice number, e.g. "INV-2026-0142"
    }

    ReceivableToken public immutable receivable;
    uint256 public nextId = 1;
    mapping(uint256 => Invoice) private _invoices;
    mapping(bytes32 => uint256) public idByDocHash;

    event InvoiceSubmitted(
        uint256 indexed id,
        address indexed buyer,
        address indexed supplier,
        uint256 amount,
        uint64 dueDate,
        bytes32 docHash,
        string invoiceNumber
    );
    event InvoiceApproved(uint256 indexed id, address indexed buyer);
    event InvoiceRejected(uint256 indexed id, address indexed buyer, string reason);
    event InvoicePaid(uint256 indexed id, address indexed payer, address indexed recipient, uint256 amount);

    error NotBuyer();
    error WrongStatus(Status current);
    error WrongAmount(uint256 expected, uint256 received);
    error DuplicateDocument(uint256 existingId);
    error ZeroAddress();
    error ZeroAmount();
    error DueDateInPast();
    error TransferFailed();

    constructor() {
        receivable = new ReceivableToken(address(this));
    }

    // ---------------------------------------------------------------- views

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    /// @notice Who gets paid if this invoice settles now.
    function payee(uint256 id) public view returns (address) {
        Invoice storage inv = _invoices[id];
        if (inv.status == Status.Approved) return receivable.ownerOf(id);
        return inv.supplier;
    }

    // ------------------------------------------------------------- lifecycle

    /// @notice Anyone may submit (the supplier, or the buyer's agent after parsing). Only the
    ///         named buyer can approve, so a bogus submission is inert.
    function submit(bytes32 docHash, address buyer, address supplier, uint256 amount, uint64 dueDate, string calldata invoiceNumber)
        external
        returns (uint256 id)
    {
        if (buyer == address(0) || supplier == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (dueDate <= block.timestamp) revert DueDateInPast();
        uint256 existing = idByDocHash[docHash];
        if (existing != 0) revert DuplicateDocument(existing);

        id = nextId++;
        _invoices[id] = Invoice({
            docHash: docHash,
            buyer: buyer,
            supplier: supplier,
            amount: amount,
            dueDate: dueDate,
            submittedAt: uint64(block.timestamp),
            status: Status.Submitted,
            invoiceNumber: invoiceNumber
        });
        idByDocHash[docHash] = id;

        emit InvoiceSubmitted(id, buyer, supplier, amount, dueDate, docHash, invoiceNumber);
    }

    /// @notice Buyer accepts the invoice. Mints the receivable to the supplier.
    function approve(uint256 id) external {
        Invoice storage inv = _invoices[id];
        if (msg.sender != inv.buyer) revert NotBuyer();
        if (inv.status != Status.Submitted) revert WrongStatus(inv.status);

        inv.status = Status.Approved;
        receivable.mint(inv.supplier, id);

        emit InvoiceApproved(id, msg.sender);
    }

    function reject(uint256 id, string calldata reason) external {
        Invoice storage inv = _invoices[id];
        if (msg.sender != inv.buyer) revert NotBuyer();
        if (inv.status != Status.Submitted) revert WrongStatus(inv.status);

        inv.status = Status.Rejected;
        emit InvoiceRejected(id, msg.sender, reason);
    }

    /// @notice Buyer pays the full amount as native USDC. Funds go to the current receivable
    ///         holder: the supplier, or the pool that bought the receivable.
    function pay(uint256 id) external payable {
        Invoice storage inv = _invoices[id];
        if (msg.sender != inv.buyer) revert NotBuyer();
        if (inv.status != Status.Approved) revert WrongStatus(inv.status);
        if (msg.value != inv.amount) revert WrongAmount(inv.amount, msg.value);

        address recipient = receivable.ownerOf(id);
        inv.status = Status.Settled;
        receivable.burn(id);

        if (recipient.code.length > 0) {
            IReceivableReceiver(recipient).onReceivablePaid{value: msg.value}(id);
        } else {
            (bool ok,) = recipient.call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }

        emit InvoicePaid(id, msg.sender, recipient, msg.value);
    }
}
