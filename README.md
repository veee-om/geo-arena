# GeoArena India by Veee

GeoArena India by Veee is a real-time multiplayer web game where players join a room, wait in a shared lobby, then guess real places in India on an interactive map.

## Tech Stack

- Node.js
- Express
- Socket.IO
- Vanilla HTML, CSS, and JavaScript
- Leaflet with OpenStreetMap tiles

## Features

- Create and join multiplayer rooms with 6-letter room codes
- Enter a custom player name before joining
- Wait in a room lobby until the host starts the round
- Real-time player sync with Socket.IO
- India-focused location rounds using live OpenStreetMap data from the Overpass API
- Distance scoring with the Haversine formula
- Live timer, leaderboard, and round results
- In-memory cache for fetched map locations
- Hardcoded fallback locations if the Overpass API is unavailable
- In-memory game state with no database required
- Ready for local use or deployment on Render

## Project Structure

```text
GeoArena/
  server.js
  package.json
  public/
    index.html
    style.css
    main.js
```

## Run Locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Render Start Note

Use these settings when creating a new Web Service on Render:

- Environment: `Node`
- Build Command: `npm install`
- Start Command: `npm start`

The app already uses `process.env.PORT`, so it is ready for Render without code changes.

## How To Play

1. Create a room or join an existing one with a 6-letter code.
2. Start the round.
3. Find the displayed India city on the map.
4. Once the host starts, click the map to place your guess and submit it.
5. Review your distance and the updated leaderboard after all players guess or the timer ends.

## Scoring

- Under 50 km: `100` points
- Under 200 km: `70` points
- 200 km or more: `30` points

## Fallback Locations

- Mumbai
- Delhi
- Bangalore
- Jaipur
- Kolkata
- Chennai
