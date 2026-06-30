"use client";

export interface YearMonth {
  year: number;
  month: number; // 1..12
}

const WEEKDAY_HEADINGS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const addMonths = (current: YearMonth, delta: number): YearMonth => {
  const zeroBased = current.month - 1 + delta;
  const year = current.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  return { year, month: month + 1 };
};

// A flat, Sunday-aligned grid of day numbers for a month, padded with `null`
// for the leading blanks and trailing fill so the length is a multiple of 7.
export const buildMonthGrid = (year: number, month: number): (number | null)[] => {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let blank = 0; blank < firstWeekday; blank += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

interface CalendarPickerProps {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  onSelect: (parts: { year: number; month: number; day: number }) => void;
  onMonthChange: (next: YearMonth) => void;
}

export function CalendarPicker({ year, month, day, onSelect, onMonthChange }: CalendarPickerProps) {
  const grid = buildMonthGrid(year, month);

  return (
    <div className="rounded-[12px] border border-[#ece9e3] bg-[#faf9f7] p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="h-7 w-7 rounded-md text-[#5a5650] hover:bg-[#efede8]"
          onClick={() => onMonthChange(addMonths({ year, month }, -1))}
        >
          ‹
        </button>
        <span className="text-[13px] font-medium text-[#1a1814]">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className="h-7 w-7 rounded-md text-[#5a5650] hover:bg-[#efede8]"
          onClick={() => onMonthChange(addMonths({ year, month }, 1))}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_HEADINGS.map((heading, index) => (
          <span key={index} className="text-[11px] font-medium text-[#6d6a65]">
            {heading}
          </span>
        ))}
        {grid.map((cell, index) => {
          if (cell === null) return <span key={index} />;
          const selected = cell === day;
          return (
            <button
              key={index}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect({ year, month, day: cell })}
              className={`h-8 rounded-md text-[13px] transition-colors ${
                selected
                  ? "bg-[#1f8a4c] font-semibold text-white"
                  : "text-[#1a1814] hover:bg-[#efede8]"
              }`}
            >
              {cell}
            </button>
          );
        })}
      </div>
    </div>
  );
}
