let registered = false;

export async function register() {
  if (
    !registered &&
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  ) {
    registered = true;
    const { useAzureMonitor: configureAzureMonitor } =
      await import("@azure/monitor-opentelemetry");
    const { getAzureCredential } = await import("@/lib/azure-credential");
    const samplingRatio = Number(
      process.env.APPLICATIONINSIGHTS_SAMPLING_RATIO ?? "1"
    );
    configureAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
        credential: getAzureCredential()
      },
      samplingRatio:
        Number.isFinite(samplingRatio) && samplingRatio > 0 && samplingRatio <= 1
          ? samplingRatio
          : 1,
      enableLiveMetrics: false
    });
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        severity: "info",
        event: "telemetry_initialized",
        service: "norautron-web"
      })
    );
  }
}
