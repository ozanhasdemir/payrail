// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Implemented by contracts that hold receivables (the EarlyPayPool). The registry
///         calls this with the settlement value attached so the holder can update its books.
interface IReceivableReceiver {
    function onReceivablePaid(uint256 invoiceId) external payable;
}
