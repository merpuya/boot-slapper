import { Box, Text } from "ink";
import type { ArtifactRow, Note, StepRow } from "./model.ts";
import { stateLabel, summary } from "./model.ts";

const ICON = { ok: "✓", info: "·", warn: "!", error: "✗" } as const;
const COLOR = { ok: "green", info: "cyan", warn: "yellow", error: "red" } as const;
const STEP = { pending: "·", running: "…", ok: "✓", failed: "✗", skipped: "-" } as const;

/** An icon column plus a wrapping text column, so a long message's continuation lines hang under the text, not under the icon. */
function Hanging({ indent, icon, color, children }: { indent: number; icon: string; color?: string; children: string }) {
  return (
    <Box paddingLeft={indent}>
      <Box flexShrink={0} width={icon.length + 1}><Text color={color}>{icon}</Text></Box>
      <Box flexShrink={1}><Text color={color}>{children}</Text></Box>
    </Box>
  );
}

function StepLine({ step }: { step: StepRow }) {
  const color = step.status === "ok" ? "green" : step.status === "failed" ? "red" : step.status === "running" ? "cyan" : step.status === "skipped" ? "yellow" : undefined;
  return (
    <Hanging indent={4} icon={STEP[step.status]} color={color}>{`${step.title}${step.interactive ? " (interactive)" : ""}${step.error ? ` — ${step.error}` : ""}${step.skipReason ? ` — skipped: ${step.skipReason}` : ""}`}</Hanging>
  );
}

/** Spec §5 screen 1/2: one row per artifact (state, portability), its steps beneath. */
export function PlanRows({ rows }: { rows: ArtifactRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Box key={r.id} flexDirection="column">
          <Text>
            <Text bold>{r.id}</Text> <Text dimColor>[{r.portability ?? "?"}]</Text>: {stateLabel(r.state)}
            {r.skipped ? <Text color="yellow"> — skipped: {r.skipped}</Text> : null}
          </Text>
          {r.steps.map((s) => <StepLine key={s.id} step={s} />)}
        </Box>
      ))}
    </Box>
  );
}

/** Spec §5 screen 3: checks grouped per artifact, then the summary line the headless skin prints. */
export function CheckRows({ rows }: { rows: ArtifactRow[] }) {
  const s = summary(rows);
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.filter((r) => r.checks.length).map((r) => (
        <Box key={r.id} flexDirection="column">
          <Text bold>{r.id}</Text>
          {r.checks.map((c, i) => (
            <Hanging key={`${c.id}-${i}`} indent={4} icon={ICON[c.status]} color={COLOR[c.status]}>{c.message}</Hanging>
          ))}
        </Box>
      ))}
      <Text>
        {s.error ? <Text color="red">Doctor: {s.error} check(s) FAILED</Text> : <Text color="green">Doctor: all checks passed</Text>}
        {s.warn ? <Text color="yellow"> ({s.warn} warning(s))</Text> : null}
      </Text>
    </Box>
  );
}

export function Notes({ notes }: { notes: Note[] }) {
  return (
    <Box flexDirection="column">
      {notes.map((n, i) => (
        <Hanging key={i} indent={4} icon={n.level === "info" ? "·" : ICON[n.level]} color={n.level === "info" ? undefined : COLOR[n.level]}>{n.message}</Hanging>
      ))}
    </Box>
  );
}
