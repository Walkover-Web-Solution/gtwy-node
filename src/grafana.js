import Pyroscope from "@pyroscope/nodejs";

// Guarded: on some local Node versions the native profiler binding crashes
// on start (unrelated to app logic), which otherwise takes the whole server
// down before it can even boot.
try {
  Pyroscope.init({
    serverAddress: "http://alloy.observability.svc.cluster.local:9999",
    appName: process.env.OTEL_SERVICE_NAME,
    tags: {
      env: process.env.ENVIRONMENT,
      service_name: process.env.OTEL_SERVICE_NAME,
      service_type: "api"
    }
  });

  Pyroscope.start();
} catch (error) {
  console.error("Pyroscope profiler failed to start, continuing without it:", error?.message);
}
