import request from "supertest";
import { app } from "./app";

describe("HTTP API", () => {
  it("exposes a health check", async () => {
    await request(app).get("/api/health").expect(200, { status: "ok" });
  });

  it("protects private routes without access tokens", async () => {
    await request(app).get("/api/bets").expect(401);
  });

  it("returns JSON not-found errors for unknown routes", async () => {
    await request(app).get("/unknown").expect(404, { error: "Route not found" });
  });
});
