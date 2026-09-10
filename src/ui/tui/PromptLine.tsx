import { Text, useInput } from "ink";
import { useRef, useState } from "react";
import type { Pending } from "./prompter.ts";

/** One-line input for the four prompt kinds. The value lives in a ref so keystrokes that land before a re-render cannot submit a stale string. */
export function PromptLine({ pending }: { pending: Pending }) {
  const ref = useRef("");
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.return) { const v = ref.current; ref.current = ""; setValue(""); pending.submit(v); return; }
    if (key.backspace || key.delete) { ref.current = ref.current.slice(0, -1); setValue(ref.current); return; }
    if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return;
    ref.current += input; setValue(ref.current);
  });
  const hint = pending.kind === "confirm" ? " [y/N]"
    : pending.kind === "gate" ? " — press Enter when done"
    : pending.fallback ? ` [${pending.fallback}]`
    : pending.kind === "secret" ? " (blank to skip)" : "";
  const shown = pending.kind === "secret" ? "•".repeat(value.length) : value;
  return <Text color="cyan">? {pending.label}{hint}: {shown}▌</Text>;
}
