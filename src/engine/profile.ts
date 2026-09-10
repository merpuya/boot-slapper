import type { Artifact } from "./artifact.ts";
import type { Provider, Surface } from "./env.ts";

export interface Profile {
  name: string;
  provider: Provider;
  surfaces: Surface[];
  artifacts: Artifact[];
  options: Record<string, Record<string, unknown>>;
}
