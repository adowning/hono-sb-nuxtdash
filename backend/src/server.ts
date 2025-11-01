import { showRoutes } from "hono/dev";
import app from "./app";
import { startManufacturedGameplay } from "./modules/gameplay/bot.service";

const port = 3000;

// serve({
// 	fetch: app.fetch,
// 	port,
// });

showRoutes(app);
const server = Bun.serve({
  port,
  async fetch(req, server)
  {
    console.log(req.url);
    return app.fetch(req, server);
  },
  //   websocket: wsRouter.websocket,
});
showRoutes(app);
console.log(`Server is running on port - ${server.port}`);
startManufacturedGameplay()