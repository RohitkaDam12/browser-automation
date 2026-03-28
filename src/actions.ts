import { z } from "zod";


export const Action = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string().url()
  }),

  z.object({
    type: z.literal("waitFor"),
    selector: z.string(), 
    state: z.enum(["visible", "attached", "hidden", "detached"]).default("visible"),
    timeout: z.number().nullable().default(null)
  }),

  z.object({
    type: z.literal("fill"),
    selector: z.string(),
    valueKey: z.string()
  }),

  z.object({
    type: z.literal("click"),
    selector: z.string()
  }),

  z.object({
    type: z.literal("press"),
    selector: z.string(),
    key: z.string()
  }),

  z.object({
    type: z.literal("waitNetworkIdle"),
    // FIX: same here
    timeout: z.number().nullable().default(null)
  })
]);

export const Plan = z.object({
  meta: z.object({
    site: z.string(),
    goal: z.string()
  }),
  steps: z.array(Action).min(1).max(50)
});

export type Plan = z.infer<typeof Plan>;
export type Action = z.infer<typeof Action>;