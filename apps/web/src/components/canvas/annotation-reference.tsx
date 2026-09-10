interface ReferenceEntry {
  syntax: string;
  meaning: string;
}

interface ReferenceGroup {
  title: string;
  note?: string;
  entries: ReferenceEntry[];
}

// The complete annotation grammar, as the author types it into Word. Every entry
// here parses — they are the same keywords the validator accepts, so anything
// copied off this screen is a valid placeholder.
const REFERENCE: ReferenceGroup[] = [
  {
    title: "The basics",
    entries: [
      { syntax: "{{ Supplier Name }}", meaning: "A plain text value" },
      { syntax: "{{ Middle Name (optional) }}", meaning: "May be left blank" },
    ],
  },
  {
    title: "Kinds of value",
    note: "One per placeholder. Text is assumed when none is given.",
    entries: [
      { syntax: "{{ Notes (text) }}", meaning: "Text" },
      { syntax: "{{ Start Date (date) }}", meaning: "A date" },
      { syntax: "{{ Contract Value (currency) }}", meaning: "An amount of money" },
      { syntax: "{{ Headcount (number) }}", meaning: "A number" },
      { syntax: "{{ Contact Email (email) }}", meaning: "An email address" },
      { syntax: "{{ Insured (yesno) }}", meaning: "Yes or no" },
      {
        syntax: "{{ Background (narrative) }}",
        meaning: "A paragraph the AI writes from the conversation",
      },
      {
        syntax: "{{ Delegate Sign Off (approval) }}",
        meaning:
          "A signature slot. Nobody is asked for it — an approval step fills it in with the approver's name, decision, date and comment when they decide. (signature) means the same thing.",
      },
    ],
  },
  {
    title: "Choices",
    entries: [
      {
        syntax: "{{ Status (options: Draft, Final) }}",
        meaning: "One of a fixed set of choices",
      },
      {
        syntax: "{{ Equipment (multi-options: Laptop, Phone) }}",
        meaning: "Any number of a fixed set of choices",
      },
    ],
  },
  {
    title: "Limits",
    note: "Add as many as apply, each in its own brackets.",
    entries: [
      { syntax: "{{ Summary (maxlen: 200) }}", meaning: "At most 200 characters" },
      { syntax: "{{ Quantity (number) (min: 1) }}", meaning: "No lower than 1" },
      { syntax: "{{ Quantity (number) (max: 50) }}", meaning: "No higher than 50" },
    ],
  },
  {
    title: "Blocks",
    note: "These span several lines, so they are edited in Word rather than here.",
    entries: [
      {
        syntax: "{{#Warranty}} … {{/Warranty}}",
        meaning: "Include the text between the tags only when Warranty is yes",
      },
      {
        syntax: "{{^Warranty}} … {{/Warranty}}",
        meaning: "Include it only when Warranty is no",
      },
      {
        syntax: "{{#Items (repeat)}} … {{/Items}}",
        meaning: "Repeat the text between the tags once per item, e.g. a table row",
      },
      {
        syntax: "{{#Items (repeat) (max: 10)}}",
        meaning: "Repeat at most 10 times",
      },
    ],
  },
];

// The complete list of annotations, reachable from the modal whenever the author
// is about to write placeholders in Word.
export function AnnotationReference() {
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#5c574c]">
        Type these into your document wherever a value should be filled in, then upload it again —
        the flow picks up where it left off. The name between the braces is what the person running
        the flow is asked for.
      </p>

      {REFERENCE.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <p className="text-[12px] font-medium text-[#1c1b19]">{group.title}</p>
          {group.note && <p className="text-[11px] text-[#666055]">{group.note}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <tbody>
                {group.entries.map((entry) => (
                  <tr key={entry.syntax} className="border-b border-[#f0eee9] last:border-0">
                    <td className="w-1/2 py-1.5 pr-4 align-top">
                      <code className="whitespace-nowrap font-mono text-[#2f56d3]">
                        {entry.syntax}
                      </code>
                    </td>
                    <td className="py-1.5 align-top text-[#5c574c]">{entry.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
