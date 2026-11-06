package app.flexible.calendar;

import android.app.job.*;

public final class SyncJobService extends JobService {
    private final java.util.Set<JobParameters> active=java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());
    @Override public boolean onStartJob(JobParameters parameters){active.add(parameters);SyncCoordinator.requestWithResult(this,parameters.getExtras().getBoolean("manual",false),(success,retryable)->{if(active.remove(parameters))jobFinished(parameters,retryable);});return true;}
    @Override public boolean onStopJob(JobParameters parameters){active.remove(parameters);if(active.isEmpty())SyncCoordinator.cancelBackgroundWork();return true;}
    @Override public void onDestroy(){active.clear();SyncCoordinator.cancelBackgroundWork();super.onDestroy();}
}
