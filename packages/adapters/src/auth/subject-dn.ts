// Parsing for the subject DN a TLS-terminating reverse proxy forwards in
// `x-ssl-client-subject-dn`.
//
// Two formats reach us in practice. nginx has emitted RFC 2253 / RFC 4514 since
// 1.11.6 — comma separated, most specific first, with specials backslash-escaped
// — and still offers the older OpenSSL "oneline" form (`/C=GB/O=…/CN=…`) as
// `$ssl_client_s_dn_legacy`, which is also what Apache's `SSL_CLIENT_S_DN` sends.
//
// The escaping is the whole reason this file exists. A `Surname, Given` common
// name is a routine CA issuance convention and encodes as `CN=Surname\, Given`,
// which a `/CN=([^,]+)/` match truncates at the escaped comma.

export interface RelativeDistinguishedName {
  readonly type: string;
  readonly value: string;
}

const EMAIL_TYPES = new Set(["emailaddress", "e", "mail", "1.2.840.113549.1.9.1"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// RFC 4514 §3: a backslash escapes one special character, or introduces a
// two-digit hex byte.
const unescapeValue = (raw: string): string => {
  let result = "";
  for (let position = 0; position < raw.length; position += 1) {
    if (raw[position] !== "\\") {
      result += raw[position];
      continue;
    }
    const next = raw.slice(position + 1, position + 3);
    if (/^[0-9a-fA-F]{2}$/.test(next)) {
      result += String.fromCharCode(Number.parseInt(next, 16));
      position += 2;
      continue;
    }
    result += raw[position + 1] ?? "";
    position += 1;
  }
  return result;
};

// Splits on unescaped separators only, so an escaped comma stays inside its value.
const splitUnescaped = (input: string, separators: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (separators.includes(character)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
};

const toRdn = (part: string): RelativeDistinguishedName | null => {
  const separator = part.indexOf("=");
  if (separator <= 0) return null;
  const type = part.slice(0, separator).trim();
  if (!type) return null;
  return { type, value: unescapeValue(part.slice(separator + 1)).trim() };
};

// The oneline form uses "/" between attributes, which is also a legal character
// inside an RFC 2253 value — so the shape is decided by the leading slash, not by
// looking for one anywhere.
const isOnelineFormat = (dn: string): boolean => dn.startsWith("/") && dn.includes("=");

export const parseSubjectDn = (dn: string | null | undefined): RelativeDistinguishedName[] => {
  if (!dn) return [];
  const trimmed = dn.trim();
  if (!trimmed) return [];

  const parts = isOnelineFormat(trimmed)
    ? splitUnescaped(trimmed.slice(1), "/")
    : // "+" joins the attributes of one multi-valued RDN; each is still an
      // attribute in its own right for our purposes.
      splitUnescaped(trimmed, ",+");

  return parts
    .map((part) => toRdn(part.trim()))
    .filter((rdn): rdn is RelativeDistinguishedName => rdn !== null);
};

const firstValueOf = (
  dn: string | null | undefined,
  matches: (type: string) => boolean,
): string | null => {
  const found = parseSubjectDn(dn).find((rdn) => matches(rdn.type.toLowerCase()));
  return found && found.value.length > 0 ? found.value : null;
};

export const commonNameFrom = (dn: string | null | undefined): string | null =>
  firstValueOf(dn, (type) => type === "cn");

// An address carried as a subject attribute rather than a SAN. Validated here
// because the attribute is free text and only an address is usable as an
// account key.
export const emailAddressFrom = (dn: string | null | undefined): string | null => {
  const value = firstValueOf(dn, (type) => EMAIL_TYPES.has(type));
  return value && EMAIL_PATTERN.test(value) ? value : null;
};
