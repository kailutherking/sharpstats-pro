import request from "supertest";
import { app, trustProxySetting } from "./app";

describe("HTTP API", () => {
  it.each(["/health", "/api/health"])("exposes a health check at %s", async (path) => {
    await request(app).get(path).expect(200, { status: "ok", service: "sharpstats-backend" });
  });

  it("trusts one proxy hop by default and never trusts every hop", () => {
    expect(app.get("trust proxy")).toBe(1);
    expect(trustProxySetting(undefined)).toBe(1);
    expect(trustProxySetting("2")).toBe(2);
    expect(trustProxySetting("false")).toBe(false);
    expect(trustProxySetting("true")).toBe(1);
    expect(trustProxySetting("loopback, uniquelocal")).toBe("loopback, uniquelocal");
  });

  it("rate limits behind a proxy without X-Forwarded-For validation errors, keyed per client IP", async () => {
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // 30 login attempts per 15 minutes per client: one client hits the limit, another is unaffected.
      for (let i = 0; i < 30; i += 1) await request(app).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.7").send({});
      await request(app).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.7").send({}).expect(429);
      const other = await request(app).post("/api/auth/login").set("X-Forwarded-For", "198.51.100.9").send({});
      expect(other.status).not.toBe(429);
      expect(errors.mock.calls.flat().map(String).join(" ")).not.toMatch(/ERR_ERL_/);
    } finally {
      errors.mockRestore();
    }
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

  it.each(["/api/live-games?league=nba", "/api/live-games/401?league=nba", "/api/live-games/player/1?league=nba&gameId=401", "/api/injuries?league=nfl", "/api/injuries/player/1?league=nba", "/api/injuries/team/1?league=nba", "/api/injuries/impact?league=nba"])(
    "requires authentication for %s",
    async (path) => {
      await request(app).get(path).expect(401);
    },
  );

  it.each(["/api/social/me", "/api/social/feed", "/api/social/picks", "/api/social/leaderboards", "/api/social/profiles/demo", "/api/notifications", "/api/realtime/stream", "/api/live-games/401/chat?league=nba"])(
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
