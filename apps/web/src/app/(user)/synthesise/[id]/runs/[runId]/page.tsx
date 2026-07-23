import { RunScreenContent } from "./_content";

export default async function RunScreenPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  return <RunScreenContent flowId={id} runId={runId} />;
}
