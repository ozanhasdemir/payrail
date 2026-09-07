// PayRail agent entry point.
// Pipeline: ingest -> match -> resolve -> verify -> pay
// Each stage lives in its own folder and is independently testable from the CLI.
import "dotenv/config";

console.log("payrail agent: scaffold only, pipeline lands on Day 2");
