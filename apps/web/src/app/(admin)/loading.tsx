// Subtle skeleton shown the instant an admin-area navigation starts, so the
// previous page is never held on screen while the destination's server work runs.
const cards = ["a", "b", "c", "d", "e", "f"];

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-[14px] p-[28px]" aria-hidden>
      <div className="h-[26px] w-[220px] animate-pulse rounded-[6px] bg-[#e9e7e1]" />
      <div className="mt-[6px] grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card} className="h-[96px] animate-pulse rounded-[10px] bg-[#edeae3]" />
        ))}
      </div>
    </div>
  );
}
