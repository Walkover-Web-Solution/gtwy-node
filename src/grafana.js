import Pyroscope from "@pyroscope/nodejs";

Pyroscope.init({
  serverAddress: "http://alloy.observability.svc.cluster.local:9999",
  appName: process.env.OTEL_SERVICE_NAME,
  tags: {
    env: process.env.ENVIROMENT,
    service_name: process.env.OTEL_SERVICE_NAME,
    service_type: "api"
  }
});

Pyroscope.start();
