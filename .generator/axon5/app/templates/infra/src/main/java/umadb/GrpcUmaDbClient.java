package <%= rootPackage %>.infra.umadb;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.protobuf.ByteString;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import umadb.v1.DCBGrpc;
import umadb.v1.Umadb;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public final class GrpcUmaDbClient implements UmaDbClient, AutoCloseable {
    private static final Metadata.Key<String> AUTHORIZATION =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);
    private static final String AXON_TIMESTAMP = "axon_timestamp";
    private static final String AXON_PAYLOAD_TYPE = "axon_payload_type";

    private final ManagedChannel channel;
    private final DCBGrpc.DCBFutureStub stub;
    private final DCBGrpc.DCBBlockingStub blockingStub;
    private final UmaDbEventStorageProperties properties;
    private final ObjectMapper objectMapper;

    public GrpcUmaDbClient(UmaDbEventStorageProperties properties) {
        this(properties, new ObjectMapper().findAndRegisterModules());
    }

    public GrpcUmaDbClient(UmaDbEventStorageProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        var channelBuilder = ManagedChannelBuilder.forTarget(properties.target());
        if (properties.plaintext()) {
            channelBuilder.usePlaintext();
        }
        this.channel = channelBuilder.build();
        var futureStub = DCBGrpc.newFutureStub(channel);
        var blockingStub = DCBGrpc.newBlockingStub(channel);
        if (!properties.apiKey().isBlank()) {
            var headers = new Metadata();
            headers.put(AUTHORIZATION, "Bearer " + properties.apiKey());
            var interceptor = MetadataUtils.newAttachHeadersInterceptor(headers);
            futureStub = futureStub.withInterceptors(interceptor);
            blockingStub = blockingStub.withInterceptors(interceptor);
        }
        this.stub = futureStub;
        this.blockingStub = blockingStub;
        this.objectMapper = objectMapper;
    }

    @Override
    public CompletableFuture<UmaDbClient.AppendResult> append(UmaDbClient.AppendRequest request) {
        var builder = Umadb.AppendRequest.newBuilder();
        for (StoredEvent event : request.events()) {
            builder.addEvents(toUmaDbEvent(event));
        }
        if (request.condition() != null) {
            builder.setCondition(toAppendCondition(request.condition()));
        }
        return toCompletableFuture(deadlineStub().append(builder.build()))
                .thenApply(response -> new UmaDbClient.AppendResult(response.getPosition()));
    }

    @Override
    public CompletableFuture<UmaDbClient.ReadResult> read(UmaDbClient.ReadRequest request) {
        return CompletableFuture.supplyAsync(() -> {
            var responseIterator = deadlineBlockingStub().read(toReadRequest(request));
            var events = new ArrayList<UmaDbClient.SequencedStoredEvent>();
            while (responseIterator.hasNext()) {
                var response = responseIterator.next();
                for (Umadb.SequencedEvent event : response.getEventsList()) {
                    events.add(toSequencedStoredEvent(event));
                }
            }
            return new UmaDbClient.ReadResult(events);
        });
    }

    @Override
    public CompletableFuture<UmaDbClient.ReadResult> subscribe(UmaDbClient.SubscribeRequest request) {
        return CompletableFuture.supplyAsync(() -> {
            var responseIterator = deadlineBlockingStub().subscribe(toSubscribeRequest(request));
            if (!responseIterator.hasNext()) {
                return new UmaDbClient.ReadResult(List.of());
            }
            var response = responseIterator.next();
            var events = new ArrayList<UmaDbClient.SequencedStoredEvent>();
            for (Umadb.SequencedEvent event : response.getEventsList()) {
                events.add(toSequencedStoredEvent(event));
            }
            return new UmaDbClient.ReadResult(events);
        });
    }

    @Override
    public CompletableFuture<UmaDbClient.HeadResult> head() {
        return toCompletableFuture(deadlineStub().head(Umadb.HeadRequest.newBuilder().build()))
                .thenApply(response -> new UmaDbClient.HeadResult(response.hasPosition() ? response.getPosition() : -1L));
    }

    @Override
    public void close() {
        channel.shutdown();
    }

    private DCBGrpc.DCBFutureStub deadlineStub() {
        return stub.withDeadlineAfter(properties.requestTimeout().toMillis(), TimeUnit.MILLISECONDS);
    }

    private DCBGrpc.DCBBlockingStub deadlineBlockingStub() {
        return blockingStub.withDeadlineAfter(properties.requestTimeout().toMillis(), TimeUnit.MILLISECONDS);
    }

    private Umadb.AppendCondition toAppendCondition(UmaDbClient.AppendCondition condition) {
        var builder = Umadb.AppendCondition.newBuilder();
        if (!condition.failIfEventsMatch().isEmpty()) {
            builder.setFailIfEventsMatch(toQuery(condition.failIfEventsMatch()));
        }
        if (condition.after() != null && condition.after() >= 0) {
            builder.setAfter(condition.after());
        }
        return builder.build();
    }

    private Umadb.ReadRequest toReadRequest(UmaDbClient.ReadRequest request) {
        var builder = Umadb.ReadRequest.newBuilder()
                .setStart(Math.max(0, request.start()))
                .setBatchSize(request.batchSize())
                .setBackwards(false);
        if (request.limit() != null) {
            builder.setLimit(request.limit());
        }
        if (!request.queryItems().isEmpty()) {
            builder.setQuery(toQuery(request.queryItems()));
        }
        return builder.build();
    }

    private Umadb.SubscribeRequest toSubscribeRequest(UmaDbClient.SubscribeRequest request) {
        var builder = Umadb.SubscribeRequest.newBuilder()
                .setBatchSize(request.batchSize());
        if (request.after() >= 0) {
            builder.setAfter(request.after());
        }
        if (!request.queryItems().isEmpty()) {
            builder.setQuery(toQuery(request.queryItems()));
        }
        return builder.build();
    }

    private Umadb.Query toQuery(List<UmaDbClient.QueryItem> items) {
        var query = Umadb.Query.newBuilder();
        for (UmaDbClient.QueryItem item : items) {
            var queryItem = Umadb.QueryItem.newBuilder()
                    .addAllTypes(item.types())
                    .addAllTags(item.tags())
                    .build();
            query.addItems(queryItem);
        }
        return query.build();
    }

    private Umadb.Event toUmaDbEvent(StoredEvent event) {
        var builder = Umadb.Event.newBuilder()
                .setEventType(event.eventType())
                .setUuid(event.eventIdentifier())
                .setData(ByteString.copyFrom(serializePayload(event.payload())));

        for (StoredEventTag tag : event.tags()) {
            builder.addTags(tag.key() + "=" + tag.value());
        }
        builder.addMetadata(metadata(AXON_TIMESTAMP, event.timestamp().toString()));
        builder.addMetadata(metadata(AXON_PAYLOAD_TYPE, event.payload().getClass().getName()));
        for (Map.Entry<String, Object> entry : event.metadata().entrySet()) {
            builder.addMetadata(metadata(entry.getKey(), String.valueOf(entry.getValue())));
        }
        return builder.build();
    }

    private UmaDbClient.SequencedStoredEvent toSequencedStoredEvent(Umadb.SequencedEvent sequencedEvent) {
        var event = sequencedEvent.getEvent();
        var metadata = new HashMap<String, Object>();
        for (Umadb.MetadataEntry entry : event.getMetadataList()) {
            metadata.put(entry.getKey(), entry.getValue());
        }
        var tags = new ArrayList<StoredEventTag>();
        for (String tag : event.getTagsList()) {
            var separator = tag.indexOf('=');
            if (separator > 0) {
                tags.add(new StoredEventTag(tag.substring(0, separator), tag.substring(separator + 1)));
            }
        }
        var timestamp = Instant.parse(String.valueOf(metadata.getOrDefault(AXON_TIMESTAMP, Instant.EPOCH.toString())));
        var payload = deserializePayload(event.getData().toByteArray(), event.getEventType(), metadata);
        var storedEvent = new StoredEvent(
                event.getUuid(),
                event.getEventType(),
                timestamp,
                metadata,
                payload,
                tags
        );
        return new UmaDbClient.SequencedStoredEvent(sequencedEvent.getPosition(), storedEvent);
    }

    private Object deserializePayload(byte[] data, String eventType, Map<String, Object> metadata) {
        var payloadType = String.valueOf(metadata.getOrDefault(AXON_PAYLOAD_TYPE, eventType));
        try {
            return objectMapper.readValue(data, Class.forName(payloadType));
        } catch (Exception ignored) {
            try {
                return objectMapper.readValue(data, Object.class);
            } catch (Exception ex) {
                throw new IllegalStateException("Unable to deserialize Axon event payload from UmaDB", ex);
            }
        }
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
                completableFuture.completeExceptionally(mapException(ex));
            }
        }, Runnable::run);
        return completableFuture;
    }

    private static Throwable mapException(Exception ex) {
        var cause = ex.getCause() == null ? ex : ex.getCause();
        if (cause instanceof StatusRuntimeException statusException && isConditionFailure(statusException)) {
            return new UmaDbAppendConditionRejectedException(statusException);
        }
        return cause;
    }

    private static boolean isConditionFailure(StatusRuntimeException exception) {
        var code = exception.getStatus().getCode();
        return code == Status.Code.ABORTED
                || code == Status.Code.ALREADY_EXISTS
                || code == Status.Code.FAILED_PRECONDITION
                || code == Status.Code.INVALID_ARGUMENT;
    }
}
