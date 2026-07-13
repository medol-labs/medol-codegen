<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.5.11</version>
        <relativePath/>
    </parent>

    <groupId><%= rootPackage %></groupId>
    <artifactId>medol-infra</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>Medol Infra</name>

    <properties>
        <java.version>21</java.version>
        <axon.version>5.1.1</axon.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.axonframework</groupId>
                <artifactId>axon-framework-bom</artifactId>
                <version>${axon.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <dependencies>
        <dependency>
            <groupId>org.axonframework</groupId>
            <artifactId>axon-eventsourcing</artifactId>
        </dependency>
        <dependency>
            <groupId>org.axonframework</groupId>
            <artifactId>axon-messaging</artifactId>
        </dependency>
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </dependency>
    </dependencies>
</project>
