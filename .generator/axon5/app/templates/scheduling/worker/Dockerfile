FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src src
RUN mvn -B -DskipTests package
FROM eclipse-temurin:21-jre
WORKDIR /app
ENV TZ=UTC
COPY --from=build /build/target/snail-job-worker-1.0.0.jar worker.jar
ENTRYPOINT ["java","-jar","worker.jar"]
