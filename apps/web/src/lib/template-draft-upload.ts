export const MAX_EXAMPLE_COUNT = 10;
export const MAX_EXAMPLE_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_EXAMPLES_TOTAL_SIZE = 25 * 1024 * 1024;

export interface UploadedExample {
  filename: string;
  safeFilename: string;
  buffer: Buffer;
}

export interface UploadedExamples {
  base: UploadedExample;
  others: UploadedExample[];
}

export interface ExampleUploadFailure {
  status: number;
  body: { error: string; details?: { subject: string; message: string }[] };
}

const failure = (error: string, details?: ExampleUploadFailure["body"]["details"]) => ({
  error: { status: 400, body: details ? { error, details } : { error } },
});

const problemWith = (file: File): string | null => {
  if (!file.name.toLowerCase().endsWith(".docx")) return "Only Word (.docx) files can be used as examples.";
  if (file.size > MAX_EXAMPLE_FILE_SIZE) return "Over the 10 MB limit.";
  return null;
};

// Validates the filled examples the browser sent for drafting. Every problem
// file is named at once, so the author fixes the whole set in one go.
export const readUploadedExamples = async (
  formData: FormData,
): Promise<{ data: UploadedExamples; error?: undefined } | { data?: undefined; error: ExampleUploadFailure }> => {
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) return failure("Add at least one example document.");
  if (files.length > MAX_EXAMPLE_COUNT) return failure(`Upload up to ${MAX_EXAMPLE_COUNT} examples at a time.`);

  const details = files.flatMap((file) => {
    const message = problemWith(file);
    return message ? [{ subject: file.name, message }] : [];
  });
  if (details.length > 0) return failure("Some of these files can't be used as examples.", details);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_EXAMPLES_TOTAL_SIZE) {
    return failure("Together the examples are over 25 MB. Remove one and try again.");
  }

  const baseIndex = Number(formData.get("baseIndex") ?? 0);
  if (!Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= files.length) {
    return failure("Choose which example to use as the base.");
  }

  const examples = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      safeFilename: file.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
      buffer: Buffer.from(await file.arrayBuffer()),
    })),
  );

  return {
    data: {
      base: examples[baseIndex]!,
      others: examples.filter((_, index) => index !== baseIndex),
    },
  };
};
