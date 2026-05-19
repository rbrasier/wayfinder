import { Button } from "@/components/ui/button";

export default function AdminFlowsPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Flows</h1>
        <Button disabled>New Flow</Button>
      </div>
      <div className="flex flex-col items-center gap-4 py-24 text-center text-muted-foreground">
        <p className="text-lg font-medium">No flows yet</p>
        <p className="text-sm">
          Create a flow to define the guided workflow your users will follow.
        </p>
      </div>
    </div>
  );
}
