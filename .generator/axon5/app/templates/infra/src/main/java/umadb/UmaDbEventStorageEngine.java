package <%= rootPackage %>.infra.umadb;

import org.axonframework.common.Registration;
import org.axonframework.common.infra.ComponentDescriptor;
import org.axonframework.eventsourcing.eventstore.AggregateBasedEventStorageEngineUtils;
import org.axonframework.eventsourcing.eventstore.AppendCondition;
import org.axonframework.eventsourcing.eventstore.AppendEventsTransactionRejectedException;
import org.axonframework.eventsourcing.eventstore.ConsistencyMarker;
import org.axonframework.eventsourcing.eventstore.ContinuousMessageStream;
import org.axonframework.eventsourcing.eventstore.EventStorageEngine;
import org.axonframework.eventsourcing.eventstore.EventStorageEngine.AppendTransaction;
import org.axonframework.eventsourcing.eventstore.GlobalIndexConsistencyMarker;
import org.axonframework.eventsourcing.eventstore.GlobalIndexPosition;
import org.axonframework.eventsourcing.eventstore.SourcingCondition;
import org.axonframework.eventsourcing.eventstore.SourcingStrategy;
import org.axonframework.eventsourcing.eventstore.TaggedEventMessage;
import org.axonframework.eventsourcing.eventstore.TerminalEventMessage;
import org.axonframework.messaging.core.Context;
import org.axonframework.messaging.core.MessageStream;
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.core.QualifiedName;
import org.axonframework.messaging.core.SimpleEntry;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.GenericEventMessage;
import org.axonframework.messaging.eventhandling.processing.streaming.token.GlobalSequenceTrackingToken;
import org.axonframework.messaging.eventhandling.processing.streaming.token.TrackingToken;
import org.axonframework.messaging.eventstreaming.EventCriterion;
import org.axonframework.messaging.eventstreaming.EventsCondition;
import org.axonframework.messaging.eventstreaming.StreamingCondition;
import org.axonframework.messaging.eventstreaming.Tag;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicLong;

public final class UmaDbEventStorageEngine implements EventStorageEngine {
    private static final String AXON_EVENT_VERSION = "axon_event_version";
    private static final String AXON_PAYLOAD_TYPE = "axon_payload_type";
    private static final String AXON_AGGREGATE_ID = "axon_aggregate_id";
    private static final String AXON_AGGREGATE_TYPE = "axon_aggregate_type";
    private static final String AXON_AGGREGATE_SEQUENCE = "axon_aggregate_sequence";

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
        try {
            AggregateBasedEventStorageEngineUtils.assertValidTags(events);
        } catch (Exception ex) {
            return CompletableFuture.failedFuture(ex);
        }
        var storedEvents = toStoredEvents(events);
        var request = new UmaDbClient.AppendRequest(
                storedEvents,
                appendCondition(appendCondition)
        );
        CompletableFuture<AppendTransaction<?>> future = client.append(request)
                .<AppendTransaction<?>>thenApply(result -> new UmaDbAppendTransaction(result, afterCommitMarker(result)))
                .exceptionallyCompose(ex -> CompletableFuture.failedFuture(appendException(appendCondition, ex)));
        return future;
    }

    @Override
    public MessageStream<EventMessage> source(SourcingCondition condition) {
        var start = sourceStart(condition);
        var request = new UmaDbClient.ReadRequest(start, properties.batchSize(), queryItems(condition));
        var result = client.read(request).join();
        return eventStream(result.events(), condition)
                .concatWith(terminalStream(result.events(), start));
    }

    @Override
    public MessageStream<EventMessage> stream(StreamingCondition condition) {
        var after = new AtomicLong(condition.position().position().orElse(-1L) - 1);
        return new ContinuousMessageStream<>(
                () -> nextSubscribedBatch(after, condition),
                UmaDbEventStorageEngine::trackedEntry,
                UmaDbEventStorageEngine::registerCallback
        );
    }

    @Override
    public CompletableFuture<TrackingToken> firstToken() {
        var request = new UmaDbClient.ReadRequest(0, 1, List.of());
        return client.read(request)
                .thenApply(result -> result.events().stream()
                        .findFirst()
                        .map(event -> (TrackingToken) new GlobalSequenceTrackingToken(Math.max(-1L, event.position() - 1)))
                        .orElseGet(() -> new GlobalSequenceTrackingToken(-1)));
    }

    @Override
    public CompletableFuture<TrackingToken> latestToken() {
        return client.head().thenApply(result -> new GlobalSequenceTrackingToken(result.position()));
    }

    @Override
    public CompletableFuture<TrackingToken> tokenAt(Instant instant) {
        return readTokenAt(instant, 0);
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
        var metadata = new HashMap<String, Object>(event.metadata());
        metadata.putIfAbsent(AXON_EVENT_VERSION, event.type().version());
        metadata.putIfAbsent(AXON_PAYLOAD_TYPE, event.payloadType().getName());
        var aggregateIdentifier = AggregateBasedEventStorageEngineUtils.resolveAggregateIdentifier(tagged.tags());
        if (aggregateIdentifier != null) {
            metadata.putIfAbsent(AXON_AGGREGATE_ID, aggregateIdentifier);
        }
        var aggregateType = AggregateBasedEventStorageEngineUtils.resolveAggregateType(tagged.tags());
        if (aggregateType != null) {
            metadata.putIfAbsent(AXON_AGGREGATE_TYPE, aggregateType);
        }
        return new StoredEvent(
                event.identifier(),
                event.type().name(),
                event.timestamp(),
                metadata,
                event.payload(),
                tags
        );
    }

    private List<StoredEvent> toStoredEvents(List<TaggedEventMessage<?>> events) {
        var nextSequences = new HashMap<String, Long>();
        return events.stream()
                .map(tagged -> {
                    var stored = toStoredEvent(tagged);
                    var aggregateId = (String) stored.metadata().get(AXON_AGGREGATE_ID);
                    if (aggregateId == null) {
                        return stored;
                    }
                    var sequence = nextSequences.compute(aggregateId, (ignored, current) ->
                            current == null ? currentAggregateSequence(stored) + 1 : current + 1
                    );
                    var metadata = new HashMap<String, Object>(stored.metadata());
                    metadata.put(AXON_AGGREGATE_SEQUENCE, String.valueOf(sequence));
                    return new StoredEvent(
                            stored.eventIdentifier(),
                            stored.eventType(),
                            stored.timestamp(),
                            metadata,
                            stored.payload(),
                            stored.tags()
                    );
                })
                .toList();
    }

    private MessageStream<EventMessage> eventStream(List<UmaDbClient.SequencedStoredEvent> events, EventsCondition condition) {
        return MessageStream.fromStream(
                events.stream().filter(event -> matches(event, condition)),
                event -> toEventMessage(event.event()),
                UmaDbEventStorageEngine::trackedContext
        );
    }

    private MessageStream<EventMessage> terminalStream(List<UmaDbClient.SequencedStoredEvent> events, long start) {
        var markerPosition = events.stream()
                .mapToLong(UmaDbClient.SequencedStoredEvent::position)
                .max()
                .orElse(Math.max(-1, start - 1)) + 1;
        return MessageStream.just(
                TerminalEventMessage.INSTANCE,
                ignored -> Context.with(ConsistencyMarker.RESOURCE_KEY, new GlobalIndexConsistencyMarker(markerPosition))
        );
    }

    private List<UmaDbClient.SequencedStoredEvent> nextSubscribedBatch(AtomicLong after, StreamingCondition condition) {
        var request = new UmaDbClient.SubscribeRequest(
                after.get(),
                properties.batchSize(),
                queryItems(condition)
        );
        var events = client.subscribe(request).join().events().stream()
                .filter(event -> matches(event, condition))
                .toList();
        events.stream()
                .mapToLong(UmaDbClient.SequencedStoredEvent::position)
                .max()
                .ifPresent(after::set);
        return events;
    }

    private CompletableFuture<TrackingToken> readTokenAt(Instant instant, long start) {
        var request = new UmaDbClient.ReadRequest(start, properties.batchSize(), List.of());
        return client.read(request).thenCompose(result -> {
            for (UmaDbClient.SequencedStoredEvent event : result.events()) {
                if (!event.event().timestamp().isBefore(instant)) {
                    return CompletableFuture.completedFuture(new GlobalSequenceTrackingToken(Math.max(-1L, event.position() - 1)));
                }
            }
            if (result.events().size() < properties.batchSize()) {
                return latestToken();
            }
            var nextStart = result.events().get(result.events().size() - 1).position() + 1;
            return readTokenAt(instant, nextStart);
        });
    }

    private long sourceStart(SourcingCondition condition) {
        if (condition.strategy() instanceof SourcingStrategy.Absolute absolute) {
            return Math.max(0, GlobalIndexPosition.toIndex(absolute.position()));
        }
        return 0;
    }

    private static List<UmaDbClient.QueryItem> queryItems(EventsCondition condition) {
        return condition.criteria().flatten().stream()
                .map(UmaDbEventStorageEngine::queryItem)
                .toList();
    }

    private static UmaDbClient.QueryItem queryItem(EventCriterion criterion) {
        var types = criterion.types().stream()
                .map(QualifiedName::fullName)
                .toList();
        var tags = criterion.tags().stream()
                .map(tag -> tag.key() + "=" + tag.value())
                .toList();
        return new UmaDbClient.QueryItem(types, tags);
    }

    private static UmaDbClient.AppendCondition appendCondition(AppendCondition condition) {
        return new UmaDbClient.AppendCondition(
                queryItems(condition),
                globalPosition(condition.consistencyMarker())
        );
    }

    private static Long globalPosition(ConsistencyMarker marker) {
        try {
            var position = GlobalIndexConsistencyMarker.position(marker);
            return position == Long.MAX_VALUE ? null : position;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static boolean matches(UmaDbClient.SequencedStoredEvent sequencedEvent, EventsCondition condition) {
        var event = sequencedEvent.event();
        return condition.matches(new QualifiedName(event.eventType()), axonTags(event));
    }

    private static Set<Tag> axonTags(StoredEvent event) {
        return event.tags().stream()
                .map(tag -> Tag.of(tag.key(), tag.value()))
                .collect(java.util.stream.Collectors.toSet());
    }

    private static EventMessage toEventMessage(StoredEvent event) {
        return new GenericEventMessage(
                event.eventIdentifier(),
                new MessageType(event.eventType()),
                event.payload(),
                stringMetadata(event.metadata()),
                event.timestamp()
        );
    }

    private static Map<String, String> stringMetadata(Map<String, Object> metadata) {
        var result = new HashMap<String, String>();
        for (Map.Entry<String, Object> entry : metadata.entrySet()) {
            result.put(entry.getKey(), String.valueOf(entry.getValue()));
        }
        return result;
    }

    private long currentAggregateSequence(StoredEvent event) {
        var queryItems = event.tags().stream()
                .map(tag -> new UmaDbClient.QueryItem(List.of(), List.of(tag.key() + "=" + tag.value())))
                .toList();
        var readResult = client.read(new UmaDbClient.ReadRequest(0, properties.batchSize(), queryItems)).join();
        return readResult.events().stream()
                .filter(stored -> sameAggregate(stored.event(), event))
                .map(stored -> stored.event().metadata().get(AXON_AGGREGATE_SEQUENCE))
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .mapToLong(Long::parseLong)
                .max()
                .orElse(-1);
    }

    private static boolean sameAggregate(StoredEvent left, StoredEvent right) {
        return java.util.Objects.equals(left.metadata().get(AXON_AGGREGATE_ID), right.metadata().get(AXON_AGGREGATE_ID));
    }

    private static Context trackedContext(UmaDbClient.SequencedStoredEvent event) {
        var context = Context.empty();
        context = TrackingToken.addToContext(context, new GlobalSequenceTrackingToken(event.position() + 1));
        context = ConsistencyMarker.addToContext(context, new GlobalIndexConsistencyMarker(event.position() + 1));
        return context;
    }

    private static SimpleEntry<EventMessage> trackedEntry(UmaDbClient.SequencedStoredEvent event) {
        return new SimpleEntry<>(toEventMessage(event.event()), trackedContext(event));
    }

    private static Registration registerCallback(ContinuousMessageStream<?> ignored, Runnable callback) {
        callback.run();
        return () -> true;
    }

    private static ConsistencyMarker afterCommitMarker(UmaDbClient.AppendResult result) {
        return new GlobalIndexConsistencyMarker(result.position());
    }

    private static Throwable appendException(AppendCondition condition, Throwable ex) {
        var cause = ex instanceof java.util.concurrent.CompletionException && ex.getCause() != null
                ? ex.getCause()
                : ex;
        if (cause instanceof UmaDbAppendConditionRejectedException) {
            return AppendEventsTransactionRejectedException.conflictingEventsDetected(condition.consistencyMarker());
        }
        return cause;
    }

    private record UmaDbAppendTransaction(
            UmaDbClient.AppendResult result,
            ConsistencyMarker marker
    ) implements AppendTransaction<UmaDbClient.AppendResult> {
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
            return CompletableFuture.completedFuture(marker);
        }
    }
}
