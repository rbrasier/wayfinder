// The address checks stay internal: lookups/ exports its own isBlockedAddress
// for lookup sources, and the barrel cannot carry two of the same name.
export { FetchOutboundHttpClient } from "./fetch-outbound-http-client";
