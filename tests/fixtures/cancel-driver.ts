// Mirrors the cancelled-TUI path of src/cli.ts: an exec is waiting on a child whose descendant holds its stdout/stderr
// open, Ctrl+C calls killLive(), and the entrypoint then lets the process end with exitCode 130 (no process.exit).
import { RealIo } from "../../src/engine/io.ts";

const holdSeconds = Number(process.argv[2] ?? "6");
const io = new RealIo();
// The child spawns a descendant that inherits the pipes and outlives it, then idles until killed.
const script = `require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{}, ${holdSeconds * 1000})"], { stdio: "inherit" }); setTimeout(()=>{}, 60000)`;
const pending = io.exec(process.execPath, ["-e", script]);
setTimeout(() => {
  io.killLive();
  pending.then(() => { process.exitCode = 130; });
}, 400);
