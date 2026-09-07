// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {InvoiceRegistry} from "../src/InvoiceRegistry.sol";
import {ReceivableToken} from "../src/ReceivableToken.sol";
import {EarlyPayPool} from "../src/EarlyPayPool.sol";

contract PayRailTest is Test {
    InvoiceRegistry registry;
    ReceivableToken receivable;
    EarlyPayPool pool;

    address buyer = makeAddr("buyer");
    address supplier = makeAddr("supplier");
    address lp = makeAddr("lp");
    address stranger = makeAddr("stranger");

    // On Arc, native value is USDC with 18 decimals, so `ether` reads as USDC here.
    uint256 constant AMOUNT = 4_200 ether;

    function setUp() public {
        registry = new InvoiceRegistry();
        receivable = registry.receivable();
        pool = new EarlyPayPool(registry, 1200); // 12% APR

        vm.deal(buyer, 100_000 ether);
        vm.deal(lp, 100_000 ether);
    }

    function _submit(uint64 dueInDays) internal returns (uint256 id) {
        id = registry.submit(
            keccak256(abi.encodePacked("doc", dueInDays, block.timestamp)),
            buyer,
            supplier,
            AMOUNT,
            uint64(block.timestamp + dueInDays * 1 days),
            "INV-2026-0142"
        );
    }

    // ------------------------------------------------------------ lifecycle

    function test_submitApprovePay_directToSupplier() public {
        uint256 id = _submit(30);

        vm.prank(buyer);
        registry.approve(id);
        assertEq(receivable.ownerOf(id), supplier);

        vm.prank(buyer);
        registry.pay{value: AMOUNT}(id);

        assertEq(supplier.balance, AMOUNT);
        assertEq(uint8(registry.getInvoice(id).status), uint8(InvoiceRegistry.Status.Settled));
        vm.expectRevert();
        receivable.ownerOf(id); // burned
    }

    function test_onlyBuyerCanApprove() public {
        uint256 id = _submit(30);
        vm.prank(stranger);
        vm.expectRevert(InvoiceRegistry.NotBuyer.selector);
        registry.approve(id);
    }

    function test_anyWalletMaySettleApprovedInvoice() public {
        uint256 id = _submit(30);
        vm.prank(buyer);
        registry.approve(id);

        address treasury = makeAddr("treasury");
        vm.deal(treasury, AMOUNT);
        vm.prank(treasury);
        registry.pay{value: AMOUNT}(id);

        assertEq(supplier.balance, AMOUNT);
        assertEq(uint8(registry.getInvoice(id).status), uint8(InvoiceRegistry.Status.Settled));
    }

    function test_payRequiresExactAmount() public {
        uint256 id = _submit(30);
        vm.prank(buyer);
        registry.approve(id);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.WrongAmount.selector, AMOUNT, AMOUNT - 1));
        registry.pay{value: AMOUNT - 1}(id);
    }

    function test_cannotPayUnapproved() public {
        uint256 id = _submit(30);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.WrongStatus.selector, InvoiceRegistry.Status.Submitted));
        registry.pay{value: AMOUNT}(id);
    }

    function test_duplicateDocumentRejected() public {
        bytes32 h = keccak256("same doc");
        registry.submit(h, buyer, supplier, AMOUNT, uint64(block.timestamp + 10 days), "A");
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.DuplicateDocument.selector, 1));
        registry.submit(h, buyer, supplier, AMOUNT, uint64(block.timestamp + 10 days), "B");
    }

    function test_reject() public {
        uint256 id = _submit(30);
        vm.prank(buyer);
        registry.reject(id, "PO quantity mismatch on line 3");
        assertEq(uint8(registry.getInvoice(id).status), uint8(InvoiceRegistry.Status.Rejected));
    }

    // ----------------------------------------------------------------- pool

    function test_sellToPool_thenBuyerPaysPool() public {
        vm.prank(lp);
        pool.deposit{value: 50_000 ether}();
        assertEq(pool.balanceOf(lp), 50_000 ether);

        uint256 id = _submit(60);
        vm.prank(buyer);
        registry.approve(id);

        (uint256 payout, uint256 discount) = pool.quote(id);
        // 12% APR for 60 days on 4,200 = 4200 * 0.12 * 60/365 = ~82.85
        assertApproxEqAbs(discount, 82.849 ether, 0.01 ether);
        assertEq(payout, AMOUNT - discount);

        vm.startPrank(supplier);
        receivable.approve(address(pool), id);
        pool.sell(id);
        vm.stopPrank();

        assertEq(supplier.balance, payout, "supplier paid early, minus discount");
        assertEq(receivable.ownerOf(id), address(pool));
        assertEq(pool.outstandingFace(), AMOUNT);
        // NAV rose by the discount the moment we bought.
        assertEq(pool.totalAssets(), 50_000 ether + discount);

        vm.warp(block.timestamp + 60 days - 1);
        vm.prank(buyer);
        registry.pay{value: AMOUNT}(id);

        assertEq(pool.outstandingFace(), 0);
        assertEq(address(pool).balance, 50_000 ether + discount);

        // LP can now withdraw principal plus yield.
        vm.prank(lp);
        uint256 got = pool.withdraw(50_000 ether);
        assertEq(got, 50_000 ether + discount);
    }

    function test_sellRevertsWithoutLiquidity() public {
        uint256 id = _submit(30);
        vm.prank(buyer);
        registry.approve(id);

        vm.startPrank(supplier);
        receivable.approve(address(pool), id);
        vm.expectRevert();
        pool.sell(id);
        vm.stopPrank();
    }

    function test_quoteRevertsWhenNotApproved() public {
        uint256 id = _submit(30);
        vm.expectRevert(EarlyPayPool.NotApproved.selector);
        pool.quote(id);
    }

    function test_onlyRegistryCanSettleIntoPool() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(EarlyPayPool.OnlyRegistry.selector);
        pool.onReceivablePaid{value: 1 ether}(1);
    }

    function test_withdrawLimitedByCash() public {
        vm.prank(lp);
        pool.deposit{value: 10_000 ether}();

        uint256 id = _submit(30);
        vm.prank(buyer);
        registry.approve(id);
        vm.startPrank(supplier);
        receivable.approve(address(pool), id);
        pool.sell(id);
        vm.stopPrank();

        // Most cash is now locked in the receivable; full withdrawal must wait for settlement.
        vm.prank(lp);
        vm.expectRevert();
        pool.withdraw(10_000 ether);
    }
}
