// Step 1 of the flow path of the welcome tour: sits beside the New Flow dialog
// (above it on narrow screens, to its left on wide ones) and is tethered to it
// by a drawn connector, so the explanation reads as being about *that* form.
// Decorative connector only — the text carries the instruction.
export function NewFlowStepCallout() {
  return (
    <aside
      data-testid="new-flow-step-callout"
      className="wf-tour-callout absolute inset-x-0 bottom-[calc(100%+40px)] lg:inset-x-auto lg:bottom-auto lg:right-[calc(100%+64px)] lg:top-0 lg:w-[300px]"
    >
      <div className="rounded-[14px] border border-[#c3cef2] bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,.10)]">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#2f56d3]">
          Step 1 of 2 · Name your flow
        </div>
        <p className="mb-3 text-[12.5px] leading-[1.5] text-[#5c574c]">
          A flow is a guided conversation your team can run. Start by telling Wayfinder what it is
          and who the AI should be while running it.
        </p>
        <dl className="space-y-2 text-[12px] leading-[1.45]">
          <div>
            <dt className="font-semibold text-[#1c1b19]">Name</dt>
            <dd className="text-[#5c574c]">
              What people see when they start a chat — “Leave request”, “Purchase approval”.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[#1c1b19]">Expert role</dt>
            <dd className="text-[#5c574c]">
              Who the AI acts as. “Senior HR advisor” asks different questions from “Procurement
              officer”.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[#1c1b19]">Description &amp; icon</dt>
            <dd className="text-[#5c574c]">
              Optional. A line and a symbol that help people pick the right flow from the list.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11.5px] text-[#666055]">
          Save it and we&apos;ll show you how the steps work.
        </p>
      </div>

      {/* Horizontal tether for the side-by-side layout. */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 64 16"
        className="absolute left-full top-7 hidden h-4 w-16 lg:block"
      >
        <circle cx={3} cy={8} r={3} fill="#2f56d3" />
        <line
          className="wf-tour-connector"
          x1={3}
          y1={8}
          x2={56}
          y2={8}
          stroke="#2f56d3"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={53}
          style={{ "--wf-dash": 53 } as React.CSSProperties}
        />
        <circle className="wf-tour-connector-end" cx={59} cy={8} r={4} fill="#2f56d3" stroke="#fff" strokeWidth={1.5} />
      </svg>

      {/* Vertical tether for the stacked layout. */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 16 40"
        className="absolute left-8 top-full h-10 w-4 lg:hidden"
      >
        <circle cx={8} cy={3} r={3} fill="#2f56d3" />
        <line
          className="wf-tour-connector"
          x1={8}
          y1={3}
          x2={8}
          y2={33}
          stroke="#2f56d3"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={30}
          style={{ "--wf-dash": 30 } as React.CSSProperties}
        />
        <circle className="wf-tour-connector-end" cx={8} cy={36} r={4} fill="#2f56d3" stroke="#fff" strokeWidth={1.5} />
      </svg>
    </aside>
  );
}
