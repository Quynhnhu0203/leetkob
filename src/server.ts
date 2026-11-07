import { buildApp } from "./app.js";
import { InMemoryStore } from "./store.js";

const port = Number(process.env.PORT ?? 3000);
const app = buildApp({ store: new InMemoryStore(), logger: true });

app.listen({ port, host: "0.0.0.0" }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
