package io.wayfinder.dss;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.stream.Stream;
import eu.europa.esig.dss.model.x509.CertificateToken;
import eu.europa.esig.dss.spi.DSSUtils;
import eu.europa.esig.dss.spi.x509.CommonTrustedCertificateSource;

/**
 * The Wayfinder signature engine sidecar (ADR-067 §4): JSON over HTTP around
 * the EU DSS library. It prepares the bytes a remote signing provider signs,
 * incorporates the returned signature as a PAdES revision extended to B-LTA,
 * and validates every signature in a PDF. It never holds a private key and
 * never sees signing credentials.
 *
 * Trust anchors are deployment configuration (ADR-067 §5): PEM or DER files
 * in TRUST_ANCHORS_DIR. Nothing reachable over HTTP can add one.
 */
public final class Server {

  static final ObjectMapper JSON = new ObjectMapper();

  private Server() {}

  public static void main(String[] args) throws Exception {
    int port = Integer.parseInt(env("PORT", "8080"));
    CommonTrustedCertificateSource trusted = loadTrustAnchors();
    Engine engine = new Engine(trusted);

    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.setExecutor(Executors.newFixedThreadPool(8));
    server.createContext("/health", exchange -> respond(exchange, 200, healthBody(trusted)));
    server.createContext("/prepare", exchange -> handle(exchange, engine::prepare));
    server.createContext("/sign", exchange -> handle(exchange, engine::sign));
    server.createContext("/validate", exchange -> handle(exchange, engine::validate));
    server.start();
    System.out.printf("[dss] listening on :%d with %d trust anchor(s)%n", port, trusted.getNumberOfCertificates());
  }

  interface Operation {
    JsonNode apply(JsonNode request) throws Exception;
  }

  private static void handle(HttpExchange exchange, Operation operation) throws IOException {
    if (!"POST".equals(exchange.getRequestMethod())) {
      respond(exchange, 405, error("method not allowed"));
      return;
    }
    try (InputStream body = exchange.getRequestBody()) {
      JsonNode request = JSON.readTree(body);
      respond(exchange, 200, operation.apply(request));
    } catch (BadRequest badRequest) {
      respond(exchange, 400, error(badRequest.getMessage()));
    } catch (Throwable failure) {
      // Errors too: an uncaught one would leave the caller waiting on a request
      // that never answers, which the adapter could only report as a timeout.
      failure.printStackTrace();
      respond(exchange, 500, error(failure.getClass().getSimpleName() + ": " + failure.getMessage()));
    }
  }

  static final class BadRequest extends Exception {
    BadRequest(String message) {
      super(message);
    }
  }

  private static ObjectNode error(String message) {
    ObjectNode node = JSON.createObjectNode();
    node.put("error", message);
    return node;
  }

  private static ObjectNode healthBody(CommonTrustedCertificateSource trusted) {
    ObjectNode node = JSON.createObjectNode();
    node.put("status", "up");
    node.put("trustAnchors", trusted.getNumberOfCertificates());
    return node;
  }

  private static void respond(HttpExchange exchange, int status, JsonNode body) throws IOException {
    byte[] bytes = JSON.writeValueAsBytes(body);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }

  static String env(String name, String fallback) {
    String value = System.getenv(name);
    return value == null || value.isBlank() ? fallback : value;
  }

  private static CommonTrustedCertificateSource loadTrustAnchors() throws Exception {
    CommonTrustedCertificateSource trusted = new CommonTrustedCertificateSource();
    Path directory = Path.of(env("TRUST_ANCHORS_DIR", "/trust"));
    if (Files.isDirectory(directory)) {
      try (Stream<Path> files = Files.list(directory)) {
        for (Path file : files.filter(Files::isRegularFile).toList()) {
          trusted.addCertificate(DSSUtils.loadCertificate(Files.readAllBytes(file)));
        }
      }
    }
    loadMockCertificateAuthority(trusted);
    return trusted;
  }

  // The mocks server's throwaway CA, for development and the integration job
  // only. Refused outright in a production deployment, so a forgotten flag can
  // never make a test certificate count as a real signature (ADR-067 §7).
  private static void loadMockCertificateAuthority(CommonTrustedCertificateSource trusted) throws Exception {
    String mockAuthorityUrl = System.getenv("SIGNING_TRUST_MOCK_CA");
    if (mockAuthorityUrl == null || mockAuthorityUrl.isBlank()) return;
    if (!"development".equals(env("DSS_ENVIRONMENT", "production"))) {
      throw new IllegalStateException(
          "SIGNING_TRUST_MOCK_CA is set but DSS_ENVIRONMENT is not 'development'. Refusing to trust a test CA.");
    }
    HttpResponse<byte[]> response = HttpClient.newHttpClient()
        .send(HttpRequest.newBuilder(URI.create(mockAuthorityUrl)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
    if (response.statusCode() != 200) {
      throw new IllegalStateException("Could not fetch the mock CA from " + mockAuthorityUrl);
    }
    CertificateToken certificate = DSSUtils.loadCertificate(response.body());
    trusted.addCertificate(certificate);
    System.out.println("[dss] DEVELOPMENT ONLY: trusting mock CA " + certificate.getSubject().getRFC2253());
  }

  static String utf8(byte[] bytes) {
    return new String(bytes, StandardCharsets.UTF_8);
  }
}
