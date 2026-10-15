import { z } from "zod";

export const EchoOutput = z.object({ summary: z.string().min(1).max(200) });
export type EchoOutput = z.infer<typeof EchoOutput>;
