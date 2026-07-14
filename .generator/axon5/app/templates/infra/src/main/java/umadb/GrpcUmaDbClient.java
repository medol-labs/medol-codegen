package <%= rootPackage %>.infra.umadb;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.protobuf.ByteString;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import umadb.v1.DCBGrpc;
import umadb.v1.Umadb;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

public final class GrpcUmaDbClient implements UmaDbClient, AutoCloseable {
    private static final Metadata.Key<String> AUTHORIZATION =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);

    private final ManagedChannel channel;
    private final DCBGrpc.DCBFutureStub stub;
    private final ObjectMapper objectMapper;

    public GrpcUmaDbClient(UmaDbEventStorageProperties properties) {
        this(properties, new ObjectMapper());
    }

    public GrpcUmaDbClient(UmaDbEventStorageProperties properties, ObjectMapper objectMapper) {
        var channelBuilder = ManagedChannelBuilder.forTarget(properties.target());
        if (properties.plaintext()) {
            channelBuilder.usePlaintext();
        }
        this.channel = channelBuilder.build();
        var futureStub = DCBGrpc.newFutureStub(channel)
                .withDeadlineAfter(properties.requestTimeout().toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
        if (!properties.apiKey().isBlank()) {
            var headers = new Metadata();
            headers.put(AUTHORIZATION, "Bearer " + properties.apiKey());
            futureStub = futureStub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
        }
        this.stub = futureStub;
        this.objectMapper = objectMapper;
    }

    @Override
    public CompletableFuture<UmaDbClient.AppendResult> append(UmaDbClient.AppendRequest request) {
        var builder = Umadb.AppendRequest.newBuilder();
        for (StoredEvent event : request.events()) {
            builder.addEvents(toUmaDbEvent(event));
        }
        return toCompletableFuture(stub.append(builder.build()))
                .thenApply(response -> new UmaDbClient.AppendResult(response.getPosition()));
    }

    @Override
    public void close() {
        channel.shutdown();
    }

    private Umadb.Event toUmaDbEvent(StoredEvent event) {
        var builder = Umadb.Event.newBuilder()
                .setEventType(event.eventType())
                .setUuid(event.eventIdentifier())
                .setData(ByteString.copyFrom(serializePayload(event.payload())));

        for (StoredEventTag tag : event.tags()) {
            builder.addTags(tag.key() + "=" + tag.value());
        }
        builder.addMetadata(metadata("axon_timestamp", event.timestamp().toString()));
        for (Map.Entry<String, Object> entry : event.metadata().entrySet()) {
            builder.addMetadata(metadata(entry.getKey(), String.valueOf(entry.getValue())));
        }
        return builder.build();
    }

    private byte[] serializePayload(Object payload) {
        try {
            return objectMapper.writeValueAsBytes(payload);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Unable to serialize Axon event payload for UmaDB", ex);
        }
    }

    private static Umadb.MetadataEntry metadata(String key, String value) {
        return Umadb.MetadataEntry.newBuilder()
                .setKey(key)
                .setValue(value)
                .build();
    }

    private static <T> CompletableFuture<T> toCompletableFuture(ListenableFuture<T> listenableFuture) {
        var completableFuture = new CompletableFuture<T>();
        listenableFuture.addListener(() -> {
            try {
                completableFuture.complete(listenableFuture.get());
            } catch (Exception ex) {
                completableFuture.completeExceptionally(ex);
            }
        }, Runnable::run);
        return completableFuture;
    }
}
