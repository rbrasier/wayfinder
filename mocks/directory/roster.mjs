// The one identity universe every local mock shares.
//
// A single deterministic roster of 100 employees across five reporting levels,
// read by the mock HR CSV (/hr), the mock Entra sign-in picker (/entra), the
// mock Microsoft Graph (/graph) and the mock PKI proxy (/pki). Before this
// existed each mock hardcoded its own two or three people, so signing in as
// someone the HR upload had never heard of was the normal case.
//
// Everything here is derived from the literal tables below with no randomness,
// so the CSV checked in beside this file can be pinned byte-for-byte against a
// fresh render and can never silently drift.

// Level 1 sits outside the units: the chief executive owns all of them.
export const BUSINESS_UNITS = ["Operations", "Finance", "Technology", "People", "Commercial"];

const EXECUTIVE_OFFICE = "Executive Office";

// Each unit's executive, and the specialisms its directors own. One director per
// specialism, two managers per director, then individual contributors dealt
// round-robin across every manager.
const UNITS = [
  {
    name: "Operations",
    executiveTitle: "Chief Operating Officer",
    specialisms: ["Service Delivery", "Facilities", "Procurement"],
  },
  {
    name: "Finance",
    executiveTitle: "Chief Financial Officer",
    specialisms: ["Financial Control", "Treasury"],
  },
  {
    name: "Technology",
    executiveTitle: "Chief Technology Officer",
    specialisms: ["Platform Engineering", "Data & Analytics", "Information Security"],
  },
  {
    name: "People",
    executiveTitle: "Chief People Officer",
    specialisms: ["Talent & Recruitment", "Learning & Development"],
  },
  {
    name: "Commercial",
    executiveTitle: "Chief Commercial Officer",
    specialisms: ["Sales", "Partnerships"],
  },
];

const MANAGERS_PER_DIRECTOR = 2;
const INDIVIDUAL_CONTRIBUTOR_COUNT = 58;

// Rank and band move together, so an individual contributor's grade always
// agrees with their title.
const CONTRIBUTOR_RANKS = [
  { title: "Senior Specialist", band: "P3" },
  { title: "Specialist", band: "P2" },
  { title: "Associate", band: "P1" },
];

const LOCATIONS = ["London", "Manchester", "Edinburgh", "Belfast", "Bristol"];

// Position in this list is what assigns a person their place in the hierarchy:
// 0 is the chief executive, 1–5 the executives (one per unit, in UNITS order),
// 6–17 the directors, 18–41 the managers, 42–99 the individual contributors.
// Three names are pinned deliberately — Grace Hopper as the Technology
// executive, Ada Lovelace as a Technology director, and the seeded
// admin@example.com as a contributor — so the identities the mocks shipped with
// before this roster existed still resolve.
const NAMES = [
  "Rosalind Whitfield",
  "Marcus Adeyemi",
  "Priya Raghunathan",
  "Grace Hopper",
  "Tomas Lindqvist",
  "Nadia Belkacem",
  "Oliver Brennan",
  "Camille Fontaine",
  "Idris Oyelaran",
  "Hannah Kowalski",
  "Rafael Duarte",
  "Ada Lovelace",
  "Sunil Varadarajan",
  "Meera Chandrasekhar",
  "Joachim Bauer",
  "Fiona Macleod",
  "Dmitri Sokolov",
  "Yasmin Haddad",
  "Peter Nwachukwu",
  "Clara Bergstrom",
  "Anwar Rashid",
  "Lucia Ferrari",
  "Bernard Osei",
  "Ingrid Halvorsen",
  "Samuel Okonkwo",
  "Theresa Mbeki",
  "Vikram Sethi",
  "Eleanor Prentice",
  "Kwame Boateng",
  "Sofia Marchetti",
  "Henrik Nilsson",
  "Amara Diallo",
  "Julian Ashworth",
  "Beatriz Almeida",
  "Nikolai Petrov",
  "Rebecca Sandoval",
  "Farid Nazari",
  "Maeve Donnelly",
  "Chidi Nwosu",
  "Astrid Solberg",
  "Colin Fairweather",
  "Leila Mansouri",
  "Wayfinder Admin",
  "Gabriel Santos",
  "Ruth Ademola",
  "Stefan Kovacs",
  "Naomi Fitzgerald",
  "Ravi Balasubramanian",
  "Freya Lindgren",
  "Emeka Chukwuma",
  "Valentina Rossi",
  "Douglas Kinnear",
  "Zainab Suleiman",
  "Patrick Ohagan",
  "Mireille Lefevre",
  "Toby Ellsworth",
  "Ananya Deshmukh",
  "Lars Ostergaard",
  "Grace Abiodun",
  "Matthias Reinhardt",
  "Simone Beaumont",
  "Hassan Karimi",
  "Rowan Trelawney",
  "Delphine Moreau",
  "Obi Anyanwu",
  "Katarina Novak",
  "Edward Ashcombe",
  "Sanjana Iyer",
  "Bjorn Halvarsson",
  "Rosa Villanueva",
  "Nathaniel Speight",
  "Yuki Nakamura",
  "Aisha Kamara",
  "Gregor Mackenzie",
  "Elodie Chastain",
  "Tunde Falade",
  "Miriam Rosenthal",
  "Callum Rutherford",
  "Isabel Quintero",
  "Adebayo Ogunleye",
  "Hedda Kristiansen",
  "Vincent Lacroix",
  "Shreya Malhotra",
  "Duncan Braithwaite",
  "Noor Al-Amin",
  "Felipe Cardenas",
  "Bronwen Llewellyn",
  "Kenji Watanabe",
  "Constance Fairbairn",
  "Mateusz Zielinski",
  "Adaeze Okafor",
  "Sebastian Thorne",
  "Leonor Esteves",
  "Hamza Chaudhry",
  "Wilhelmina Krause",
  "Arjun Nair",
  "Cordelia Ravenscroft",
  "Olamide Adesina",
  "Petra Svobodova",
  "Malcolm Ainsworth",
];

// The three identities the mocks used before this roster existed. Keeping them
// on their original addresses means bookmarks, docs and muscle memory still work.
const EMAIL_OVERRIDES = {
  "Grace Hopper": "grace@example.com",
  "Ada Lovelace": "ada@example.com",
  "Wayfinder Admin": "admin@example.com",
};

const emailFor = (name) => {
  const override = EMAIL_OVERRIDES[name];
  if (override) return override;
  const [first, ...rest] = name.split(" ");
  const local = `${first}.${rest.join("")}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z.]/g, "");
  return `${local}@example.com`;
};

// Deterministic spread rather than real dates — varied enough to sort and filter
// on, stable enough to diff.
const startDateFor = (index) => {
  const year = 2015 + (index % 10);
  const month = String((index % 12) + 1).padStart(2, "0");
  const day = String((index % 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const employeeAt = (index, { level, jobTitle, band, businessUnit, managerEmail }) => {
  const name = NAMES[index];
  return {
    employeeId: `E${String(index + 1).padStart(4, "0")}`,
    name,
    email: emailFor(name),
    managerEmail,
    jobTitle,
    band,
    businessUnit,
    level,
    location: LOCATIONS[index % LOCATIONS.length],
    startDate: startDateFor(index),
  };
};

export const buildRoster = () => {
  const chiefExecutive = employeeAt(0, {
    level: 1,
    jobTitle: "Chief Executive Officer",
    band: "EXEC-1",
    businessUnit: EXECUTIVE_OFFICE,
    managerEmail: null,
  });

  const executives = UNITS.map((unit, unitIndex) =>
    employeeAt(1 + unitIndex, {
      level: 2,
      jobTitle: unit.executiveTitle,
      band: "EXEC-2",
      businessUnit: unit.name,
      managerEmail: chiefExecutive.email,
    }),
  );

  const directors = [];
  UNITS.forEach((unit, unitIndex) => {
    for (const specialism of unit.specialisms) {
      directors.push({
        specialism,
        employee: employeeAt(1 + UNITS.length + directors.length, {
          level: 3,
          jobTitle: `Director of ${specialism}`,
          band: "D",
          businessUnit: unit.name,
          managerEmail: executives[unitIndex].email,
        }),
      });
    }
  });

  const managers = [];
  for (const director of directors) {
    for (let seat = 0; seat < MANAGERS_PER_DIRECTOR; seat += 1) {
      managers.push({
        specialism: director.specialism,
        employee: employeeAt(1 + UNITS.length + directors.length + managers.length, {
          level: 4,
          // Two managers share a title under one director, which is what a real
          // org looks like and what makes the dynamic position lookup return
          // several candidates for the operator to choose between.
          jobTitle: `${director.specialism} Manager`,
          band: "M",
          businessUnit: director.employee.businessUnit,
          managerEmail: director.employee.email,
        }),
      });
    }
  }

  const contributorsStart = 1 + UNITS.length + directors.length + managers.length;
  const contributors = [];
  for (let seat = 0; seat < INDIVIDUAL_CONTRIBUTOR_COUNT; seat += 1) {
    const manager = managers[seat % managers.length];
    const rank = CONTRIBUTOR_RANKS[seat % CONTRIBUTOR_RANKS.length];
    contributors.push(
      employeeAt(contributorsStart + seat, {
        level: 5,
        jobTitle: `${manager.specialism} ${rank.title}`,
        band: rank.band,
        businessUnit: manager.employee.businessUnit,
        managerEmail: manager.employee.email,
      }),
    );
  }

  return [
    chiefExecutive,
    ...executives,
    ...directors.map((director) => director.employee),
    ...managers.map((manager) => manager.employee),
    ...contributors,
  ];
};

export const roster = buildRoster();

const byEmail = new Map(roster.map((employee) => [employee.email, employee]));

export const findEmployeeByEmail = (email) =>
  typeof email === "string" ? byEmail.get(email.trim().toLowerCase()) : undefined;

export const managerOf = (email) => {
  const employee = findEmployeeByEmail(email);
  if (!employee || employee.managerEmail === null) return undefined;
  return findEmployeeByEmail(employee.managerEmail);
};

export const searchEmployees = (query, limit = roster.length) => {
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return [];
  return roster
    .filter(
      (employee) =>
        employee.name.toLowerCase().includes(needle) ||
        employee.email.includes(needle) ||
        employee.jobTitle.toLowerCase().includes(needle),
    )
    .slice(0, limit);
};

// One identity per level plus the seeded admin, offered as one-click buttons at
// the top of the sign-in and certificate pickers so the common cases stay one
// click away with 100 people in the list.
export const FEATURED_EMAILS = [
  "rosalind.whitfield@example.com",
  "grace@example.com",
  "ada@example.com",
  "peter.nwachukwu@example.com",
  "gabriel.santos@example.com",
  "admin@example.com",
];

export const featuredEmployees = () =>
  FEATURED_EMAILS.map((email) => findEmployeeByEmail(email)).filter(Boolean);
