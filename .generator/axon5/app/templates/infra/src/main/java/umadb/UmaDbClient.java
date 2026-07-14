package <%= rootPackage %>.infra.umadb;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public interface UmaDbClient {
    CompletableFuture<AppendResult> append(AppendRequest request);

    record AppendRequest(
            List<StoredEvent> events
    ) {
        public AppendRequest {
            events = List.copyOf(events);
        }
    }

    record AppendResult(long position) {
    }
}
