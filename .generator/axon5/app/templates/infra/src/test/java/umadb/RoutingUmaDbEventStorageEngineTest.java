package <%= rootPackage %>.infra.umadb;

import org.axonframework.eventsourcing.eventstore.*;
import org.axonframework.messaging.core.MessageType;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.GenericEventMessage;
import org.axonframework.messaging.eventstreaming.*;
import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import static org.junit.jupiter.api.Assertions.*;

class RoutingUmaDbEventStorageEngineTest {
    private static final class Client implements UmaDbClient {
        final List<SequencedStoredEvent> events = new ArrayList<>();
        int reads;
        boolean unavailable;
        public CompletableFuture<AppendResult> append(AppendRequest request) {
            for (var event : request.events()) events.add(new SequencedStoredEvent(events.size(), event));
            return CompletableFuture.completedFuture(new AppendResult(events.size() - 1));
        }
        public CompletableFuture<ReadResult> read(ReadRequest request) { reads++; return CompletableFuture.completedFuture(new ReadResult(events)); }
        public CompletableFuture<HeadResult> head() { return unavailable ? CompletableFuture.failedFuture(new IllegalStateException("store unavailable")) : CompletableFuture.completedFuture(new HeadResult(events.size() - 1)); }
        public Subscription openSubscription(SubscribeRequest request) { throw new UnsupportedOperationException(); }
    }
    private record Tagged(EventMessage event, Set<Tag> tags) implements TaggedEventMessage<EventMessage> {
        public TaggedEventMessage<EventMessage> updateTags(Function<Set<Tag>, Set<Tag>> updater) { return new Tagged(event, updater.apply(tags)); }
    }
    private static Tagged event(String tenant) {
        return new Tagged(new GenericEventMessage(new MessageType("test-event"), "payload"), Set.of(Tag.of("__medol_tenant", tenant), Tag.of("recordId", "same-id")));
    }
    private static EventCriteria criteria(String tenant) { return EventCriteria.havingTags(Tag.of("__medol_tenant", tenant), Tag.of("recordId", "same-id")); }
    private static UmaDbEventStorageEngine engine(Client client) {
        return new UmaDbEventStorageEngine(UmaDbEventStorageProperties.of("test", true, "", 10, Duration.ofSeconds(1)), client);
    }
    private static RoutingUmaDbEventStorageEngine router(Client a, Client b) {
        return new RoutingUmaDbEventStorageEngine(Map.of("default", engine(new Client()), "a", engine(a), "b", engine(b)),
            tenant -> new RoutingUmaDbEventStorageEngine.Route(tenant, tenant + "-v1"));
    }
    private static <R> ConsistencyMarker commit(EventStorageEngine.AppendTransaction<R> transaction) {
        return transaction.afterCommit(transaction.commit().join()).join();
    }
    private static ConsistencyMarker marker(RoutingUmaDbEventStorageEngine engine, String tenant) {
        return engine.source(SourcingCondition.conditionFor(criteria(tenant))).reduce(ConsistencyMarker.ORIGIN,
            (previous, entry) -> entry.containsResource(ConsistencyMarker.RESOURCE_KEY) ? entry.getResource(ConsistencyMarker.RESOURCE_KEY) : previous).join();
    }

    @Test
    void sameBusinessIdIsAppendedToAndSourcedFromSeparateStores() {
        var a = new Client(); var b = new Client(); var router = router(a, b);
        for (var tenant : List.of("a", "b")) {
            commit(router.appendEvents(AppendCondition.withCriteria(criteria(tenant)).withMarker(marker(router, tenant)), null, List.of(event(tenant))).join());
        }
        assertEquals(1, a.events.size()); assertEquals(1, b.events.size());
        int before = b.reads;
        marker(router, "a");
        assertEquals(before, b.reads);
    }

    @Test
    void unconditionalTenantAppendsRouteFromEventTagsWithoutAnArtificialControlCondition() {
        var a = new Client(); var b = new Client(); var router = router(a, b);
        commit(router.appendEvents(AppendCondition.none(), null, List.of(event("a"))).join());
        assertEquals(1, a.events.size()); assertTrue(b.events.isEmpty());
    }

    @Test
    void mixedAppendAndCrossSourceMarkersAreRejectedBeforeAnyWrite() {
        var a = new Client(); var b = new Client(); var router = router(a, b);
        var markerA = marker(router, "a");
        assertThrows(IllegalArgumentException.class, () -> router.appendEvents(AppendCondition.withCriteria(criteria("b")).withMarker(markerA), null, List.of(event("b"))));
        assertThrows(IllegalArgumentException.class, () -> router.appendEvents(AppendCondition.none(), null, List.of(event("a"), event("b"))));
        assertThrows(IllegalArgumentException.class, () -> router.source(SourcingCondition.conditionFor(EventCriteria.either(criteria("a"), criteria("b")))));
        assertTrue(a.events.isEmpty()); assertTrue(b.events.isEmpty());
    }

    @Test
    void unknownBindingsAndUnscopedPositionsNeverFallBackToDefault() {
        var router = router(new Client(), new Client());
        assertThrows(IllegalArgumentException.class, () -> router.source(SourcingCondition.conditionFor(criteria("unknown"))));
        assertThrows(IllegalArgumentException.class, () -> router.source(SourcingCondition.conditionFor(new GlobalIndexPosition(100), criteria("a"))));
        assertThrows(java.util.concurrent.CompletionException.class, () -> router.firstToken().join());
    }

    @Test
    void aFailedSourceDoesNotFallBackOrPreventAnotherSourceFromWriting() {
        var a = new Client(); var b = new Client(); var router = router(a, b);
        a.unavailable = true;
        assertThrows(java.util.concurrent.CompletionException.class, () -> marker(router, "a"));
        commit(router.appendEvents(AppendCondition.withCriteria(criteria("b")).withMarker(marker(router, "b")), null, List.of(event("b"))).join());
        assertTrue(a.events.isEmpty()); assertEquals(1, b.events.size());
    }

    @Test
    void aBindingVersionChangeInvalidatesThePreviouslyReadMarker() {
        var version = new java.util.concurrent.atomic.AtomicReference<>("v1");
        var router = new RoutingUmaDbEventStorageEngine(Map.of("default", engine(new Client()), "a", engine(new Client())),
            tenant -> new RoutingUmaDbEventStorageEngine.Route("a", version.get()));
        var previous = marker(router, "a");
        version.set("v2");
        assertThrows(IllegalArgumentException.class, () -> router.appendEvents(AppendCondition.withCriteria(criteria("a")).withMarker(previous), null, List.of(event("a"))));
    }
}
