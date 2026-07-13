package <%= rootPackage %>.infra.umadb;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.CompletableFuture;

public final class HttpUmaDbClient implements UmaDbClient {
    private final UmaDbEventStorageProperties properties;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public HttpUmaDbClient(UmaDbEventStorageProperties properties) {
        this(properties, HttpClient.newBuilder()
                .connectTimeout(properties.requestTimeout())
                .build(), new ObjectMapper());
    }

    public HttpUmaDbClient(UmaDbEventStorageProperties properties, HttpClient httpClient, ObjectMapper objectMapper) {
        this.properties = properties;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public CompletableFuture<UmaDbClient.AppendResult> append(UmaDbClient.AppendRequest request) {
        try {
            var httpRequest = HttpRequest.newBuilder(appendUri())
                    .timeout(properties.requestTimeout())
                    .header("Content-Type", "application/json")
                    .header("Authorization", authorizationHeader())
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(request)))
                    .build();
            return httpClient.sendAsync(httpRequest, HttpResponse.BodyHandlers.ofString())
                    .thenApply(this::parseAppendResponse);
        } catch (IOException ex) {
            return CompletableFuture.failedFuture(ex);
        }
    }

    private URI appendUri() {
        return properties.endpoint().resolve(properties.appendPath());
    }

    private String authorizationHeader() {
        return properties.token().isBlank() ? "" : "Bearer " + properties.token();
    }

    private UmaDbClient.AppendResult parseAppendResponse(HttpResponse<String> response) {
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("UmaDB append failed with HTTP " + response.statusCode() + ": " + response.body());
        }
        if (response.body() == null || response.body().isBlank()) {
            return new UmaDbClient.AppendResult(-1, -1);
        }
        try {
            return objectMapper.readValue(response.body(), UmaDbClient.AppendResult.class);
        } catch (IOException ex) {
            throw new IllegalStateException("Unable to parse UmaDB append response", ex);
        }
    }
}
