import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { createTestAuthority } from "./test-ca.mjs";
import { createTimestampResponse, SHA256_OID } from "./tsa.mjs";

const authority = await createTestAuthority("http://localhost:4001");

// pkijs re-encodes eContent as a constructed (BER) OCTET STRING, which CMS
// allows and BouncyCastle-based validators such as DSS read; join its chunks.
const encapsulatedBytes = (eContent) =>
  eContent.idBlock.isConstructed
    ? Buffer.concat(eContent.valueBlock.value.map((chunk) => Buffer.from(chunk.valueBlock.valueHexView)))
    : Buffer.from(eContent.valueBlock.valueHexView);

const requestFor = (digest) =>
  Buffer.from(
    new pkijs.TimeStampReq({
      version: 1,
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
        hashedMessage: new asn1js.OctetString({ valueHex: digest }),
      }),
      nonce: new asn1js.Integer({ value: 42 }),
      certReq: true,
    })
      .toSchema()
      .toBER(false),
  );

describe("the mock timestamp authority", () => {
  it("grants a token over the requested digest that verifies against its own certificate", async () => {
    const digest = createHash("sha256").update("document").digest();

    const reply = await createTimestampResponse(authority.tsa, requestFor(digest));

    const response = pkijs.TimeStampResp.fromBER(reply);
    expect(response.status.status).toBe(pkijs.PKIStatus.granted);
    const signedData = new pkijs.SignedData({ schema: response.timeStampToken.content });
    expect(signedData.signerInfos).toHaveLength(1);
    const tstInfo = pkijs.TSTInfo.fromBER(encapsulatedBytes(signedData.encapContentInfo.eContent));
    expect(Buffer.from(tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView).equals(digest)).toBe(true);
    expect(tstInfo.nonce.valueBlock.valueDec).toBe(42);
  });

  it("rejects a request it cannot parse", async () => {
    const reply = await createTimestampResponse(authority.tsa, Buffer.from("not der"));

    expect(pkijs.TimeStampResp.fromBER(reply).status.status).toBe(pkijs.PKIStatus.rejection);
  });
});
