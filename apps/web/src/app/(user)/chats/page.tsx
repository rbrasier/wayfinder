import { Button } from "@/components/ui/button";

export default function ChatsPage() {
  return (
    <main className="container py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chats</h1>
        <Button disabled>New Chat</Button>
      </div>
      <div className="flex flex-col items-center gap-4 py-24 text-center text-muted-foreground">
        <p className="text-lg font-medium">No sessions yet</p>
        <p className="text-sm">
          Start a new chat to begin a guided workflow session.
        </p>
      </div>
    </main>
  );
}
