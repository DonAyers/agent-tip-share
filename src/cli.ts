import fs from "node:fs";
import { openDb, checkpoint } from "./db.js";
import * as store from "./store.js";

const [cmd, file] = process.argv.slice(2);
const db = openDb();

if (cmd === "dump") {
  const out = file ?? "tipshare-dump.json";
  const data = store.exportStore(db);
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  checkpoint(db, "TRUNCATE");
  console.log(
    `dumped ${data.topics.length} topics, ${data.tips.length} tips, ${data.outcomes.length} outcomes -> ${out}`
  );
} else if (cmd === "restore") {
  if (!file) {
    console.error("usage: restore <dump-file>");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as store.ExportData;
  const counts = store.importStore(db, data);
  checkpoint(db, "TRUNCATE");
  console.log(
    `restored ${counts.topics} topics, ${counts.tips} tips, ${counts.outcomes} outcomes`
  );
} else if (cmd === "checkpoint") {
  checkpoint(db, "TRUNCATE");
  console.log(`checkpointed WAL into ${db.name}`);
} else {
  console.error(
    "usage: tipshare dump [file] | tipshare restore <file> | tipshare checkpoint"
  );
  process.exit(1);
}