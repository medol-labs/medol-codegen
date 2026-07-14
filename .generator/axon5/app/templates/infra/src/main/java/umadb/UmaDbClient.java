package <%= rootPackage %>.infra.umadb;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public interface UmaDbClient {
    CompletableFuture<AppendResult> append(AppendRequest request);

    CompletableFuture<ReadResult> read(ReadRequest request);

    CompletableFuture<ReadResult> subscribe(SubscribeRequest request);

    CompletableFuture<HeadResult> head();

    record AppendRequest(
            List<StoredEvent> events,
            AppendCondition condition
    ) {
        public AppendRequest {
            events = List.copyOf(events);
        }
    }

    record AppendCondition(
            List<QueryItem> failIfEventsMatch,
            Long after
    ) {
        public AppendCondition {
            failIfEventsMatch = List.copyOf(failIfEventsMatch);
        }
    }

    record AppendResult(long position) {
    }

    record ReadRequest(
            long start,
            int limit,
            List<QueryItem> queryItems
    ) {
        public ReadRequest {
            queryItems = List.copyOf(queryItems);
        }
    }

    record QueryItem(
            List<String> types,
            List<String> tags
    ) {
        public QueryItem {
            types = List.copyOf(types);
            tags = List.copyOf(tags);
        }
    }

    record ReadResult(
            List<SequencedStoredEvent> events
    ) {
        public ReadResult {
            events = List.copyOf(events);
        }
    }

    record SequencedStoredEvent(
            long position,
            StoredEvent event
    ) {
    }

    record HeadResult(long position) {
    }

    record SubscribeRequest(
            long after,
            int batchSize,
            List<QueryItem> queryItems
    ) {
        public SubscribeRequest {
            queryItems = List.copyOf(queryItems);
        }
    }
}
