package <%= rootPackage %>.infra.umadb;

import org.axonframework.common.infra.ComponentDescriptor;
import org.axonframework.eventsourcing.eventstore.AppendCondition;
import org.axonframework.eventsourcing.eventstore.ConsistencyMarker;
import org.axonframework.eventsourcing.eventstore.EventStorageEngine;
import org.axonframework.eventsourcing.eventstore.EventStorageEngine.AppendTransaction;
import org.axonframework.eventsourcing.eventstore.EventStoreException;
import org.axonframework.eventsourcing.eventstore.GlobalIndexConsistencyMarker;
import org.axonframework.eventsourcing.eventstore.SourcingCondition;
import org.axonframework.eventsourcing.eventstore.TaggedEventMessage;
import org.axonframework.messaging.core.MessageStream;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.processing.streaming.token.TrackingToken;
import org.axonframework.messaging.eventstreaming.StreamingCondition;

import java.util.HashMap;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public final class UmaDbEventStorageEngine implements EventStorageEngine {
    private final UmaDbEventStorageProperties properties;
    private final UmaDbClient client;

    public UmaDbEventStorageEngine(UmaDbEventStorageProperties properties) {
        this(properties, new GrpcUmaDbClient(properties));
    }

    public UmaDbEventStorageEngine(UmaDbEventStorageProperties properties, UmaDbClient client) {
        this.properties = properties;
        this.client = client;
    }

    @Override
    public CompletableFuture<AppendTransaction<?>> appendEvents(
            AppendCondition appendCondition,
            ProcessingContext processingContext,
            List<TaggedEventMessage<?>> events
    ) {
        var request = new UmaDbClient.AppendRequest(
                events.stream()
                        .map(UmaDbEventStorageEngine::toStoredEvent)
                        .toList()
        );
        return client.append(request).thenApply(UmaDbAppendTransaction::new);
    }

    @Override
    public MessageStream<EventMessage> source(SourcingCondition condition) {
        throw unsupported("source");
    }

    @Override
    public MessageStream<EventMessage> stream(StreamingCondition condition) {
        throw unsupported("stream");
    }

    @Override
    public CompletableFuture<TrackingToken> firstToken() {
        return CompletableFuture.failedFuture(unsupported("firstToken"));
    }

    @Override
    public CompletableFuture<TrackingToken> latestToken() {
        return CompletableFuture.failedFuture(unsupported("latestToken"));
    }

    @Override
    public CompletableFuture<TrackingToken> tokenAt(java.time.Instant instant) {
        return CompletableFuture.failedFuture(unsupported("tokenAt"));
    }

    @Override
    public void describeTo(ComponentDescriptor descriptor) {
        descriptor.describeProperty("type", "UmaDbEventStorageEngine");
        descriptor.describeProperty("protocol", "grpc");
        descriptor.describeProperty("target", properties.target());
        descriptor.describeProperty("plaintext", properties.plaintext());
        descriptor.describeProperty("batchSize", properties.batchSize());
    }

    private static StoredEvent toStoredEvent(TaggedEventMessage<?> tagged) {
        var event = tagged.event();
        var tags = tagged.tags().stream()
                .map(tag -> new StoredEventTag(tag.key(), tag.value()))
                .toList();
        return new StoredEvent(
                event.identifier(),
                event.type().name(),
                event.timestamp(),
                new HashMap<String, Object>(event.metadata()),
                event.payload(),
                tags
        );
    }

    private static EventStoreException unsupported(String operation) {
        return new EventStoreException("UmaDB EventStorageEngine operation '" + operation
                + "' is not implemented yet. Complete UmaDB query/stream support before using MEDOL_AXON_EVENT_STORAGE=umadb.");
    }

    private record UmaDbAppendTransaction(UmaDbClient.AppendResult result) implements AppendTransaction<UmaDbClient.AppendResult> {
        @Override
        public CompletableFuture<UmaDbClient.AppendResult> commit() {
            return CompletableFuture.completedFuture(result);
        }

        @Override
        public void rollback() {
            // UmaDB append is expected to be transactional; rollback is a no-op after client completion.
        }

        @Override
        public CompletableFuture<ConsistencyMarker> afterCommit(UmaDbClient.AppendResult result) {
            return CompletableFuture.completedFuture(new GlobalIndexConsistencyMarker(result.position()));
        }
    }
}
