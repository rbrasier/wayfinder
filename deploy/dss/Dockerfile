# The Wayfinder signature engine sidecar (ADR-067 §4): EU DSS behind a small
# JSON API. Built and published with the application image, version-pinned to
# it. Run only when an install signs with digital certificates (the compose
# `signing` profile).

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21.0.8_9-jre-noble@sha256:20e7f7288e1c18eebe8f06a442c9f7183342d9b022d3b9a9677cae2b558ddddd
RUN useradd --system --uid 10001 dss && mkdir /trust && chown dss /trust
COPY --from=build /build/target/wayfinder-dss.jar /app/wayfinder-dss.jar
USER dss
# Production unless the deployment says otherwise: the mock CA can only ever be
# trusted when DSS_ENVIRONMENT is explicitly "development".
ENV DSS_ENVIRONMENT=production \
    TRUST_ANCHORS_DIR=/trust \
    PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD ["sh", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080"]
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/wayfinder-dss.jar"]
