package <%= rootPackage %>.infra.umadb;

import org.axonframework.eventsourcing.eventstore.AppendCondition;
import org.axonframework.eventsourcing.eventstore.AppendEventsTransactionRejectedException;
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
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.fail;

class UmaDbEventStorageEngineTest {
    private static final Instant NOW = Instant.parse("2026-07-14T00:00:00Z");

    @Test
    void appendPassesConditionAndAggregateSequenceToUmaDb() {
        var client = new RecordingUmaDbClient();
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                3,
                stored("existing", "Order", Map.of("axon_aggregate_id", "order-1", "axon_aggregate_sequence", "4"), "Order", "order-1")
        ));
        var engine = engine(client);
        var condition = AppendCondition
                .withCriteria(EventCriteria.havingTags(Tag.of("Order", "order-1")))
                .withMarker(new GlobalIndexConsistencyMarker(3));

        engine.appendEvents(condition, null, List.of(tagged("created", "OrderCreated", "Order", "order-1"))).join();

        assertEquals(3L, client.appendRequest.condition().after());
        assertEquals(List.of("Order=order-1"), client.appendRequest.condition().failIfEventsMatch().getFirst().tags());
        var appended = client.appendRequest.events().getFirst();
        assertEquals("order-1", appended.metadata().get("axon_aggregate_id"));
        assertEquals("Order", appended.metadata().get("axon_aggregate_type"));
        assertEquals("5", appended.metadata().get("axon_aggregate_sequence"));
    }

    @Test
    void appendConditionRejectionBecomesAxonConflict() {
        var client = new RecordingUmaDbClient();
        client.appendFailure = new UmaDbAppendConditionRejectedException(new RuntimeException("conflict"));
        var engine = engine(client);
        var condition = AppendCondition.withCriteria(EventCriteria.havingTags(Tag.of("Order", "order-1")));

        var thrown = assertThrowsCompletion(() ->
                engine.appendEvents(condition, null, List.of(tagged("created", "OrderCreated", "Order", "order-1"))).join()
        );

        assertInstanceOf(AppendEventsTransactionRejectedException.class, thrown);
    }

    @Test
    void sourceAddsTrackingContextFromUmaDbPosition() {
        var client = new RecordingUmaDbClient();
        client.events.add(new UmaDbClient.SequencedStoredEvent(
                7,
                stored("stored", "OrderCreated", Map.of(), "Order", "order-1")
        ));
        var stream = engine(client).source(SourcingCondition.conditionFor(EventCriteria.havingTags(Tag.of("Order", "order-1"))));

        var entry = stream.next().orElseThrow();
        var token = TrackingToken.fromContext(entry).orElseThrow();

        assertEquals("stored", entry.message().identifier());
        assertEquals(8L, token.position().orElseThrow());
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

    private static UmaDbEventStorageEngine engine(UmaDbClient client) {
        return new UmaDbEventStorageEngine(
                UmaDbEventStorageProperties.of("localhost:50051", true, "", 16, Duration.ofSeconds(1)),
                client
        );
    }

    private static TaggedEventMessage<EventMessage> tagged(String identifier, String eventType, String tagKey, String tagValue) {
        return new TestTaggedEventMessage(event(identifier, eventType), Set.of(Tag.of(tagKey, tagValue)));
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
        private SubscribeRequest subscribeRequest;
        private RuntimeException appendFailure;

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
            return CompletableFuture.completedFuture(new ReadResult(selectAfter(request.start() - 1, request.limit(), request.queryItems())));
        }

        @Override
        public CompletableFuture<ReadResult> subscribe(SubscribeRequest request) {
            subscribeRequest = request;
            return CompletableFuture.completedFuture(new ReadResult(selectAfter(request.after(), request.batchSize(), request.queryItems())));
        }

        @Override
        public CompletableFuture<HeadResult> head() {
            var position = events.isEmpty() ? -1 : events.getLast().position();
            return CompletableFuture.completedFuture(new HeadResult(position));
        }

        private List<UmaDbClient.SequencedStoredEvent> selectAfter(long after, int limit, List<QueryItem> queryItems) {
            return events.stream()
                    .filter(event -> event.position() > after)
                    .filter(event -> matchesAny(event.event(), queryItems))
                    .limit(limit)
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
    }
}
