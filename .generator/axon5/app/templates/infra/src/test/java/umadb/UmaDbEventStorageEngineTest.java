package <%= rootPackage %>.infra.umadb;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.axonframework.eventsourcing.eventstore.AppendCondition;
import org.axonframework.eventsourcing.eventstore.AppendEventsTransactionRejectedException;
import org.axonframework.eventsourcing.eventstore.ConsistencyMarker;
import org.axonframework.eventsourcing.eventstore.EventStorageEngine.AppendTransaction;
import org.axonframework.eventsourcing.eventstore.GlobalIndexConsistencyMarker;
import org.axonframework.eventsourcing.eventstore.SourcingCondition;
import org.axonframework.eventsourcing.eventstore.TaggedEventMessage;
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.GenericEventMessage;
import org.axonframework.messaging.eventhandling.processing.streaming.token.GlobalSequenceTrackingToken;
import org.axonframework.messaging.eventhandling.processing.streaming.token.TrackingToken;
import org.axonframework.messaging.eventstreaming.EventCriteria;
import org.axonframework.messaging.eventstreaming.StreamingCondition;
import org.axonframework.messaging.eventstreaming.Tag;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

class UmaDbEventStorageEngineTest {
    private static final Instant NOW = Instant.parse("2026-07-14T00:00:00Z");

    @Test
    void appendPassesDcbConditionAndTagsToUmaDb() {
        var client = new RecordingUmaDbClient();
        var engine = engine(client);
        var condition = AppendCondition
                .withCriteria(EventCriteria.havingTags(Tag.of("Order", "order-1")))
                .withMarker(new GlobalIndexConsistencyMarker(3));

        var marker = commit(engine.appendEvents(condition, null, List.of(tagged("created", "OrderCreated", "Order", "order-1"))).join());

        assertEquals(2L, client.appendRequest.condition().after());
        assertEquals(List.of("Order=order-1"), client.appendRequest.condition().failIfEventsMatch().getFirst().tags());
        assertEquals(1L, GlobalIndexConsistencyMarker.position(marker));
        var appended = client.appendRequest.events().getFirst();
        assertEquals(List.of(new StoredEventTag("Order", "order-1")), appended.tags());
        assertFalse(appended.metadata().containsKey("axon_aggregate_id"));
        assertFalse(appended.metadata().containsKey("axon_aggregate_type"));
        assertFalse(appended.metadata().containsKey("axon_aggregate_sequence"));
    }

    @Test
    void appendPassesZeroConsistencyMarkerToUmaDb() {
        var client = new RecordingUmaDbClient();
        var engine = engine(client);
        var condition = AppendCondition
                .withCriteria(EventCriteria.havingTags(Tag.of("Order", "order-1")))
                .withMarker(new GlobalIndexConsistencyMarker(0));

        commit(engine.appendEvents(condition, null, List.of(tagged("created", "OrderCreated", "Order", "order-1"))).join());

        assertEquals(0L, client.appendRequest.condition().after());
        assertEquals(List.of("Order=order-1"), client.appendRequest.condition().failIfEventsMatch().getFirst().tags());
    }

    @Test
    void appendAllowsMultipleDcbTagsPerEvent() {
        var client = new RecordingUmaDbClient();
        var engine = engine(client);

        commit(engine.appendEvents(
                AppendCondition.none(),
                null,
                List.of(tagged(
                        "dictionary-registered",
                        "DictionaryRegistered",
                        Set.of(Tag.of("dictionaryId", "dict-1"), Tag.of("dictionaryCode", "RUNTIME_CONNECTIVITY_MODE"))
                ))
        ).join());

        var storedTags = client.appendRequest.events().getFirst().tags().stream()
                .map(tag -> tag.key() + "=" + tag.value())
                .sorted()
                .toList();
        assertEquals(List.of("dictionaryCode=RUNTIME_CONNECTIVITY_MODE", "dictionaryId=dict-1"), storedTags);
    }

    @Test
    void appendConditionRejectionBecomesAxonConflict() {
        var client = new RecordingUmaDbClient();
        client.appendFailure = new UmaDbAppendConditionRejectedException(new RuntimeException("conflict"));
        var engine = engine(client);
        var condition = AppendCondition.withCriteria(EventCriteria.havingTags(Tag.of("Order", "order-1")));

        var thrown = assertThrowsCompletion(() ->
                engine.appendEvents(condition, null, List.of(tagged("created", "OrderCreated", "Order", "order-1"))).join().commit().join()
        );

        assertInstanceOf(AppendEventsTransactionRejectedException.class, thrown);
    }

    @Test
    void appendInfinityConsistencyMarkerChecksAfterMaximumPosition() {
        var client = new RecordingUmaDbClient();
        var engine = engine(client);
        var condition = AppendCondition.withCriteria(EventCriteria.havingTags(Tag.of("Order", "order-1")))
                .withMarker(ConsistencyMarker.INFINITY);

        commit(engine.appendEvents(condition, null, List.of(tagged("created", "OrderCreated", "Order", "order-1"))).join());

        assertEquals(Long.MAX_VALUE, client.appendRequest.condition().after());
    }

    @Test
    void appendWritesOnlyWhenTransactionCommits() {
        var client = new RecordingUmaDbClient();
        var engine = engine(client);

        var rolledBack = engine.appendEvents(
                AppendCondition.none(),
                null,
                List.of(tagged("rolled-back", "OrderCreated", "Order", "order-1"))
        ).join();
        assertNull(client.appendRequest);

        rolledBack.rollback();
        assertNull(client.appendRequest);

        var committed = engine.appendEvents(
                AppendCondition.none(),
                null,
                List.of(tagged("committed", "OrderCreated", "Order", "order-1"))
        ).join();
        commit(committed);

        assertEquals("committed", client.appendRequest.events().getFirst().eventIdentifier());
    }

    @Test
    void sourceAddsTrackingContextFromUmaDbPosition() {
        var client = new RecordingUmaDbClient();
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                7,
                stored("stored", "OrderCreated", Map.of(), "Order", "order-1")
        ));
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                9,
                stored("unrelated", "OrderCreated", Map.of(), "Order", "order-2")
        ));
        var stream = engine(client).source(SourcingCondition.conditionFor(EventCriteria.havingTags(Tag.of("Order", "order-1"))));

        var entry = stream.next().orElseThrow();
        var token = TrackingToken.fromContext(entry).orElseThrow();
        var terminal = stream.next().orElseThrow();
        var marker = terminal.getResource(ConsistencyMarker.RESOURCE_KEY);

        assertNull(client.readRequest.limit());
        assertEquals(16, client.readRequest.batchSize());
        assertEquals("stored", entry.message().identifier());
        assertEquals(8L, token.position().orElseThrow());
        assertFalse(entry.containsResource(ConsistencyMarker.RESOURCE_KEY));
        assertEquals(10L, GlobalIndexConsistencyMarker.position(marker));
    }

    @Test
    void streamUsesUmaDbSubscribeAndStartsAfterPreviousToken() {
        var client = new RecordingUmaDbClient();
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                10,
                stored("streamed", "OrderCreated", Map.of(), "Order", "order-1")
        ));
        var stream = engine(client).stream(StreamingCondition.conditionFor(
                new GlobalSequenceTrackingToken(4),
                EventCriteria.havingTags(Tag.of("Order", "order-1"))
        ));

        var entry = stream.next().orElseThrow();

        assertEquals(3L, client.subscribeRequest.after());
        assertEquals("streamed", entry.message().identifier());
        assertEquals(11L, TrackingToken.fromContext(entry).orElseThrow().position().orElseThrow());
    }

    @Test
    void streamTreatsUmaDbSubscribeDeadlineAsEmptyBatch() {
        var client = new RecordingUmaDbClient();
        client.subscribeFailure = new StatusRuntimeException(Status.DEADLINE_EXCEEDED);
        var stream = engine(client).stream(StreamingCondition.conditionFor(
                new GlobalSequenceTrackingToken(4),
                EventCriteria.havingTags(Tag.of("Order", "order-1"))
        ));

        assertTrue(stream.next().isEmpty());
        assertEquals(3L, client.subscribeRequest.after());
    }

    @Test
    void firstAndLatestTokenUseDcbGlobalPositions() {
        var client = new RecordingUmaDbClient();
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                0,
                stored("first", "OrderCreated", Map.of(), "Order", "order-1")
        ));
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                5,
                stored("latest", "OrderConfirmed", Map.of(), "Order", "order-1")
        ));
        var engine = engine(client);

        assertEquals(0L, engine.firstToken().join().position().orElseThrow());
        assertEquals(6L, engine.latestToken().join().position().orElseThrow());
    }

    private static UmaDbEventStorageEngine engine(UmaDbClient client) {
        return new UmaDbEventStorageEngine(
                UmaDbEventStorageProperties.of("localhost:50051", true, "", 16, Duration.ofSeconds(1)),
                client
        );
    }

    private static TaggedEventMessage<EventMessage> tagged(String identifier, String eventType, String tagKey, String tagValue) {
        return new TestTaggedEventMessage(event(identifier, eventType), Set.of(Tag.of(tagKey, tagValue)));
    }

    private static TaggedEventMessage<EventMessage> tagged(String identifier, String eventType, Set<Tag> tags) {
        return new TestTaggedEventMessage(event(identifier, eventType), tags);
    }

    private static EventMessage event(String identifier, String eventType) {
        return new GenericEventMessage(
                identifier,
                new MessageType(eventType),
                Map.of("id", identifier),
                Map.of(),
                NOW
        );
    }

    private static StoredEvent stored(String identifier, String eventType, Map<String, Object> metadata, String tagKey, String tagValue) {
        return new StoredEvent(
                identifier,
                eventType,
                NOW,
                metadata,
                Map.of("id", identifier),
                List.of(new StoredEventTag(tagKey, tagValue))
        );
    }

    @SuppressWarnings("unchecked")
    private static ConsistencyMarker commit(AppendTransaction<?> transaction) {
        var typed = (AppendTransaction<UmaDbClient.AppendResult>) transaction;
        var result = typed.commit().join();
        return typed.afterCommit(result).join();
    }

    private static Throwable assertThrowsCompletion(Runnable runnable) {
        try {
            runnable.run();
        } catch (CompletionException ex) {
            return ex.getCause();
        }
        return fail("Expected CompletionException");
    }

    private record TestTaggedEventMessage(
            EventMessage event,
            Set<Tag> tags
    ) implements TaggedEventMessage<EventMessage> {
        @Override
        public TaggedEventMessage<EventMessage> updateTags(java.util.function.Function<Set<Tag>, Set<Tag>> updater) {
            return new TestTaggedEventMessage(event, updater.apply(tags));
        }
    }

    private static final class RecordingUmaDbClient implements UmaDbClient {
        private final List<UmaDbClient.SequencedStoredEvent> events = new ArrayList<>();
        private AppendRequest appendRequest;
        private ReadRequest readRequest;
        private SubscribeRequest subscribeRequest;
        private RuntimeException appendFailure;
        private RuntimeException subscribeFailure;

        @Override
        public CompletableFuture<AppendResult> append(AppendRequest request) {
            appendRequest = request;
            if (appendFailure != null) {
                return CompletableFuture.failedFuture(appendFailure);
            }
            var position = events.isEmpty() ? -1 : events.getLast().position();
            for (StoredEvent event : request.events()) {
                events.add(new UmaDbClient.SequencedStoredEvent(++position, event));
            }
            return CompletableFuture.completedFuture(new AppendResult(position));
        }

        @Override
        public CompletableFuture<ReadResult> read(ReadRequest request) {
            readRequest = request;
            return CompletableFuture.completedFuture(new ReadResult(selectAfter(request.start() - 1, request.limit(), request.queryItems())));
        }

        @Override
        public Subscription openSubscription(SubscribeRequest request) {
            subscribeRequest = request;
            if (subscribeFailure != null) {
                throw subscribeFailure;
            }
            return new RecordingSubscription(request);
        }

        @Override
        public CompletableFuture<HeadResult> head() {
            var position = events.isEmpty() ? -1 : events.getLast().position();
            return CompletableFuture.completedFuture(new HeadResult(position));
        }

        private List<UmaDbClient.SequencedStoredEvent> selectAfter(long after, Integer limit, List<QueryItem> queryItems) {
            var max = limit == null ? Long.MAX_VALUE : limit.longValue();
            return events.stream()
                    .filter(event -> event.position() > after)
                    .filter(event -> matchesAny(event.event(), queryItems))
                    .limit(max)
                    .toList();
        }

        private static boolean matchesAny(StoredEvent event, List<QueryItem> queryItems) {
            if (queryItems.isEmpty()) {
                return true;
            }
            return queryItems.stream().anyMatch(item -> matches(event, item));
        }

        private static boolean matches(StoredEvent event, QueryItem item) {
            var typeMatches = item.types().isEmpty() || item.types().contains(event.eventType());
            var eventTags = event.tags().stream()
                    .map(tag -> tag.key() + "=" + tag.value())
                    .toList();
            var tagsMatch = item.tags().isEmpty() || eventTags.containsAll(item.tags());
            return typeMatches && tagsMatch;
        }

        private final class RecordingSubscription implements Subscription {
            private final SubscribeRequest request;
            private long after;

            private RecordingSubscription(SubscribeRequest request) {
                this.request = request;
                this.after = request.after();
            }

            @Override
            public ReadResult nextBatch() {
                var selected = selectAfter(after, request.batchSize(), request.queryItems());
                selected.stream()
                        .mapToLong(UmaDbClient.SequencedStoredEvent::position)
                        .max()
                        .ifPresent(position -> after = position);
                return new ReadResult(selected);
            }

            @Override
            public void close() {
            }
        }
    }
}
