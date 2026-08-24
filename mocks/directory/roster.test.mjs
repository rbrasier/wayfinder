import { describe, expect, it } from "vitest";
import {
  BUSINESS_UNITS,
  FEATURED_EMAILS,
  buildRoster,
  featuredEmployees,
  findEmployeeByEmail,
  managerOf,
  roster,
  searchEmployees,
} from "./roster.mjs";

const LEVEL_COUNTS = { 1: 1, 2: 5, 3: 12, 4: 24, 5: 58 };

describe("roster shape", () => {
  it("holds exactly 100 employees", () => {
    expect(roster.length).toBe(100);
  });

  it("gives every employee a unique lowercase email", () => {
    const emails = roster.map((employee) => employee.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toBe(email.toLowerCase());
  });

  it("gives every employee a unique employee id", () => {
    const ids = roster.map((employee) => employee.employeeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fills every documented level with the documented count", () => {
    for (const [level, expected] of Object.entries(LEVEL_COUNTS)) {
      const atLevel = roster.filter((employee) => employee.level === Number(level));
      expect(atLevel.length, `level ${level}`).toBe(expected);
    }
  });
});

describe("reporting structure", () => {
  it("has exactly one employee with no manager", () => {
    const roots = roster.filter((employee) => employee.managerEmail === null);
    expect(roots.length).toBe(1);
    expect(roots[0].level).toBe(1);
  });

  it("resolves every manager email to another employee", () => {
    for (const employee of roster) {
      if (employee.managerEmail === null) continue;
      const manager = findEmployeeByEmail(employee.managerEmail);
      expect(manager, `manager of ${employee.email}`).toBeDefined();
      expect(manager.email).not.toBe(employee.email);
    }
  });

  it("puts every employee exactly one level below their manager", () => {
    for (const employee of roster) {
      if (employee.managerEmail === null) continue;
      expect(managerOf(employee.email).level).toBe(employee.level - 1);
    }
  });

  it("reaches the chief executive from every employee", () => {
    for (const employee of roster) {
      let current = employee;
      let hops = 0;
      while (current.managerEmail !== null) {
        current = managerOf(current.email);
        hops += 1;
        expect(hops).toBeLessThan(roster.length);
      }
      expect(current.level).toBe(1);
    }
  });

  it("keeps each business unit a whole subtree below one executive", () => {
    for (const employee of roster) {
      if (employee.level === 1) continue;
      expect(BUSINESS_UNITS).toContain(employee.businessUnit);
      if (employee.level === 2) continue;
      expect(managerOf(employee.email).businessUnit).toBe(employee.businessUnit);
    }
  });

  it("gives every business unit exactly one executive", () => {
    for (const unit of BUSINESS_UNITS) {
      const executives = roster.filter(
        (employee) => employee.level === 2 && employee.businessUnit === unit,
      );
      expect(executives.length, unit).toBe(1);
    }
  });
});

describe("determinism", () => {
  it("builds the same roster on every call", () => {
    expect(buildRoster()).toEqual(buildRoster());
  });

  it("exports the same roster the builder produces", () => {
    expect(roster).toEqual(buildRoster());
  });
});

describe("lookup helpers", () => {
  it("finds an employee by email regardless of case", () => {
    const employee = roster[42];
    expect(findEmployeeByEmail(employee.email.toUpperCase()).email).toBe(employee.email);
  });

  it("returns undefined for an unknown email", () => {
    expect(findEmployeeByEmail("nobody@example.com")).toBeUndefined();
  });

  it("returns undefined asking for the chief executive's manager", () => {
    const chiefExecutive = roster.find((employee) => employee.level === 1);
    expect(managerOf(chiefExecutive.email)).toBeUndefined();
  });

  it("matches on name fragment and on email fragment", () => {
    const employee = roster[7];
    const surname = employee.name.split(" ").at(-1);
    expect(searchEmployees(surname).map((match) => match.email)).toContain(employee.email);
    expect(searchEmployees(employee.email.split("@")[0]).map((match) => match.email)).toContain(
      employee.email,
    );
  });

  it("matches case-insensitively and returns nothing for a blank query", () => {
    const employee = roster[3];
    expect(searchEmployees(employee.name.toUpperCase()).length).toBeGreaterThan(0);
    expect(searchEmployees("   ")).toEqual([]);
  });
});

describe("featured identities", () => {
  it("offers one identity per documented level plus the seeded admin", () => {
    const featured = featuredEmployees();
    expect(featured.map((employee) => employee.email)).toEqual(FEATURED_EMAILS);
    expect(featured.some((employee) => employee.email === "admin@example.com")).toBe(true);
    const levels = featured
      .filter((employee) => employee.email !== "admin@example.com")
      .map((employee) => employee.level);
    expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("draws every featured identity from the roster", () => {
    for (const employee of featuredEmployees()) {
      expect(findEmployeeByEmail(employee.email)).toBeDefined();
    }
  });
});
