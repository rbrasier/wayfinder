import { EditSynthesisContent } from "./_content";

export default async function EditSynthesisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditSynthesisContent flowId={id} />;
}
