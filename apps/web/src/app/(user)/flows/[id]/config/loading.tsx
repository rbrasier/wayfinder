// Canvas-shaped skeleton shown the instant a Configure Flow link is followed, so
// the flows list is not held on screen while this page's server work resolves.
// Mirrors the chat route's own loading state; the busy overlay covers the click
// itself, this covers every other way in — a typed URL, back/forward, and the
// admin /admin/flows/[id] redirect.
export default function Loading() {
  return (
    <div className="flex h-full flex-col" aria-hidden>
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[#e7e3db] bg-white px-4">
        <div className="h-[14px] w-[64px] animate-pulse rounded-[5px] bg-[#e9e7e1]" />
        <div className="h-[14px] w-[150px] animate-pulse rounded-[5px] bg-[#e9e7e1]" />
        <div className="ml-auto flex items-center gap-2">
          <div className="h-[28px] w-[86px] animate-pulse rounded-[9px] bg-[#edeae3]" />
          <div className="h-[28px] w-[70px] animate-pulse rounded-[9px] bg-[#edeae3]" />
          <div className="h-[28px] w-[32px] animate-pulse rounded-[9px] bg-[#edeae3]" />
        </div>
      </div>
      <div className="relative flex-1 bg-[radial-gradient(#ddd8d0_1px,transparent_1px)] [background-size:16px_16px]">
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-8">
          {[0, 1, 2].map((step) => (
            <div
              key={step}
              className="h-[52px] w-[150px] animate-pulse rounded-[8px] border border-[#e7e3db] bg-white"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
