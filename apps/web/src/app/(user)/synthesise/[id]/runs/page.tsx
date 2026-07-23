import { RunsContent } from "./_content";

export default async function RunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunsContent flowId={id} />;
}
