package <%= rootPackage %>.infra.umadb;

import java.time.Duration;

public final class UmaDbEventStorageProperties {
    private final String target;
    private final boolean plaintext;
    private final String apiKey;
    private final int batchSize;
    private final Duration requestTimeout;

    public UmaDbEventStorageProperties(
            String target,
            boolean plaintext,
            String apiKey,
            int batchSize,
            Duration requestTimeout
    ) {
        this.target = requireText(target, "target");
        this.plaintext = plaintext;
        this.apiKey = apiKey == null ? "" : apiKey;
        this.batchSize = batchSize <= 0 ? 256 : batchSize;
        this.requestTimeout = requestTimeout == null ? Duration.ofSeconds(10) : requestTimeout;
    }

    public static UmaDbEventStorageProperties of(
            String target,
            boolean plaintext,
            String apiKey,
            int batchSize,
            Duration requestTimeout
    ) {
        return new UmaDbEventStorageProperties(
                target,
                plaintext,
                apiKey,
                batchSize,
                requestTimeout
        );
    }

    public String target() {
        return target;
    }

    public boolean plaintext() {
        return plaintext;
    }

    public String apiKey() {
        return apiKey;
    }

    public int batchSize() {
        return batchSize;
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
