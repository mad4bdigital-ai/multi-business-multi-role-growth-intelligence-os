import assert from "node:assert/strict";
import {
  buildDefaultLocalAppRoutes,
  buildUserDeviceRoute,
  toCloudflareIngressRoutes,
  upsertIngressRoutes,
} from "./routes/localConnectorInstallRoutes.js";

const route = buildUserDeviceRoute({
  userId: "User_123",
  deviceId: "Office Laptop",
});

assert.equal(route.hostname, "user-123-office-laptop.connector.mad4b.com");
assert.equal(route.recordName, "user-123-office-laptop.connector");

assert.throws(
  () => buildUserDeviceRoute({
    userId: "user",
    deviceId: "device",
    requestedHostname: "bad.example.com",
  }),
  /hostname must end/
);

const appRoutes = buildDefaultLocalAppRoutes({
  hostname: route.hostname,
  localApps: [{ app_key: "webbrowsing", local_port: 9333, status: "active" }],
});

assert.deepEqual(
  appRoutes.map((appRoute) => appRoute.app_key),
  ["connector", "n8n", "browser", "webbrowsing"]
);
assert.equal(appRoutes.find((appRoute) => appRoute.app_key === "connector").status, "active");
assert.equal(appRoutes.find((appRoute) => appRoute.app_key === "n8n").public_url, `https://${route.hostname}/n8n`);
assert.equal(appRoutes.find((appRoute) => appRoute.app_key === "browser").status, "planned");

const ingressRoutes = toCloudflareIngressRoutes(appRoutes);
assert.deepEqual(
  ingressRoutes.map((entry) => [entry.hostname, entry.path, entry.service]),
  [
    [route.hostname, "", "http://localhost:7070"],
    [route.hostname, "/webbrowsing*", "http://localhost:9333"],
  ]
);

const mergedIngress = upsertIngressRoutes(
  [
    { hostname: "keep.connector.mad4b.com", service: "http://localhost:7070" },
    { service: "http_status:404" },
  ],
  ingressRoutes
);

assert.equal(mergedIngress.at(-1).service, "http_status:404");
assert(mergedIngress.some((entry) => entry.hostname === "keep.connector.mad4b.com"));
assert(mergedIngress.some((entry) => entry.hostname === route.hostname && entry.service === "http://localhost:7070"));
assert(mergedIngress.some((entry) => entry.hostname === route.hostname && entry.path === "/webbrowsing*"));

console.log("test-local-connector-provisioning: ok");
