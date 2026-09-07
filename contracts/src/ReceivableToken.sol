// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title ReceivableToken
/// @notice One token per approved invoice. Token id equals invoice id. Whoever holds the
///         token is paid when the buyer settles the invoice. Only the InvoiceRegistry can
///         mint or burn; anyone holding a token may transfer it (for example, sell it to a pool).
contract ReceivableToken is ERC721 {
    address public immutable registry;

    error OnlyRegistry();

    constructor(address registry_) ERC721("PayRail Receivable", "PRCV") {
        registry = registry_;
    }

    modifier onlyRegistry() {
        if (msg.sender != registry) revert OnlyRegistry();
        _;
    }

    function mint(address to, uint256 invoiceId) external onlyRegistry {
        _safeMint(to, invoiceId);
    }

    function burn(uint256 invoiceId) external onlyRegistry {
        _burn(invoiceId);
    }
}
