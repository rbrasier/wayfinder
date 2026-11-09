package io.wayfinder.dss;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.europa.esig.dss.alert.SilentOnStatusAlert;
import eu.europa.esig.dss.diagnostic.CertificateWrapper;
import eu.europa.esig.dss.diagnostic.DiagnosticData;
import eu.europa.esig.dss.diagnostic.SignatureWrapper;
import eu.europa.esig.dss.diagnostic.TimestampWrapper;
import eu.europa.esig.dss.enumerations.DigestAlgorithm;
import eu.europa.esig.dss.enumerations.Indication;
import eu.europa.esig.dss.enumerations.SignatureAlgorithm;
import eu.europa.esig.dss.enumerations.SignatureLevel;
import eu.europa.esig.dss.enumerations.SubIndication;
import eu.europa.esig.dss.model.DSSDocument;
import eu.europa.esig.dss.model.InMemoryDocument;
import eu.europa.esig.dss.model.SignatureValue;
import eu.europa.esig.dss.model.ToBeSigned;
import eu.europa.esig.dss.model.x509.CertificateToken;
import eu.europa.esig.dss.pades.PAdESSignatureParameters;
import eu.europa.esig.dss.pades.SignatureFieldParameters;
import eu.europa.esig.dss.pades.SignatureImageParameters;
import eu.europa.esig.dss.pades.SignatureImageTextParameters;
import eu.europa.esig.dss.pades.signature.PAdESService;
import eu.europa.esig.dss.pdf.pdfbox.PdfBoxNativeObjectFactory;
import eu.europa.esig.dss.service.crl.OnlineCRLSource;
import eu.europa.esig.dss.service.http.commons.CommonsDataLoader;
import eu.europa.esig.dss.service.ocsp.OnlineOCSPSource;
import eu.europa.esig.dss.service.tsp.OnlineTSPSource;
import eu.europa.esig.dss.simplereport.SimpleReport;
import eu.europa.esig.dss.spi.DSSUtils;
import eu.europa.esig.dss.spi.validation.CommonCertificateVerifier;
import eu.europa.esig.dss.spi.x509.CommonTrustedCertificateSource;
import eu.europa.esig.dss.spi.x509.aia.DefaultAIASource;
import eu.europa.esig.dss.validation.CertificateValidator;
import eu.europa.esig.dss.validation.SignedDocumentValidator;
import eu.europa.esig.dss.validation.reports.CertificateReports;
import eu.europa.esig.dss.validation.reports.Reports;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;

/**
 * The three operations the Wayfinder adapter calls. `prepare` and `sign` must
 * receive identical signing parameters — the signing time travels with the
 * request for exactly that reason — or the signature would cover different
 * bytes from the ones the provider signed.
 */
final class Engine {

  private static final Base64.Decoder DECODE = Base64.getDecoder();
  private static final Base64.Encoder ENCODE = Base64.getEncoder();

  private final CommonTrustedCertificateSource trusted;

  Engine(CommonTrustedCertificateSource trusted) {
    this.trusted = trusted;
  }

  // Validation never throws on a problem it finds: every finding becomes part
  // of the report the caller maps to a reason.
  private CommonCertificateVerifier verifier() {
    CommonsDataLoader dataLoader = new CommonsDataLoader();
    CommonCertificateVerifier verifier = new CommonCertificateVerifier();
    verifier.setTrustedCertSources(trusted);
    verifier.setCrlSource(new OnlineCRLSource(dataLoader));
    verifier.setOcspSource(new OnlineOCSPSource(dataLoader));
    verifier.setAIASource(new DefaultAIASource(dataLoader));
    verifier.setCheckRevocationForUntrustedChains(false);
    verifier.setAlertOnMissingRevocationData(new SilentOnStatusAlert());
    verifier.setAlertOnRevokedCertificate(new SilentOnStatusAlert());
    verifier.setAlertOnExpiredCertificate(new SilentOnStatusAlert());
    verifier.setAlertOnInvalidTimestamp(new SilentOnStatusAlert());
    verifier.setAlertOnNoRevocationAfterBestSignatureTime(new SilentOnStatusAlert());
    verifier.setAlertOnUncoveredPOE(new SilentOnStatusAlert());
    return verifier;
  }

  private PAdESService service(String tsaUrl) {
    PAdESService service = new PAdESService(verifier());
    service.setPdfObjFactory(new PdfBoxNativeObjectFactory());
    if (tsaUrl != null) service.setTspSource(new OnlineTSPSource(tsaUrl));
    return service;
  }

  JsonNode prepare(JsonNode request) throws Exception {
    List<CertificateToken> chain = chainOf(request);
    ObjectNode response = Server.JSON.createObjectNode();
    response.set("certificateCheck", checkCertificate(chain.get(0)));

    ToBeSigned toBeSigned = service(null).getDataToSign(documentOf(request), parametersOf(request, chain));
    response.put("dataToSignDigest", ENCODE.encodeToString(DSSUtils.digest(DigestAlgorithm.SHA256, toBeSigned.getBytes())));
    return response;
  }

  JsonNode sign(JsonNode request) throws Exception {
    List<CertificateToken> chain = chainOf(request);
    String tsaUrl = requiredText(request, "tsaUrl");
    SignatureAlgorithm algorithm = SignatureAlgorithm.valueOf(requiredText(request, "signatureAlgorithm"));
    SignatureValue value = new SignatureValue(algorithm, DECODE.decode(requiredText(request, "signatureValue")));

    PAdESService service = service(tsaUrl);
    DSSDocument signed = service.signDocument(documentOf(request), parametersOf(request, chain), value);
    // A later signature on an already-signed PDF can find its certificate's
    // revocation data already present from an earlier revision, and stop at
    // B-T. One more LTA extension adds validation data and an archive
    // timestamp covering every signature, so each one reaches B-LTA.
    if (hasEarlierSignatures(request)) signed = service.extendDocument(signed, extensionParameters());
    ObjectNode response = Server.JSON.createObjectNode();
    response.put("pdf", ENCODE.encodeToString(DSSUtils.toByteArray(signed)));
    return response;
  }

  private boolean hasEarlierSignatures(JsonNode request) throws Server.BadRequest {
    SignedDocumentValidator validator = SignedDocumentValidator.fromDocument(documentOf(request));
    validator.setCertificateVerifier(verifier());
    return !validator.getSignatures().isEmpty();
  }

  private static PAdESSignatureParameters extensionParameters() {
    PAdESSignatureParameters parameters = new PAdESSignatureParameters();
    parameters.setSignatureLevel(SignatureLevel.PAdES_BASELINE_LTA);
    return parameters;
  }

  JsonNode validate(JsonNode request) throws Exception {
    SignedDocumentValidator validator = SignedDocumentValidator.fromDocument(documentOf(request));
    validator.setCertificateVerifier(verifier());
    Reports reports = validator.validateDocument();
    SimpleReport simple = reports.getSimpleReport();
    DiagnosticData diagnostic = reports.getDiagnosticData();

    ArrayNode signatures = Server.JSON.createArrayNode();
    for (String id : simple.getSignatureIdList()) {
      signatures.add(signatureNode(id, simple, diagnostic));
    }
    ObjectNode response = Server.JSON.createObjectNode();
    response.set("signatures", signatures);
    return response;
  }

  private ObjectNode signatureNode(String id, SimpleReport simple, DiagnosticData diagnostic) {
    ObjectNode node = Server.JSON.createObjectNode();
    node.put("id", id);
    node.put("indication", nameOf(simple.getIndication(id)));
    node.put("subIndication", nameOf(simple.getSubIndication(id)));
    node.put("signedBy", simple.getSignedBy(id));
    node.put("signingTime", isoOf(simple.getSigningTime(id)));
    node.put("bestSignatureTime", isoOf(simple.getBestSignatureTime(id)));
    SignatureLevel format = simple.getSignatureFormat(id);
    node.put("level", format == null ? null : format.name());

    SignatureWrapper signature = diagnostic.getSignatureById(id);
    if (signature == null) return node;
    CertificateWrapper certificate = signature.getSigningCertificate();
    if (certificate != null) node.set("certificate", certificateNode(certificate));

    ArrayNode timestamps = Server.JSON.createArrayNode();
    for (TimestampWrapper timestamp : signature.getTimestampList()) {
      timestamps.add(isoOf(timestamp.getProductionTime()));
    }
    node.set("timestampTimes", timestamps);
    return node;
  }

  private ObjectNode certificateNode(CertificateWrapper certificate) {
    ObjectNode node = Server.JSON.createObjectNode();
    node.put("subject", certificate.getCertificateDN());
    node.put("issuer", certificate.getCertificateIssuerDN());
    node.put("serialNumber", certificate.getSerialNumber());
    node.put("notAfter", isoOf(certificate.getNotAfter()));
    if (certificate.getDigestAlgoAndValue() != null) {
      node.put("sha256", HexFormat.of().formatHex(certificate.getDigestAlgoAndValue().getDigestValue()));
    }
    return node;
  }

  // Checked before the signer is asked to authorise anything, so an expired,
  // revoked, untrusted or wrong-purpose certificate is refused with its reason
  // rather than discovered after a signature has been made (ADR-067 §4).
  private ObjectNode checkCertificate(CertificateToken certificate) {
    ObjectNode node = Server.JSON.createObjectNode();
    boolean[] keyUsage = certificate.getCertificate().getKeyUsage();
    boolean signingUsage = keyUsage == null || keyUsage[0] || keyUsage[1];
    node.put("keyUsageAllowsSigning", signingUsage);
    node.put("validNow", certificate.isValidOn(new Date()));

    CertificateValidator validator = CertificateValidator.fromCertificate(certificate);
    validator.setCertificateVerifier(verifier());
    CertificateReports reports = validator.validate();
    String id = reports.getSimpleReport().getCertificateIds().get(0);
    node.put("indication", nameOf(reports.getSimpleReport().getCertificateIndication(id)));
    node.put("subIndication", nameOf(reports.getSimpleReport().getCertificateSubIndication(id)));
    node.put("revoked", reports.getSimpleReport().getCertificateRevocationDate(id) != null);
    return node;
  }

  private PAdESSignatureParameters parametersOf(JsonNode request, List<CertificateToken> chain) throws Server.BadRequest {
    PAdESSignatureParameters parameters = new PAdESSignatureParameters();
    parameters.setSignatureLevel(SignatureLevel.PAdES_BASELINE_LTA);
    parameters.setDigestAlgorithm(DigestAlgorithm.SHA256);
    parameters.setSigningCertificate(chain.get(0));
    parameters.setCertificateChain(chain);
    parameters.bLevel().setSigningDate(Date.from(Instant.parse(requiredText(request, "signingTime"))));
    parameters.setAppName("Wayfinder");
    JsonNode reason = request.get("reason");
    if (reason != null && reason.isTextual() && !reason.asText().isBlank()) parameters.setReason(reason.asText());
    JsonNode appearance = request.get("appearance");
    if (appearance != null && appearance.isObject()) parameters.setImageParameters(imageParametersOf(appearance));
    return parameters;
  }

  private SignatureImageParameters imageParametersOf(JsonNode appearance) {
    SignatureFieldParameters field = new SignatureFieldParameters();
    field.setPage(appearance.path("page").asInt(1));
    field.setOriginX((float) appearance.path("x").asDouble());
    field.setOriginY((float) appearance.path("y").asDouble());
    field.setWidth((float) appearance.path("width").asDouble(180));
    field.setHeight((float) appearance.path("height").asDouble(60));

    SignatureImageParameters image = new SignatureImageParameters();
    image.setFieldParameters(field);
    // Opaque, so the appearance covers the slot marker it is placed over.
    image.setBackgroundColor(java.awt.Color.WHITE);
    String png = appearance.path("imagePng").asText("");
    if (!png.isEmpty()) image.setImage(new InMemoryDocument(DECODE.decode(png)));
    String text = appearance.path("text").asText("");
    if (!text.isEmpty()) {
      SignatureImageTextParameters textParameters = new SignatureImageTextParameters();
      textParameters.setText(text);
      // Under the drawing rather than beside it, so a narrow slot keeps both.
      textParameters.setSignerTextPosition(eu.europa.esig.dss.enumerations.SignerTextPosition.BOTTOM);
      textParameters.setBackgroundColor(java.awt.Color.WHITE);
      image.setTextParameters(textParameters);
    }
    return image;
  }

  private static DSSDocument documentOf(JsonNode request) throws Server.BadRequest {
    return new InMemoryDocument(DECODE.decode(requiredText(request, "pdf")), "document.pdf");
  }

  private static List<CertificateToken> chainOf(JsonNode request) throws Server.BadRequest {
    JsonNode chain = request.get("certificateChain");
    if (chain == null || !chain.isArray() || chain.isEmpty()) {
      throw new Server.BadRequest("certificateChain must list the signing certificate first");
    }
    List<CertificateToken> tokens = new ArrayList<>();
    for (JsonNode entry : chain) tokens.add(DSSUtils.loadCertificate(DECODE.decode(entry.asText())));
    return tokens;
  }

  private static String requiredText(JsonNode request, String field) throws Server.BadRequest {
    JsonNode value = request.get(field);
    if (value == null || !value.isTextual() || value.asText().isBlank()) {
      throw new Server.BadRequest(field + " is required");
    }
    return value.asText();
  }

  private static String nameOf(Indication indication) {
    return indication == null ? null : indication.name();
  }

  private static String nameOf(SubIndication subIndication) {
    return subIndication == null ? null : subIndication.name();
  }

  private static String isoOf(Date date) {
    return date == null ? null : date.toInstant().toString();
  }
}
