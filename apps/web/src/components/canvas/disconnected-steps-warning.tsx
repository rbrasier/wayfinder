// Advisory shown when the canvas holds a step that is joined to nothing. The
// runtime walks edges, so a stranded step never runs — and nothing else on this
// screen teaches the drag gesture that joins one, hence the demonstration.
export function DisconnectedStepsWarning({ count }: { count: number }) {
  return (
    // The live region itself stays mounted and only its contents change. A
    // region that appears already populated is announced unreliably, and this
    // warning always arrives in response to an edit the author just made.
    // Positioning lives in the canvas warning band, which stacks this with the
    // unclaimed-signature advisory.
    <div role="status">
      {count > 0 && (
        // Copy and demonstration sit side by side rather than stacked: the
        // banner overlays the canvas, so height is the expensive axis.
        <div className="flex items-center gap-4 rounded-[9px] border border-[#e7c200] bg-[#fff8e1] px-4 py-2.5 shadow-md">
          <p className="flex-1 text-left text-[12px] leading-[1.5] text-[#886b00]">
            ⚠ Some steps aren&apos;t joined up yet. Every step needs to be joined to the others to
            be part of the workflow — drag from the dot on the right of one step to the dot on the
            left of the next to link them in order.
          </p>
          <ConnectGestureDemo />
        </div>
      )}
    </div>
  );
}

// Two steps being joined, on a loop: the pointer drags from the source dot to
// the target dot, the connector draws behind it, the target snaps. Decorative —
// the copy above carries the whole instruction, so it is hidden from assistive
// technology and holds its finished state under reduced motion.
function ConnectGestureDemo() {
  return (
    <svg
      viewBox="0 0 364 40"
      className="wf-connect-demo h-10 w-[364px] shrink-0 max-w-full"
      aria-hidden="true"
      focusable="false"
    >
      <StepCard x={8} />
      <StepCard x={256} />

      <line
        className="wf-connect-line stroke-wf-primary"
        x1={112}
        y1={20}
        x2={252}
        y2={20}
       
        strokeWidth={2}
        strokeLinecap="round"
      />

      <circle className="fill-wf-primary" cx={112} cy={20} r={4.5} stroke="#fff" strokeWidth={1.5} />

      <g className="wf-connect-target">
        <circle className="fill-wf-primary" cx={252} cy={20} r={4.5} stroke="#fff" strokeWidth={1.5} />
      </g>

      <g transform="translate(112 20)">
        <g className="wf-connect-pointer">
          <path
            d="M0 0 L0 13 L3.4 9.7 L5.8 14.6 L8.6 13.3 L6.2 8.5 L10.2 8 Z"
            fill="#3f3b34"
            stroke="#fff"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}

function StepCard({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y={7} width={100} height={26} rx={5} fill="#fff" stroke="#c3cee9" />
      <rect className="fill-wf-primary" x={x + 8} y={14} width={12} height={12} rx={3} />
      <rect x={x + 26} y={16} width={52} height={3.5} rx={1.75} fill="#b9b4ab" />
      <rect x={x + 26} y={23} width={34} height={3.5} rx={1.75} fill="#ddd8d0" />
    </g>
  );
}
