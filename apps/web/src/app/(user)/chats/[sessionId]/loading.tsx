// Subtle chat-shaped skeleton shown the instant a Recent Chats / session link is
// clicked, so the previous chat is not held on screen while the session loads.
const bubbles: Array<{ id: string; side: "left" | "right"; width: string }> = [
  { id: "a", side: "left", width: "58%" },
  { id: "b", side: "right", width: "44%" },
  { id: "c", side: "left", width: "66%" },
  { id: "d", side: "right", width: "38%" },
];

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-[16px] p-[28px]" aria-hidden>
      <div className="h-[22px] w-[180px] animate-pulse rounded-[6px] bg-[#e9e7e1]" />
      <div className="mt-[6px] flex flex-1 flex-col gap-[14px]">
        {bubbles.map((bubble) => (
          <div
            key={bubble.id}
            className={`h-[44px] animate-pulse rounded-[12px] bg-[#edeae3] ${
              bubble.side === "right" ? "self-end" : "self-start"
            }`}
            style={{ width: bubble.width }}
          />
        ))}
      </div>
      <div className="h-[46px] animate-pulse rounded-[12px] bg-[#edeae3]" />
    </div>
  );
}
