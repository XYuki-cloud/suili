package app.flexible.calendar;

import java.util.List;

public interface SyncTransport {
    List<Core.Op> exchange(List<Core.Op> local) throws Exception;
    default void cancel() {}
}
