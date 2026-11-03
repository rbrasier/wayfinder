import { NextResponse, type NextRequest } from "next/server";
import { rowsFromDraft } from "@/lib/template-annotation";
import { readUploadedExamples, type UploadedExample } from "@/lib/template-draft-upload";
import { authoriseTemplateNode, generatorFor } from "@/lib/template-route-helpers";

const UNREADABLE_EXAMPLE = "This file could not be read as a Word document.";

const textOf = (example: UploadedExample): string | null =>
  generatorFor("docx").extractFullText({ templateBytes: example.buffer }).data?.text ?? null;

// Drafts a template from filled examples (ADR-067). Nothing is persisted: the
// examples may carry real supplier data or personal details, so they live only
// in this request and in the browser. The author saves through POST …/template,
// which re-applies the reviewed rows to the base example.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;

  const upload = await readUploadedExamples(await req.formData());
  if (upload.error) return NextResponse.json(upload.error.body, { status: upload.error.status });

  const { base, others } = upload.data;
  const texts = [base, ...others].map((example) => ({ example, text: textOf(example) }));
  const unreadable = texts.filter((entry) => entry.text === null);
  if (unreadable.length > 0) {
    return NextResponse.json(
      {
        error: "Some of these files can't be used as examples.",
        details: unreadable.map((entry) => ({ subject: entry.example.filename, message: UNREADABLE_EXAMPLE })),
      },
      { status: 422 },
    );
  }

  const drafted = await access.data.container.useCases.draftTemplateFromExamples.execute({
    baseBytes: base.buffer,
    baseText: texts[0]!.text!,
    otherTexts: texts.slice(1).map((entry) => entry.text!),
    flowId,
  });
  if (drafted.error) {
    return NextResponse.json({ error: "Couldn't draft fields from these examples." }, { status: 502 });
  }

  return NextResponse.json({
    filename: base.safeFilename,
    exampleCount: texts.length,
    rows: rowsFromDraft(drafted.data.fields),
    sameInEveryExample: rowsFromDraft(drafted.data.sameInEveryExample),
    unplaced: drafted.data.unplaced,
    comparison: drafted.data.comparison,
    taggedDocument: drafted.data.taggedDocument.toString("base64"),
  });
}
