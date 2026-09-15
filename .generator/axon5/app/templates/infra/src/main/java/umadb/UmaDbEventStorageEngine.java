package <%= rootPackage %>.infra.umadb;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.axonframework.common.Registration;
import org.axonframework.common.infra.ComponentDescriptor;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.Set;
import java.util.stream.Collectors;

public final class UmaDbEventStorageEngine implements EventStorageEngine {
    private static final Logger logger = LoggerFactory.getLogger(UmaDbEventStorageEngine.class);
    private static final String AXON_EVENT_VERSION = "axon_event_version";
    private static final String AXON_PAYLOAD_TYPE = "axon_payload_type";

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
        var storedEvents = events.stream()
                .map(UmaDbEventStorageEngine::toStoredEvent)
                .toList();
        var request = new UmaDbClient.AppendRequest(
                storedEvents,
                appendCondition(appendCondition)
        );
        if (logger.isDebugEnabled()) {
            logger.debug(
                    "Preparing UmaDB append. eventCount={}, eventTypes={}, eventTags={}, failIfEventsMatch={}, after={}",
                    storedEvents.size(),
                    storedEvents.stream().map(StoredEvent::eventType).toList(),
                    storedEvents.stream().map(UmaDbEventStorageEngine::storedEventTags).toList(),
                    request.condition() == null ? List.of() : request.condition().failIfEventsMatch(),
                    request.condition() == null ? null : request.condition().after()
            );
        }
        return CompletableFuture.completedFuture(new UmaDbAppendTransaction(client, request, appendCondition));
    }

    @Override
    public MessageStream<EventMessage> source(SourcingCondition condition) {
        var start = sourceStart(condition);
        var head = client.head().join().position();
        var queryItems = queryItems(condition);
        var request = new UmaDbClient.ReadRequest(start, null, properties.batchSize(), queryItems);
        logger.debug("Reading UmaDB source. start={}, head={}, queryItems={}", start, head, queryItems);
        var result = client.read(request).join();
        if (logger.isDebugEnabled()) {
            logger.debug(
                    "Read UmaDB source result. start={}, head={}, queryItems={}, eventCount={}, events={}",
                    start,
                    head,
                    queryItems,
                    result.events().size(),
                    result.events().stream()
                            .map(event -> event.position() + ":" + event.event().eventType() + storedEventTags(event.event()))
                            .toList()
            );
            logger.debug(
                    "Read UmaDB source payload types. start={}, payloadTypes={}",
                    start,
                    result.events().stream()
                            .map(event -> event.position() + ":" + event.event().payload().getClass().getName())
                            .toList()
            );
        }
        return eventStream(result.events(), condition)
                .concatWith(terminalStream(head));
    }

    @Override
    public MessageStream<EventMessage> stream(StreamingCondition condition) {
        var after = new AtomicLong(condition.position().position().orElse(-1L) - 1);
        var subscription = new AtomicReference<UmaDbClient.Subscription>();
        var queue = new LinkedBlockingQueue<UmaDbClient.SequencedStoredEvent>();
        var closed = new AtomicBoolean(false);
        var streamError = new AtomicReference<RuntimeException>();
        return new ContinuousMessageStream<>(
                () -> nextQueuedBatch(after, condition, queue, streamError),
                UmaDbEventStorageEngine::trackedEntry,
                (stream, callback) -> registerCallback(after, condition, subscription, queue, closed, streamError, callback)
        );
    }

    @Override
    public CompletableFuture<TrackingToken> firstToken() {
        var request = new UmaDbClient.ReadRequest(0, 1, 1, List.of());
        return client.read(request)
                .thenApply(result -> result.events().stream()
                        .findFirst()
                        .map(event -> (TrackingToken) new GlobalSequenceTrackingToken(event.position()))
                        .orElseGet(() -> new GlobalSequenceTrackingToken(-1)));
    }

    @Override
    public CompletableFuture<TrackingToken> latestToken() {
        return client.head().thenApply(result -> new GlobalSequenceTrackingToken(result.position() < 0 ? -1 : result.position() + 1));
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
        return new StoredEvent(
                event.identifier(),
                event.type().name(),
                event.timestamp(),
                metadata,
                event.payload(),
                tags
        );
    }

    private MessageStream<EventMessage> eventStream(List<UmaDbClient.SequencedStoredEvent> events, EventsCondition condition) {
        return MessageStream.fromStream(
                events.stream().filter(event -> matches(event, condition)),
                event -> toEventMessage(event.event()),
                UmaDbEventStorageEngine::trackedContext
        );
    }

    private MessageStream<EventMessage> terminalStream(long head) {
        var markerPosition = Math.max(-1, head) + 1;
        return MessageStream.just(
                TerminalEventMessage.INSTANCE,
                ignored -> Context.with(ConsistencyMarker.RESOURCE_KEY, new GlobalIndexConsistencyMarker(markerPosition))
        );
    }

    private List<UmaDbClient.SequencedStoredEvent> nextQueuedBatch(
            AtomicLong after,
            StreamingCondition condition,
            BlockingQueue<UmaDbClient.SequencedStoredEvent> queue,
            AtomicReference<RuntimeException> streamError
    ) {
        var error = streamError.get();
        if (error != null) {
            throw error;
        }
        var events = new java.util.ArrayList<UmaDbClient.SequencedStoredEvent>(properties.batchSize());
        queue.drainTo(events, properties.batchSize());
        var unseenEvents = events.stream()
                .filter(event -> event.position() > after.get())
                .filter(event -> matches(event, condition))
                .toList();
        advanceAfter(after, unseenEvents);
        return unseenEvents;
    }

    private void runSubscriptionReader(
            AtomicLong after,
            StreamingCondition condition,
            AtomicReference<UmaDbClient.Subscription> subscription,
            BlockingQueue<UmaDbClient.SequencedStoredEvent> queue,
            AtomicBoolean closed,
            AtomicReference<RuntimeException> streamError,
            Runnable callback
    ) {
        while (!closed.get()) {
            try {
                var activeSubscription = subscription.updateAndGet(current ->
                        current == null ? openSubscription(after.get(), condition) : current
                );
                var events = activeSubscription.nextBatch().events();
                if (events.isEmpty()) {
                    handleEmptySubscribedBatch(after, condition, subscription, queue, closed, callback);
                    continue;
                }
                queue.addAll(events);
                callback.run();
            } catch (CompletionException ex) {
                if (!handleSubscriptionFailure(after, condition, subscription, queue, closed, streamError, callback, ex)) {
                    return;
                }
            } catch (RuntimeException ex) {
                if (!handleSubscriptionFailure(after, condition, subscription, queue, closed, streamError, callback, ex)) {
                    return;
                }
            }
        }
    }

    private boolean handleSubscriptionFailure(
            AtomicLong after,
            StreamingCondition condition,
            AtomicReference<UmaDbClient.Subscription> subscription,
            BlockingQueue<UmaDbClient.SequencedStoredEvent> queue,
            AtomicBoolean closed,
            AtomicReference<RuntimeException> streamError,
            Runnable callback,
            RuntimeException ex
    ) {
        if (closed.get()) {
            return false;
        }
        if (isDeadlineExceeded(ex)) {
            closeSubscription(subscription);
            var catchUpEvents = readCatchUpOrSignalError(after, condition, streamError, callback);
            if (!catchUpEvents.isEmpty()) {
                queue.addAll(catchUpEvents);
                callback.run();
            }
            return streamError.get() == null;
        }
        streamError.compareAndSet(null, ex);
        callback.run();
        return false;
    }

    private List<UmaDbClient.SequencedStoredEvent> readCatchUpOrSignalError(
            AtomicLong after,
            StreamingCondition condition,
            AtomicReference<RuntimeException> streamError,
            Runnable callback
    ) {
        try {
            return readCatchUp(after, condition);
        } catch (RuntimeException catchUpFailure) {
            streamError.compareAndSet(null, catchUpFailure);
            callback.run();
            return List.of();
        }
    }

    private void handleEmptySubscribedBatch(
            AtomicLong after,
            StreamingCondition condition,
            AtomicReference<UmaDbClient.Subscription> subscription,
            BlockingQueue<UmaDbClient.SequencedStoredEvent> queue,
            AtomicBoolean closed,
            Runnable callback
    ) {
        closeSubscription(subscription);
        if (closed.get()) {
            return;
        }
        var catchUpEvents = readCatchUp(after, condition);
        if (!catchUpEvents.isEmpty()) {
            queue.addAll(catchUpEvents);
            callback.run();
        } else {
            sleepBeforeReopeningSubscription();
        }
    }

    private static void sleepBeforeReopeningSubscription() {
        try {
            Thread.sleep(25L);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private List<UmaDbClient.SequencedStoredEvent> readCatchUp(AtomicLong after, StreamingCondition condition) {
        var request = new UmaDbClient.ReadRequest(
                Math.max(0, after.get() + 1),
                properties.batchSize(),
                properties.batchSize(),
                queryItems(condition)
        );
        logger.debug("Reading UmaDB stream catch-up. start={}, batchSize={}, queryItems={}", request.start(), request.batchSize(), request.queryItems());
        return client.read(request).join().events();
    }

    private UmaDbClient.Subscription openSubscription(long after, StreamingCondition condition) {
        var request = new UmaDbClient.SubscribeRequest(
                after,
                properties.batchSize(),
                queryItems(condition)
        );
        logger.debug("Opening UmaDB subscription. after={}, batchSize={}, queryItems={}", request.after(), request.batchSize(), request.queryItems());
        return client.openSubscription(request);
    }

    private static void advanceAfter(AtomicLong after, List<UmaDbClient.SequencedStoredEvent> events) {
        events.stream()
                .mapToLong(UmaDbClient.SequencedStoredEvent::position)
                .max()
                .ifPresent(after::set);
    }

    private static void closeSubscription(AtomicReference<UmaDbClient.Subscription> subscription) {
        var current = subscription.getAndSet(null);
        if (current != null) {
            current.close();
        }
    }

    private CompletableFuture<TrackingToken> readTokenAt(Instant instant, long start) {
        var request = new UmaDbClient.ReadRequest(start, properties.batchSize(), properties.batchSize(), List.of());
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
        throw new UnsupportedOperationException("Unsupported UmaDB sourcing strategy: " + condition.strategy());
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

    private static List<String> storedEventTags(StoredEvent event) {
        return event.tags().stream()
                .map(tag -> tag.key() + "=" + tag.value())
                .toList();
    }

    private static UmaDbClient.AppendCondition appendCondition(AppendCondition condition) {
        return new UmaDbClient.AppendCondition(
                queryItems(condition),
                conflictAfterPosition(condition.consistencyMarker())
        );
    }

    private static Long conflictAfterPosition(ConsistencyMarker marker) {
        var position = globalPosition(marker);
        if (position == null) {
            return null;
        }
        if (position == Long.MAX_VALUE) {
            return Long.MAX_VALUE;
        }
        return position <= 0 ? 0L : position - 1;
    }

    private static Long globalPosition(ConsistencyMarker marker) {
        if (marker == ConsistencyMarker.INFINITY) {
            return Long.MAX_VALUE;
        }
        try {
            return GlobalIndexConsistencyMarker.position(marker);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static boolean matches(UmaDbClient.SequencedStoredEvent sequencedEvent, EventsCondition condition) {
        var event = sequencedEvent.event();
        return condition.matches(new QualifiedName(event.eventType()), axonTags(event));
    }

    private static boolean isDeadlineExceeded(Throwable throwable) {
        var current = throwable;
        while (current != null) {
            if (current instanceof StatusRuntimeException statusException
                    && statusException.getStatus().getCode() == Status.Code.DEADLINE_EXCEEDED) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private static Set<Tag> axonTags(StoredEvent event) {
        return event.tags().stream()
                .map(tag -> Tag.of(tag.key(), tag.value()))
                .collect(Collectors.toSet());
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

    private static Context trackedContext(UmaDbClient.SequencedStoredEvent event) {
        var context = Context.empty();
        context = TrackingToken.addToContext(context, new GlobalSequenceTrackingToken(event.position() + 1));
        return context;
    }

    private static SimpleEntry<EventMessage> trackedEntry(UmaDbClient.SequencedStoredEvent event) {
        return new SimpleEntry<>(toEventMessage(event.event()), trackedContext(event));
    }

    private Registration registerCallback(
            AtomicLong after,
            StreamingCondition condition,
            AtomicReference<UmaDbClient.Subscription> subscription,
            BlockingQueue<UmaDbClient.SequencedStoredEvent> queue,
            AtomicBoolean closed,
            AtomicReference<RuntimeException> streamError,
            Runnable callback
    ) {
        var reader = new Thread(
                () -> runSubscriptionReader(after, condition, subscription, queue, closed, streamError, callback),
                "umadb-event-stream-reader"
        );
        reader.setDaemon(true);
        reader.start();
        callback.run();
        return () -> {
            closed.set(true);
            closeSubscription(subscription);
            reader.interrupt();
            return true;
        };
    }

    private static ConsistencyMarker afterCommitMarker(UmaDbClient.AppendResult result) {
        return new GlobalIndexConsistencyMarker(result.position() < 0 ? -1 : result.position() + 1);
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
            UmaDbClient client,
            UmaDbClient.AppendRequest request,
            AppendCondition condition
    ) implements AppendTransaction<UmaDbClient.AppendResult> {
        @Override
        public CompletableFuture<UmaDbClient.AppendResult> commit() {
            return client.append(request)
                    .exceptionallyCompose(ex -> {
                        logger.debug(
                                "UmaDB append failed. failIfEventsMatch={}, after={}, error={}",
                                request.condition() == null ? List.of() : request.condition().failIfEventsMatch(),
                                request.condition() == null ? null : request.condition().after(),
                                ex.toString()
                        );
                        return CompletableFuture.failedFuture(appendException(condition, ex));
                    });
        }

        @Override
        public void rollback() {
            // No remote append happens before commit, so rollback has nothing to undo.
        }

        @Override
        public CompletableFuture<ConsistencyMarker> afterCommit(UmaDbClient.AppendResult result) {
            return CompletableFuture.completedFuture(afterCommitMarker(result));
        }
    }
}
