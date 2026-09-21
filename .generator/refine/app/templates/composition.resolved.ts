import { frontendCompositionCustom } from "./composition.custom";
import { frontendCompositionGenerated } from "./composition.generated";

import { resolveFrontendComposition } from "@/platform/composition";

export const frontendComposition = resolveFrontendComposition(
  frontendCompositionGenerated,
  frontendCompositionCustom,
);
