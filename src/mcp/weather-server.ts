import { createServer } from "node:http";
import { NodeStreamableHTTPServerTransport, localhostHostValidation } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const port = Number(process.env.WEATHER_MCP_PORT ?? 3002);
const validateHost = localhostHostValidation();

type Location = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type Forecast = {
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  current_units?: Record<string, string>;
};

const weatherDescriptions: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
  55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 80: "Slight rain showers",
  81: "Moderate rain showers", 82: "Violent rain showers", 95: "Thunderstorm"
};

async function getWeather(city: string) {
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.search = new URLSearchParams({ name: city, count: "1", language: "en", format: "json" }).toString();
  const locationResponse = await fetch(geocodingUrl, { signal: AbortSignal.timeout(8_000) });
  if (!locationResponse.ok) throw new Error(`Geocoding failed with HTTP ${locationResponse.status}.`);
  const locations = await locationResponse.json() as { results?: Location[] };
  const location = locations.results?.[0];
  if (!location) throw new Error(`No location found for '${city}'.`);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    timezone: "auto"
  }).toString();
  const forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(8_000) });
  if (!forecastResponse.ok) throw new Error(`Weather lookup failed with HTTP ${forecastResponse.status}.`);
  const forecast = await forecastResponse.json() as Forecast;
  if (!forecast.current) throw new Error("Weather provider returned no current conditions.");

  return {
    city: location.name,
    region: location.admin1,
    country: location.country,
    latitude: location.latitude,
    longitude: location.longitude,
    observedAt: forecast.current.time,
    condition: weatherDescriptions[forecast.current.weather_code] ?? `Weather code ${forecast.current.weather_code}`,
    temperatureC: forecast.current.temperature_2m,
    apparentTemperatureC: forecast.current.apparent_temperature,
    humidityPercent: forecast.current.relative_humidity_2m,
    precipitationMm: forecast.current.precipitation,
    windSpeedKmh: forecast.current.wind_speed_10m,
    source: "Open-Meteo"
  };
}

function createWeatherMcpServer() {
  const server = new McpServer({ name: "airbus-intelligence-hub-weather", version: "0.1.0" });
  server.registerTool(
    "getWeather",
    {
      title: "Get current weather",
      description: "Resolve a city and return its current temperature, condition, humidity, precipitation, and wind.",
      inputSchema: z.object({ city: z.string().trim().min(2).max(100) })
    },
    async ({ city }) => {
      const weather = await getWeather(city);
      return {
        content: [{ type: "text", text: JSON.stringify(weather) }],
        structuredContent: weather
      };
    }
  );
  return server;
}

createServer(async (request, response) => {
  if (!validateHost(request, response)) return;
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ready: true, server: "airbus-intelligence-hub-weather" }));
    return;
  }
  if (request.url !== "/mcp") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found." }));
    return;
  }
  const server = createWeatherMcpServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  await server.connect(transport);
  try {
    await transport.handleRequest(request, response);
  } finally {
    await transport.close();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Weather MCP listening on http://127.0.0.1:${port}/mcp`);
});
