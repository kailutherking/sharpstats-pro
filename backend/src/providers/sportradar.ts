export async function getSportradarSchedule(): Promise<unknown> {
  const key = process.env.SPORTRADAR_API_KEY;
  if (!key) return [];
  const response = await fetch(
    `https://api.sportradar.com/nba/trial/v8/en/games/2025/REG/schedule.json?api_key=${encodeURIComponent(key)}`,
  );
  if (!response.ok) throw new Error(`Sportradar schedule request failed (${response.status})`);
  return response.json();
}
