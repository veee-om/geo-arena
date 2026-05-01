const socket = io(window.location.origin);

const screens = {
  lobby: document.getElementById("lobby-screen"),
  room: document.getElementById("room-screen"),
  game: document.getElementById("game-screen"),
  results: document.getElementById("results-screen")
};

const statusMessage = document.getElementById("status-message");
const playerNameInput = document.getElementById("player-name-input");
const roomCodeInput = document.getElementById("room-code-input");
const roomCodeBig = document.getElementById("room-code-big");
const roomPlayerList = document.getElementById("room-player-list");
const roomWaitingText = document.getElementById("room-waiting-text");
const roomStartBtn = document.getElementById("room-start-btn");
const roomHostNote = document.getElementById("room-host-note");
const roomCodeLabel = document.getElementById("room-code-label");
const roundLabel = document.getElementById("round-label");
const promptLabel = document.getElementById("prompt-label");
const timerDisplay = document.getElementById("timer-display");
const playerList = document.getElementById("player-list");
const guessStatus = document.getElementById("guess-status");
const submitGuessBtn = document.getElementById("submit-guess-btn");
const leaderboard = document.getElementById("leaderboard");
const resultLocation = document.getElementById("result-location");
const distanceLabel = document.getElementById("distance-label");
const nextRoundBtn = document.getElementById("next-round-btn");
const resultsHostNote = document.getElementById("results-host-note");

let map;
let guessMarker = null;
let resultMarker = null;
let roomCode = "";
let playerId = "";
let selectedGuess = null;
let roundActive = false;
let hostId = "";

function getPlayerName() {
  return playerNameInput.value.trim();
}

function showScreen(screenName) {
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[screenName].classList.add("active");
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#c44536" : "#2f9e67";
}

function initializeMap() {
  map = L.map("map", {
    zoomControl: true
  }).setView([22.9734, 78.6569], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  map.on("click", (event) => {
    if (!roundActive) {
      guessStatus.textContent = "Wait for the next round to start before placing a guess.";
      return;
    }

    selectedGuess = event.latlng;

    if (!guessMarker) {
      guessMarker = L.marker(event.latlng).addTo(map);
    } else {
      guessMarker.setLatLng(event.latlng);
    }

    guessStatus.textContent = `Selected guess: ${event.latlng.lat.toFixed(3)}, ${event.latlng.lng.toFixed(3)}`;
    submitGuessBtn.disabled = false;
  });
}

function createPlayerCard(player) {
  const card = document.createElement("div");
  card.className = "player-card";

  if (player.id === playerId) {
    card.classList.add("current");
  }

  if (player.hasGuessed) {
    card.classList.add("guessed");
  }

  const status = player.hasGuessed ? "Guessed" : "Waiting";
  card.innerHTML = `
    <div>
      <strong>${player.name}${player.id === playerId ? " (You)" : ""}</strong>
      <small>${status}</small>
    </div>
    <span>${player.score} pts</span>
  `;

  return card;
}

function updateHostControls() {
  const isHost = hostId === playerId;
  roomStartBtn.style.display = isHost ? "inline-flex" : "none";
  nextRoundBtn.style.display = isHost ? "inline-flex" : "none";
  roomHostNote.textContent = isHost
    ? "You are the host. Start when everyone has joined."
    : "Waiting for the host to start the game.";
  resultsHostNote.textContent = isHost
    ? "You can start the next round when everyone is ready."
    : "Waiting for the host to start the next round.";
}

function renderPlayers(players) {
  playerList.innerHTML = "";
  roomPlayerList.innerHTML = "";

  players.forEach((player) => {
    playerList.appendChild(createPlayerCard(player));
    roomPlayerList.appendChild(createPlayerCard(player));
  });
}

function setInlineMessage(message) {
  if (screens.room.classList.contains("active")) {
    roomHostNote.textContent = message;
    return;
  }

  if (screens.results.classList.contains("active")) {
    resultsHostNote.textContent = message;
    return;
  }

  guessStatus.textContent = message;
}

function renderLeaderboard(entries) {
  leaderboard.innerHTML = "";

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "leaderboard-row";

    if (entry.id === playerId) {
      row.classList.add("current");
    }

    const distanceText = entry.distance === null ? "No guess" : `${entry.distance} km away`;
    row.innerHTML = `
      <div>
        <strong>#${index + 1} ${entry.name}${entry.id === playerId ? " (You)" : ""}</strong>
        <small>${distanceText} • +${entry.roundScore} this round</small>
      </div>
      <span>${entry.score} pts</span>
    `;

    leaderboard.appendChild(row);
  });
}

function resetRoundUi() {
  selectedGuess = null;
  submitGuessBtn.disabled = true;
  guessStatus.textContent = "Click anywhere on the map to place your guess.";

  if (guessMarker) {
    map.removeLayer(guessMarker);
    guessMarker = null;
  }

  if (resultMarker) {
    map.removeLayer(resultMarker);
    resultMarker = null;
  }
}

document.getElementById("create-room-btn").addEventListener("click", () => {
  const playerName = getPlayerName();
  if (!playerName) {
    setStatus("Enter your player name first.", true);
    return;
  }

  socket.emit("createRoom", { playerName });
});

document.getElementById("join-room-btn").addEventListener("click", () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  const playerName = getPlayerName();

  if (!playerName) {
    setStatus("Enter your player name first.", true);
    return;
  }

  if (!code) {
    setStatus("Enter a room code before joining.", true);
    return;
  }

  socket.emit("joinRoom", { roomCode: code, playerName });
});

roomStartBtn.addEventListener("click", () => {
  socket.emit("startGame", { roomCode });
});

submitGuessBtn.addEventListener("click", () => {
  if (!selectedGuess) {
    return;
  }

  socket.emit("submitGuess", {
    roomCode,
    lat: selectedGuess.lat,
    lng: selectedGuess.lng
  });
});

nextRoundBtn.addEventListener("click", () => {
  resetRoundUi();
  socket.emit("startGame", { roomCode });
});

socket.on("roomJoined", (payload) => {
  roomCode = payload.roomCode;
  playerId = payload.playerId;
  hostId = payload.hostId;
  roundActive = Boolean(payload.gameActive);
  roomCodeBig.textContent = roomCode;
  roomCodeLabel.textContent = roomCode;
  roundLabel.textContent = payload.round > 0 ? `Round ${payload.round}` : "Waiting for round";
  renderPlayers(payload.players);
  updateHostControls();
  setStatus(`Joined room ${roomCode}. Share the code with friends.`);
  showScreen("room");

  roomWaitingText.textContent = "Share this room code and wait for players to join.";
});

socket.on("roomUpdate", ({ roomCode: currentRoomCode, players, round, hostId: currentHostId }) => {
  roomCode = currentRoomCode;
  hostId = currentHostId;
  roomCodeBig.textContent = roomCode;
  roomCodeLabel.textContent = roomCode;
  roundLabel.textContent = round > 0 ? `Round ${round}` : "Waiting for round";
  renderPlayers(players);
  updateHostControls();
  roomWaitingText.textContent = `${players.length} player${players.length === 1 ? "" : "s"} in room. Share the code and wait for the host to start.`;
});

socket.on("gameStarted", ({ round, locationName, timer, players }) => {
  roundActive = true;
  roundLabel.textContent = `Round ${round}`;
  promptLabel.textContent = `Find ${locationName} on the map and submit your guess.`;
  timerDisplay.textContent = timer;
  renderPlayers(players);
  resetRoundUi();
  showScreen("game");

  if (!map) {
    initializeMap();
  }

  map.invalidateSize();
});

socket.on("timerUpdate", ({ timeLeft }) => {
  timerDisplay.textContent = Math.max(timeLeft, 0);
});

socket.on("guessLocked", () => {
  submitGuessBtn.disabled = true;
  guessStatus.textContent = "Guess submitted. Waiting for the rest of the room.";
});

socket.on("roundResults", ({ location, leaderboard: board }) => {
  roundActive = false;
  const me = board.find((entry) => entry.id === playerId);
  resultLocation.textContent = `Location: ${location.name}`;
  distanceLabel.textContent = me && me.distance !== null ? `Your distance: ${me.distance} km` : "Your distance: No guess submitted";
  renderLeaderboard(board);
  promptLabel.textContent = `The target was ${location.name}.`;

  if (map) {
    if (resultMarker) {
      map.removeLayer(resultMarker);
    }

    resultMarker = L.marker([location.lat, location.lng]).addTo(map).bindPopup(`${location.name}`).openPopup();
    map.setView([location.lat, location.lng], 5);
  }

  showScreen("results");
  updateHostControls();
});

socket.on("errorMessage", (message) => {
  if (screens.lobby.classList.contains("active")) {
    setStatus(message, true);
    return;
  }

  setInlineMessage(message);
});
