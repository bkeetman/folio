import { z } from "zod";

export const metadataChangesSchema = z
  .object({
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    publishedYear: z.number().int().min(1000).max(9999).optional(),
    language: z.string().optional(),
    isbn: z.string().optional(),
    series: z.string().optional(),
    seriesIndex: z.number().positive().optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
    message: "At least one metadata field is required.",
  });

export type MetadataChanges = z.infer<typeof metadataChangesSchema>;

export const metadataExpectedValuesSchema = z
  .object({
    title: z.string().nullable().optional(),
    authors: z.array(z.string()).optional(),
    publishedYear: z.number().int().nullable().optional(),
    language: z.string().nullable().optional(),
    isbn: z.string().nullable().optional(),
    series: z.string().nullable().optional(),
    seriesIndex: z.number().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

export type MetadataExpectedValues = z.infer<typeof metadataExpectedValuesSchema>;

export const metadataProposalPayloadSchema = z
  .object({
    version: z.literal(1),
    itemId: z.string().min(1),
    changes: metadataChangesSchema,
    expected: metadataExpectedValuesSchema,
    source: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    overwrite: z.boolean(),
  })
  .strict();

export type MetadataProposalPayload = z.infer<typeof metadataProposalPayloadSchema>;

export function parseMetadataChanges(value: unknown): MetadataChanges {
  return parseWithContext(metadataChangesSchema, value, "Invalid metadata changes");
}

export function parseMetadataProposalPayload(
  value: unknown,
  changeId: string,
): MetadataProposalPayload {
  return parseWithContext(
    metadataProposalPayloadSchema,
    value,
    `Invalid metadata proposal ${changeId}`,
  );
}

function parseWithContext<T>(schema: z.ZodType<T>, value: unknown, context: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
    .join("; ");
  throw new Error(`${context}: ${details}`);
}
