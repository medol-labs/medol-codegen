package <%= rootPackage %>.infra.umadb;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

public final class UmaDbEventStorageProperties {
    private final URI endpoint;
    private final String database;
    private final String eventCollection;
    private final String tagCollection;
    private final String tokenCollection;
    private final String appendPath;
    private final String token;
    private final Duration requestTimeout;

    public UmaDbEventStorageProperties(
            URI endpoint,
            String database,
            String eventCollection,
            String tagCollection,
            String tokenCollection,
            String appendPath,
            String token,
            Duration requestTimeout
    ) {
        this.endpoint = Objects.requireNonNull(endpoint, "endpoint");
        this.database = requireText(database, "database");
        this.eventCollection = requireText(eventCollection, "eventCollection");
        this.tagCollection = requireText(tagCollection, "tagCollection");
        this.tokenCollection = requireText(tokenCollection, "tokenCollection");
        this.appendPath = requireText(appendPath, "appendPath");
        this.token = token == null ? "" : token;
        this.requestTimeout = requestTimeout == null ? Duration.ofSeconds(10) : requestTimeout;
    }

    public static UmaDbEventStorageProperties of(
            String endpoint,
            String database,
            String eventCollection,
            String tagCollection,
            String tokenCollection,
            String appendPath,
            String token,
            Duration requestTimeout
    ) {
        return new UmaDbEventStorageProperties(
                URI.create(requireText(endpoint, "endpoint")),
                database,
                eventCollection,
                tagCollection,
                tokenCollection,
                appendPath,
                token,
                requestTimeout
        );
    }

    public URI endpoint() {
        return endpoint;
    }

    public String database() {
        return database;
    }

    public String eventCollection() {
        return eventCollection;
    }

    public String tagCollection() {
        return tagCollection;
    }

    public String tokenCollection() {
        return tokenCollection;
    }

    public String appendPath() {
        return appendPath;
    }

    public String token() {
        return token;
    }

    public Duration requestTimeout() {
        return requestTimeout;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
