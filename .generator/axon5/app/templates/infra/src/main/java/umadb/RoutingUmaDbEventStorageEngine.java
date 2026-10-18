package <%= rootPackage %>.infra.umadb;

import org.axonframework.common.infra.ComponentDescriptor;
import org.axonframework.eventsourcing.eventstore.*;
import org.axonframework.messaging.core.*;
import org.axonframework.messaging.core.unitofwork.ProcessingContext;
import org.axonframework.messaging.eventhandling.EventMessage;
import org.axonframework.messaging.eventhandling.processing.streaming.token.TrackingToken;
import org.axonframework.messaging.eventstreaming.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

public final class RoutingUmaDbEventStorageEngine implements EventStorageEngine {
    public static final String SOURCE = "medol.eventSource";
    public record Route(String source, String binding) { }
    private static final Context.ResourceKey<Route> PIN = Context.ResourceKey.withLabel("medol.eventStoreBinding");
    private final Map<String, EventStorageEngine> engines;
    private final Function<String, Route> resolver;

    public RoutingUmaDbEventStorageEngine(Map<String, EventStorageEngine> engines, Function<String, Route> resolver) {
        this.engines = Map.copyOf(engines);
        this.resolver = resolver;
        if (!engines.containsKey("default")) throw new IllegalArgumentException("A control event store is required.");
    }

    private Route route(Set<Tag> tags) {
        var tenants = tags.stream().filter(tag -> tag.key().equals("__medol_tenant")).map(Tag::value).distinct().toList();
        if (tenants.size() > 1) throw new IllegalArgumentException("An event cannot belong to multiple tenants.");
        var result = tenants.isEmpty() ? new Route("default", "control") : resolver.apply(tenants.getFirst());
        if (!engines.containsKey(result.source())) throw new IllegalArgumentException("Unknown tenant event store.");
        return result;
    }

    private Route route(EventsCondition condition) {
        var routes = condition.criteria().flatten().stream().map(item -> route(item.tags())).distinct().toList();
        if (routes.size() > 1) throw new IllegalArgumentException("An atomic state query cannot span tenant storage bindings.");
        return routes.isEmpty() ? new Route("default", "control") : routes.getFirst();
    }

    @Override
    public MessageStream<EventMessage> source(SourcingCondition condition) {
        var route = route(condition);
        var position = condition.start();
        if (position != Position.START && GlobalIndexPosition.toIndex(position) > 0) {
            throw new IllegalArgumentException("An unscoped position cannot address a physical event store.");
        }
        return engines.get(route.source()).source(SourcingCondition.conditionFor(position, condition.criteria())).map(entry -> {
            var marker = entry.getResource(ConsistencyMarker.RESOURCE_KEY);
            return marker == null ? entry : entry.withResource(ConsistencyMarker.RESOURCE_KEY, new SourceMarker(route, marker));
        });
    }

    @Override
    public CompletableFuture<AppendTransaction<?>> appendEvents(AppendCondition condition, ProcessingContext context, List<TaggedEventMessage<?>> events) {
        if (events.isEmpty()) throw new IllegalArgumentException("A routed append requires events.");
        var routes = events.stream().map(event -> route(event.tags())).distinct().toList();
        if (routes.size() != 1) throw new IllegalArgumentException("An atomic append cannot span tenant storage bindings.");
        var route = routes.getFirst();
        if (context != null) requireRoute(route, context.computeResourceIfAbsent(PIN, () -> route));
        var marker = condition.consistencyMarker();
        if (marker instanceof SourceMarker scoped) {
            requireRoute(route, scoped.route());
            condition = condition.withMarker(scoped.delegate());
        } else if (marker != ConsistencyMarker.ORIGIN && marker != ConsistencyMarker.INFINITY) {
            throw new IllegalArgumentException("A physical append requires a source-bound consistency marker.");
        }
        if (condition.consistencyMarker() != ConsistencyMarker.INFINITY && !condition.criteria().flatten().isEmpty()) requireRoute(route, route(condition));
        return engines.get(route.source()).appendEvents(condition, context, events).thenApply(tx -> wrap(tx, route));
    }

    private static <R> AppendTransaction<R> wrap(AppendTransaction<R> tx, Route route) {
        return new AppendTransaction<>() {
            public CompletableFuture<R> commit() { return tx.commit(); }
            public void rollback() { tx.rollback(); }
            public CompletableFuture<ConsistencyMarker> afterCommit(R result) {
                return tx.afterCommit(result).thenApply(marker -> new SourceMarker(route, marker));
            }
        };
    }

    public StreamableEventSource eventSource(String source, String identity) {
        var engine = Objects.requireNonNull(engines.get(source));
        return new StreamableEventSource() {
            public CompletableFuture<TrackingToken> firstToken(ProcessingContext context) { return engine.firstToken(); }
            public CompletableFuture<TrackingToken> latestToken(ProcessingContext context) { return engine.latestToken(); }
            public CompletableFuture<TrackingToken> tokenAt(Instant instant, ProcessingContext context) { return engine.tokenAt(instant); }
            public MessageStream<EventMessage> open(StreamingCondition condition, ProcessingContext context) {
                return engine.stream(condition).map(entry -> {
                    var message = entry.message();
                    var tags = Objects.requireNonNull(entry.getResource(UmaDbEventStorageEngine.STORED_TAGS), "Stored event tags are required.");
                    var tenants = tags.stream().filter(tag -> tag.key().equals("__medol_tenant")).map(Tag::value).distinct().toList();
                    if (tenants.size() > 1) throw new IllegalStateException("Conflicting tenant tags in stored event.");
                    var tenant = tenants.isEmpty() ? null : tenants.getFirst();
                    if (tenant == null && !source.equals("default")) throw new IllegalStateException("An unscoped event was found in a tenant event store.");
                    if (tenant != null && !resolver.apply(tenant).source().equals(source)) throw new IllegalStateException("Event tenant does not belong to this event store.");
                    var metadata = new HashMap<>(message.metadata());
                    metadata.put(SOURCE, identity);
                    if (tenant == null) metadata.remove("tenantId"); else metadata.put("tenantId", tenant);
                    return entry.map(event -> event.withMetadata(metadata));
                });
            }
        };
    }

    private static void requireRoute(Route expected, Route actual) {
        if (!expected.equals(actual)) throw new IllegalArgumentException("Event storage binding changed or consistency marker belongs to another source.");
    }

    private record SourceMarker(Route route, ConsistencyMarker delegate) implements ConsistencyMarker {
        private ConsistencyMarker unwrap(ConsistencyMarker other) {
            if (other == ORIGIN || other == INFINITY) return other;
            if (!(other instanceof SourceMarker scoped)) throw new IllegalArgumentException("Unscoped consistency marker.");
            requireRoute(route, scoped.route()); return scoped.delegate();
        }
        public ConsistencyMarker lowerBound(ConsistencyMarker other) { return new SourceMarker(route, delegate.lowerBound(unwrap(other))); }
        public ConsistencyMarker upperBound(ConsistencyMarker other) { return new SourceMarker(route, delegate.upperBound(unwrap(other))); }
        public Position position() { return delegate.position(); }
    }

    public MessageStream<EventMessage> stream(StreamingCondition condition) { throw new IllegalStateException("A physical processor must bind an explicit event source."); }
    public CompletableFuture<TrackingToken> firstToken() { return CompletableFuture.failedFuture(new IllegalStateException("Bind an explicit event source.")); }
    public CompletableFuture<TrackingToken> latestToken() { return firstToken(); }
    public CompletableFuture<TrackingToken> tokenAt(Instant instant) { return firstToken(); }
    public void describeTo(ComponentDescriptor descriptor) { descriptor.describeProperty("type", "RoutingUmaDbEventStorageEngine"); }
}
