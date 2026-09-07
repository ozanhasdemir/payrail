import { parseAbi } from "viem";

/** Hand-written ABIs for the three PayRail contracts. Kept minimal on purpose. */
export const invoiceRegistryAbi = parseAbi([
  "function submit(bytes32 docHash, address buyer, address supplier, uint256 amount, uint64 dueDate, string invoiceNumber) returns (uint256 id)",
  "function approve(uint256 id)",
  "function reject(uint256 id, string reason)",
  "function pay(uint256 id) payable",
  "function payee(uint256 id) view returns (address)",
  "function idByDocHash(bytes32) view returns (uint256)",
  "function nextId() view returns (uint256)",
  "function receivable() view returns (address)",
  "function getInvoice(uint256 id) view returns ((bytes32 docHash, address buyer, address supplier, uint256 amount, uint64 dueDate, uint64 submittedAt, uint8 status, string invoiceNumber))",
  "event InvoiceSubmitted(uint256 indexed id, address indexed buyer, address indexed supplier, uint256 amount, uint64 dueDate, bytes32 docHash, string invoiceNumber)",
  "event InvoiceApproved(uint256 indexed id, address indexed buyer)",
  "event InvoiceRejected(uint256 indexed id, address indexed buyer, string reason)",
  "event InvoicePaid(uint256 indexed id, address indexed payer, address indexed recipient, uint256 amount)",
]);

export const receivableTokenAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
]);

export const earlyPayPoolAbi = parseAbi([
  "function deposit() payable returns (uint256 shares)",
  "function withdraw(uint256 shares) returns (uint256 assets)",
  "function quote(uint256 invoiceId) view returns (uint256 payout, uint256 discount)",
  "function sell(uint256 invoiceId) returns (uint256 payout)",
  "function totalAssets() view returns (uint256)",
  "function outstandingFace() view returns (uint256)",
  "function annualRateBps() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "event ReceivableBought(uint256 indexed invoiceId, address indexed seller, uint256 face, uint256 payout, uint256 discount)",
  "event ReceivableSettled(uint256 indexed invoiceId, uint256 face)",
]);

export enum InvoiceStatus {
  None = 0,
  Submitted = 1,
  Approved = 2,
  Settled = 3,
  Rejected = 4,
}
