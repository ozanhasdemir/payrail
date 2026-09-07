// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {InvoiceRegistry} from "../src/InvoiceRegistry.sol";
import {EarlyPayPool} from "../src/EarlyPayPool.sol";

/// Usage:
///   source ../.env
///   forge script script/Deploy.s.sol --rpc-url arc --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        uint256 rateBps = vm.envOr("POOL_ANNUAL_RATE_BPS", uint256(1200));

        vm.startBroadcast();
        InvoiceRegistry registry = new InvoiceRegistry();
        EarlyPayPool pool = new EarlyPayPool(registry, rateBps);
        vm.stopBroadcast();

        console.log("INVOICE_REGISTRY_ADDRESS=", address(registry));
        console.log("RECEIVABLE_TOKEN_ADDRESS=", address(registry.receivable()));
        console.log("EARLY_PAY_POOL_ADDRESS=", address(pool));
    }
}
