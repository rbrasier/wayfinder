// Mock RFC 3161 timestamp authority, mounted at /tsa on the shared mocks server.
//
//   POST /tsa   application/timestamp-query → application/timestamp-reply
//
// Issues real timestamp tokens signed by the throwaway test CA (test-ca.mjs),
// with the ESS signing-certificate-v2 attribute validators require. Point
// Settings → PDF signatures → Timestamp authority URL at http://localhost:4001/tsa.

import { createHash, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto }));

const BASE_PATH = "/tsa";
const POLICY_OID = "1.3.6.1.4.1.57264.1.1";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_CERTIFICATE_V2 = "1.2.840.113549.1.9.16.2.47";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

let serialCounter = 1;

const bufferOf = (arrayBuffer) => Buffer.from(arrayBuffer);

// SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 } where
// ESSCertIDv2 defaults to SHA-256 and carries just the certificate hash.
const signingCertificateV2 = (certificateDer) =>
  new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [new asn1js.OctetString({ valueHex: createHash("sha256").update(certificateDer).digest() })],
          }),
        ],
      }),
    ],
  });

const rejection = (status) =>
  bufferOf(new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status }) }).toSchema().toBER(false));

export const createTimestampResponse = async (tsa, requestDer, now = new Date()) => {
  let request;
  try {
    request = pkijs.TimeStampReq.fromBER(requestDer);
  } catch {
    return rejection(pkijs.PKIStatus.rejection);
  }

  const tstInfo = new pkijs.TSTInfo({
    version: 1,
    policy: POLICY_OID,
    messageImprint: request.messageImprint,
    serialNumber: new asn1js.Integer({ value: serialCounter++ }),
    genTime: now,
    ...(request.nonce ? { nonce: request.nonce } : {}),
  });
  const tstInfoDer = tstInfo.toSchema().toBER(false);

  const certificateDer = Buffer.from(tsa.certificate.rawData);
  const certificate = pkijs.Certificate.fromBER(certificateDer);
  const signedData = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: pkijs.id_eContentType_TSTInfo,
      eContent: new asn1js.OctetString({ valueHex: tstInfoDer }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: OID_CONTENT_TYPE, values: [new asn1js.ObjectIdentifier({ value: pkijs.id_eContentType_TSTInfo })] }),
            new pkijs.Attribute({
              type: OID_MESSAGE_DIGEST,
              values: [new asn1js.OctetString({ valueHex: createHash("sha256").update(Buffer.from(tstInfoDer)).digest() })],
            }),
            new pkijs.Attribute({ type: OID_SIGNING_CERTIFICATE_V2, values: [signingCertificateV2(certificateDer)] }),
          ],
        }),
      }),
    ],
    certificates: [certificate, pkijs.Certificate.fromBER(Buffer.from(tsa.rootCertificate.rawData))],
  });
  await signedData.sign(tsa.keys.privateKey, 0, "SHA-256");

  const response = new pkijs.TimeStampResp({
    status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
    timeStampToken: new pkijs.ContentInfo({ contentType: pkijs.ContentInfo.SIGNED_DATA, content: signedData.toSchema(true) }),
  });
  return bufferOf(response.toSchema().toBER(false));
};

export const SHA256_OID = OID_SHA256;

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

export const createTsaMock = (authorityPromise) => ({
  path: BASE_PATH,
  label: "RFC 3161 timestamp authority (mock)",
  handle: async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain", Allow: "POST" });
      res.end("method not allowed");
      return;
    }
    const authority = await authorityPromise;
    const reply = await createTimestampResponse(authority.tsa, await readBody(req));
    res.writeHead(200, { "Content-Type": "application/timestamp-reply" });
    res.end(reply);
  },
});
