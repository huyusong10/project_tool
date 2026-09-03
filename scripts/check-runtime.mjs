import Database from "better-sqlite3";

const database = new Database(":memory:");
const result = database.prepare("select 1 as ok").get();
database.close();

if (result?.ok !== 1) {
  throw new Error("better-sqlite3 runtime self-check failed");
}

console.log("Native runtime check passed.");
