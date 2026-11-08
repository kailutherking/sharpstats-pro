import request from "supertest";
import { app } from "./app";

describe("HTTP API", () => {
  it.each(["/health", "/api/health"])("exposes a health check at %s", async (path) => {
    await request(app).get(path).expect(200, { status: "ok" });
  });

  it("protects private routes without access tokens", async () => {
    await request(app).get("/api/bets").expect(401);
  });

  it.each(["/api/stats/nba", "/api/stats/player/3945274?league=nba", "/api/stats/team/13?league=nba", "/api/stats/favorites"])(
    "requires authentication for %s",
    async (path) => {
      await request(app).get(path).expect(401);
    },
  );

  it.each(["/api/odds?sport=nba", "/api/odds/live", "/api/odds/movement", "/api/odds/arbitrage", "/api/odds/ev", "/api/odds/player-props", "/api/odds/sportsbooks", "/api/odds/history?sideId=abc", "/api/odds/stream", "/api/odds/alerts", "/api/odds/clv"])(
    "requires authentication for %s",
    async (path) => {
      await request(app).get(path).expect(401);
    },
  );

  it.each(["http://localhost:5175", "http://localhost:5177", "http://192.168.1.180:5175", "http://192.168.1.180:5177", "http://192.168.1.179:5175"])(
    "allows the frontend origin %s",
    async (origin) => {
      await request(app)
        .options("/api/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .expect("Access-Control-Allow-Origin", origin)
        .expect(204);
    },
  );

  it("returns JSON not-found errors for unknown routes", async () => {
    await request(app).get("/unknown").expect(404, { error: "Route not found" });
  });
});
