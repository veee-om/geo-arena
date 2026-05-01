const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const ROUND_DURATION_SECONDS = 30;
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

const FALLBACK_LOCATIONS = [
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Delhi", lat: 28.6139, lng: 77.209 },
  { name: "Bangalore", lat: 12.9716, lng: 77.5946 },
  { name: "Jaipur", lat: 26.9124, lng: 75.7873 },
  { name: "Kolkata", lat: 22.5726, lng: 88.3639 },
  { name: "Chennai", lat: 13.0827, lng: 80.2707 }
];

const rooms = {};
const locationCache = {
  locations: [],
  fetchedAt: 0,
  pending: null
};

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";

  do {
    code = Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms[code]);

  return code;
}

function createPlayer(socketId, playerNumber) {
  return {
    id: socketId,
    name: `Player ${playerNumber}`,
    score: 0,
    hasGuessed: false,
    lastDistance: null
  };
}

function getPlayersPayload(room) {
  return Object.values(room.players).map((player) => ({
    id: player.id,
    name: player.name,
    score: player.score,
    hasGuessed: player.hasGuessed
  }));
}

function getRoomJoinPayload(room, socketId) {
  return {
    roomCode: room.code,
    playerId: socketId,
    players: getPlayersPayload(room),
    round: room.round,
    hostId: room.hostId,
    gameActive: room.gameActive,
    timeLeft: room.timeLeft,
    locationName: room.currentLocation ? room.currentLocation.name : null
  };
}

function normalizePlayerName(name, fallback) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 24);
}

function createPlayerWithName(socketId, playerNumber, playerName) {
  const fallbackName = `Player ${playerNumber}`;
  return {
    ...createPlayer(socketId, playerNumber),
    name: normalizePlayerName(playerName, fallbackName)
  };
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function scoreForDistance(distanceKm) {
  if (distanceKm < 50) {
    return 100;
  }

  if (distanceKm < 200) {
    return 70;
  }

  return 30;
}

function broadcastRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) {
    return;
  }

  io.to(roomCode).emit("roomUpdate", {
    roomCode,
    players: getPlayersPayload(room),
    round: room.round,
    hostId: room.hostId,
    gameActive: room.gameActive
  });
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

async function fetchIndiaLocations() {
  const cacheIsFresh =
    locationCache.locations.length > 0 &&
    Date.now() - locationCache.fetchedAt < LOCATION_CACHE_TTL_MS;

  if (cacheIsFresh) {
    return locationCache.locations;
  }

  if (locationCache.pending) {
    return locationCache.pending;
  }

  const query = `
    [out:json][timeout:25];
    area["name"="India"]["boundary"="administrative"]["admin_level"="2"]->.searchArea;
    (
      node["place"="city"](area.searchArea);
      node["place"="town"](area.searchArea);
    );
    out body;
  `;

  locationCache.pending = fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: `data=${encodeURIComponent(query)}`
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Overpass request failed with status ${response.status}`);
      }

      const data = await response.json();
      const seen = new Set();
      const parsedLocations = (data.elements || [])
        .filter((element) => {
          return (
            element &&
            typeof element.lat === "number" &&
            typeof element.lon === "number" &&
            element.tags &&
            typeof element.tags.name === "string" &&
            (element.tags.place === "city" || element.tags.place === "town")
          );
        })
        .map((element) => ({
          name: element.tags.name,
          lat: element.lat,
          lng: element.lon
        }))
        .filter((location) => {
          const key = `${location.name}:${location.lat}:${location.lng}`;
          if (seen.has(key)) {
            return false;
          }

          seen.add(key);
          return true;
        });

      if (parsedLocations.length === 0) {
        throw new Error("Overpass returned no usable India locations.");
      }

      locationCache.locations = parsedLocations;
      locationCache.fetchedAt = Date.now();
      return parsedLocations;
    })
    .finally(() => {
      locationCache.pending = null;
    });

  return locationCache.pending;
}

async function getRoundLocation() {
  try {
    const locations = await fetchIndiaLocations();
    return locations[Math.floor(Math.random() * locations.length)];
  } catch (error) {
    console.error("Falling back to hardcoded locations:", error.message);
    return FALLBACK_LOCATIONS[Math.floor(Math.random() * FALLBACK_LOCATIONS.length)];
  }
}

function finishRound(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.currentLocation) {
    return;
  }

  clearRoomTimer(room);

  const leaderboard = Object.values(room.players)
    .map((player) => {
      const guess = room.guesses[player.id];
      const distance = guess
        ? haversineDistance(
            room.currentLocation.lat,
            room.currentLocation.lng,
            guess.lat,
            guess.lng
          )
        : null;

      const roundedDistance = distance === null ? null : Number(distance.toFixed(1));
      const roundScore = distance === null ? 0 : scoreForDistance(distance);

      player.score += roundScore;
      player.lastDistance = roundedDistance;
      player.hasGuessed = false;

      return {
        id: player.id,
        name: player.name,
        score: player.score,
        roundScore,
        distance: roundedDistance
      };
    })
    .sort((a, b) => b.score - a.score);

  room.guesses = {};
  room.gameActive = false;
  room.timeLeft = 0;

  io.to(roomCode).emit("roundResults", {
    location: room.currentLocation,
    leaderboard,
    round: room.round
  });

  broadcastRoomState(roomCode);
}

async function startRound(roomCode) {
  const room = rooms[roomCode];
  if (!room || Object.keys(room.players).length === 0) {
    return;
  }

  clearRoomTimer(room);

  room.round += 1;
  room.currentLocation = await getRoundLocation();
  room.guesses = {};
  room.gameActive = true;
  room.timeLeft = ROUND_DURATION_SECONDS;

  Object.values(room.players).forEach((player) => {
    player.hasGuessed = false;
    player.lastDistance = null;
  });

  io.to(roomCode).emit("gameStarted", {
    round: room.round,
    locationName: room.currentLocation.name,
    timer: room.timeLeft,
    players: getPlayersPayload(room)
  });

  broadcastRoomState(roomCode);

  room.timer = setInterval(() => {
    const activeRoom = rooms[roomCode];
    if (!activeRoom || !activeRoom.gameActive) {
      clearRoomTimer(room);
      return;
    }

    activeRoom.timeLeft -= 1;
    io.to(roomCode).emit("timerUpdate", { timeLeft: activeRoom.timeLeft });

    if (activeRoom.timeLeft <= 0) {
      finishRound(roomCode);
    }
  }, 1000);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ playerName }) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      hostId: socket.id,
      players: {},
      guesses: {},
      round: 0,
      currentLocation: null,
      gameActive: false,
      timeLeft: ROUND_DURATION_SECONDS,
      timer: null
    };

    const player = createPlayerWithName(socket.id, 1, playerName);
    room.players[socket.id] = player;
    rooms[roomCode] = room;

    socket.join(roomCode);

    socket.emit("roomJoined", getRoomJoinPayload(room, socket.id));

    broadcastRoomState(roomCode);
  });

  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const normalizedCode = String(roomCode || "").trim().toUpperCase();
    const room = rooms[normalizedCode];

    if (!room) {
      socket.emit("errorMessage", "Room not found. Check the code and try again.");
      return;
    }

    if (room.gameActive) {
      socket.emit("errorMessage", "A round is already active. Join after this round ends.");
      return;
    }

    const player = createPlayerWithName(
      socket.id,
      Object.keys(room.players).length + 1,
      playerName
    );
    room.players[socket.id] = player;

    socket.join(normalizedCode);

    socket.emit("roomJoined", getRoomJoinPayload(room, socket.id));

    broadcastRoomState(normalizedCode);
  });

  socket.on("startGame", async ({ roomCode }) => {
    const normalizedCode = String(roomCode || "").trim().toUpperCase();
    const room = rooms[normalizedCode];

    if (!room) {
      socket.emit("errorMessage", "Unable to start the game because the room no longer exists.");
      return;
    }

    if (room.gameActive) {
      socket.emit("errorMessage", "This round is already in progress.");
      return;
    }

    if (!room.players[socket.id]) {
      socket.emit("errorMessage", "You are not a member of this room.");
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit("errorMessage", "Only the room host can start the game.");
      return;
    }

    await startRound(normalizedCode);
  });

  socket.on("submitGuess", ({ roomCode, lat, lng }) => {
    const normalizedCode = String(roomCode || "").trim().toUpperCase();
    const room = rooms[normalizedCode];

    if (!room || !room.gameActive) {
      socket.emit("errorMessage", "There is no active round right now.");
      return;
    }

    const player = room.players[socket.id];
    if (!player) {
      socket.emit("errorMessage", "You are not a member of this room.");
      return;
    }

    if (player.hasGuessed) {
      socket.emit("errorMessage", "You already submitted a guess for this round.");
      return;
    }

    room.guesses[socket.id] = { lat, lng };
    player.hasGuessed = true;

    socket.emit("guessLocked");
    broadcastRoomState(normalizedCode);

    const everyoneGuessed = Object.values(room.players).every((roomPlayer) => roomPlayer.hasGuessed);
    if (everyoneGuessed) {
      finishRound(normalizedCode);
    }
  });

  socket.on("disconnect", () => {
    Object.keys(rooms).forEach((roomCode) => {
      const room = rooms[roomCode];
      if (!room.players[socket.id]) {
        return;
      }

      delete room.players[socket.id];
      delete room.guesses[socket.id];

      if (Object.keys(room.players).length === 0) {
        clearRoomTimer(room);
        delete rooms[roomCode];
        return;
      }

      if (room.hostId === socket.id) {
        room.hostId = Object.keys(room.players)[0];
      }

      if (room.gameActive) {
        const everyoneGuessed = Object.values(room.players).every((player) => player.hasGuessed);
        if (everyoneGuessed) {
          finishRound(roomCode);
          return;
        }
      }

      broadcastRoomState(roomCode);
    });
  });
});

server.listen(PORT, () => {
  console.log(`GeoArena listening on port ${PORT}`);
});
