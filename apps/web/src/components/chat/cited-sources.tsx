import type { CitedSource } from "@wayfinder/domain";
import { citedSourceRows } from "./cited-sources-model";

// The source records a reply cited, numbered as the reply cites them (ADR-062 §6).
export function CitedSources({ sources }: { sources: readonly CitedSource[] | undefined }) {
  const rows = citedSourceRows(sources);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-[8px] border border-[#e7e3db] px-3 py-2" data-cited-sources>
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#736d5f]">Sources</p>
      <ol className="mt-1 space-y-1">
        {rows.map((row) => (
          <li key={row.marker} className="text-[12px] leading-snug text-[#26241f]">
            <span className="mr-1 font-mono text-[#736d5f]">[{row.marker}]</span>
            {row.href ? (
              <a href={row.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {row.title}
              </a>
            ) : (
              <span>{row.title}</span>
            )}
            {row.detail ? <span className="ml-1 text-[#736d5f]">— {row.detail}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
