import { writeFileSync } from "node:fs";
const ns = "campus";
const resources = [
  { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } },
  {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "local-config", namespace: ns },
    type: "Opaque",
    stringData: {
      INTERNAL_KEY: "local-development-only",
      DEMO_PASSWORD: "Campus2026!",
    },
  },
];
const add = (o) => resources.push(o);
const meta = (name) => ({ name, namespace: ns });
function service(name, port) {
  add({
    apiVersion: "v1",
    kind: "Service",
    metadata: meta(name),
    spec: { selector: { app: name }, ports: [{ port, targetPort: port }] },
  });
}
for (const name of ["identity", "booking"]) {
  const app = name + "-db";
  add({
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: meta(app),
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "1Gi" } },
    },
  });
  add({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: meta(app),
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app } },
      template: {
        metadata: { labels: { app } },
        spec: {
          containers: [
            {
              name: "postgres",
              image: "postgres:17-alpine",
              env: [
                { name: "POSTGRES_DB", value: name },
                { name: "POSTGRES_USER", value: "campus" },
                { name: "POSTGRES_PASSWORD", value: "campus-local" },
              ],
              ports: [{ containerPort: 5432 }],
              volumeMounts: [
                { name: "data", mountPath: "/var/lib/postgresql/data" },
              ],
              readinessProbe: {
                exec: { command: ["pg_isready", "-U", "campus", "-d", name] },
                periodSeconds: 3,
              },
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { memory: "512Mi" },
              },
            },
          ],
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: app } },
          ],
        },
      },
    },
  });
  service(app, 5432);
}
for (const [name, port] of [
  ["identity", 3001],
  ["booking", 3002],
  ["gateway", 3000],
]) {
  const env = {
    PORT: String(port),
    IDENTITY_URL: "http://identity:3001",
    BOOKING_URL: "http://booking:3002",
    SEED_DEMO: "true",
  };
  if (name !== "gateway")
    env.DATABASE_URL = `postgresql://campus:campus-local@${name}-db:5432/${name}`;
  const container = {
    name,
    image: "campus-booking:local",
    imagePullPolicy: "IfNotPresent",
    command: ["node", `dist/server/${name}.js`],
    env: Object.entries(env).map(([name, value]) => ({ name, value })),
    envFrom: [{ secretRef: { name: "local-config" } }],
    ports: [{ containerPort: port }],
    readinessProbe: { httpGet: { path: "/health", port }, periodSeconds: 5 },
    livenessProbe: {
      httpGet: { path: "/health", port },
      initialDelaySeconds: 30,
      periodSeconds: 10,
    },
    resources: {
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { memory: "512Mi" },
    },
  };
  add({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: meta(name),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: { containers: [container] },
      },
    },
  });
  service(name, port);
}
// JSON is valid YAML and can be applied directly by kubectl.
writeFileSync(
  "infra/local.yaml",
  JSON.stringify(
    { apiVersion: "v1", kind: "List", items: resources },
    null,
    2,
  ) + "\n",
);
console.log("Generated infra/local.yaml");
