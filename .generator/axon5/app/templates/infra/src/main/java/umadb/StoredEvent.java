package <%= rootPackage %>.infra.umadb;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record StoredEvent(
        String eventIdentifier,
        String eventType,
        Instant timestamp,
        Map<String, Object> metadata,
        Object payload,
        List<StoredEventTag> tags
) {
    public StoredEvent {
        metadata = Map.copyOf(metadata);
        tags = List.copyOf(tags);
    }
}
