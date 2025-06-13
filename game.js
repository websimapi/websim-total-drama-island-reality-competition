const { useState, useEffect, useRef } = React;

const room = new WebsimSocket();
const db = new WebsimSocket();

// Game constants
const GAME_STATES = {
  LOBBY: 'lobby',
  CHALLENGE: 'challenge',
  ELIMINATION: 'elimination',
  GAME_OVER: 'game_over'
};

const CHALLENGES = [
  {
    id: 'obstacle_course',
    name: 'Extreme Obstacle Course',
    description: 'Navigate through a series of ridiculous obstacles! First to complete wins immunity!',
    type: 'speed'
  },
  {
    id: 'trivia_chaos',
    name: 'Trivia Chaos',
    description: 'Answer totally random questions correctly! Most correct answers wins!',
    type: 'knowledge'
  },
  {
    id: 'eating_contest',
    name: 'Gross Food Challenge',
    description: 'Eat the most disgusting combinations of food! Last one standing wins!',
    type: 'endurance'
  },
  {
    id: 'talent_show',
    name: 'Talent Show Disaster',
    description: 'Show off your "talents" and try not to embarrass yourself too much!',
    type: 'creativity'
  }
];

function TotalDramaGame() {
  const [gameState, setGameState] = useState(GAME_STATES.LOBBY);
  const [countdown, setCountdown] = useState(20);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [hostMessage, setHostMessage] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [hasExtended, setHasExtended] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [winners, setWinners] = useState([]);
  const [votedPlayer, setVotedPlayer] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const countdownRef = useRef(null);
  const hostRef = useRef(false);

  // Subscribe to room state and presence
  const roomState = React.useSyncExternalStore(
    (callback) => isInitialized ? room.subscribeRoomState(callback) : () => {},
    () => isInitialized ? room.roomState || {} : {}
  );
  
  const presence = React.useSyncExternalStore(
    (callback) => isInitialized ? room.subscribePresence(callback) : () => {},
    () => isInitialized ? room.presence || {} : {}
  );

  const peers = React.useSyncExternalStore(
    (callback) => isInitialized ? room.subscribePresence(callback) : () => {},
    () => isInitialized ? room.peers || {} : {}
  );

  // Subscribe to winner records
  const winnerRecords = React.useSyncExternalStore(
    db.collection('winner').subscribe,
    db.collection('winner').getList
  );

  useEffect(() => {
    initializeGame();
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (winnerRecords) {
      setWinners(winnerRecords.reverse());
    }
  }, [winnerRecords]);

  async function initializeGame() {
    try {
      await room.initialize();
      await db.initialize();
      
      setIsInitialized(true);
      
      const user = await window.websim.getCurrentUser();
      setCurrentUser(user);

      // Determine if this client should be the host (first to join or designated)
      const clients = Object.keys(room.peers || {});
      if (clients.length === 0 || clients[0] === room.clientId) {
        setIsHost(true);
        hostRef.current = true;
      }

      // Set initial presence
      room.updatePresence({
        status: 'waiting',
        alive: true,
        immunity: false
      });

      // Listen for game events
      room.onmessage = handleGameEvent;

      // Sync game state
      if (room.roomState?.gameState) {
        setGameState(room.roomState.gameState);
        setCountdown(room.roomState.countdown || 20);
        setCurrentChallenge(room.roomState.currentChallenge);
        setHostMessage(room.roomState.hostMessage || '');
      }

      // Start host messages if we're the host
      if (hostRef.current) {
        updateHostMessage("Welcome to Total Drama Island! We need at least 3 contestants to start the madness!");
      }
    } catch (error) {
      console.error('Failed to initialize game:', error);
    }
  }

  function handleGameEvent(event) {
    const { type, data } = event.data;
    
    switch (type) {
      case 'connected':
        if (hostRef.current) {
          const playerCount = Object.keys(room.peers || {}).length;
          if (playerCount >= 3 && gameState === GAME_STATES.LOBBY) {
            startCountdown();
          }
        }
        break;
        
      case 'disconnected':
        // Handle player disconnection - they're automatically eliminated
        if (presence[event.data.clientId]?.alive) {
          room.updatePresence({
            ...presence[event.data.clientId],
            alive: false,
            status: 'eliminated'
          });
        }
        break;
    }
  }

  async function updateHostMessage(message) {
    if (!hostRef.current) return;
    
    // Use AI to generate host commentary
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{
            role: 'system',
            content: 'You are Chris McLean, the sarcastic and dramatic host of Total Drama Island. Respond in character with his signature wit and commentary style. Keep responses to 1-2 sentences.'
          }, {
            role: 'user',
            content: message
          }]
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const hostResponse = data.choices[0].message.content;
        
        room.updateRoomState({
          hostMessage: hostResponse
        });
        setHostMessage(hostResponse);
      } else {
        // Fallback to basic message
        const fallbackMessage = `${message} *adjusts sunglasses smugly*`;
        room.updateRoomState({
          hostMessage: fallbackMessage
        });
        setHostMessage(fallbackMessage);
      }
    } catch (error) {
      // Fallback for no API access
      const fallbackMessage = `${message} This is going to be TOTALLY dramatic!`;
      room.updateRoomState({
        hostMessage: fallbackMessage
      });
      setHostMessage(fallbackMessage);
    }
  }

  function startCountdown() {
    if (!hostRef.current) return;
    
    updateHostMessage("Looks like we have enough contestants! The game will start soon unless someone wants to add more time...");
    
    room.updateRoomState({
      gameState: GAME_STATES.LOBBY,
      countdown: 20,
      countdownActive: true
    });

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        const newCountdown = prev - 1;
        room.updateRoomState({
          countdown: newCountdown
        });
        
        if (newCountdown <= 0) {
          clearInterval(countdownRef.current);
          startGame();
          return 0;
        }
        return newCountdown;
      });
    }, 1000);
  }

  function extendTime() {
    if (hasExtended || !roomState.countdownActive) return;
    
    setHasExtended(true);
    const newCountdown = countdown + 10;
    setCountdown(newCountdown);
    
    room.updateRoomState({
      countdown: newCountdown
    });

    updateHostMessage("Someone bought us more time! Use it wisely, campers!");
  }

  function startGame() {
    if (!hostRef.current) return;
    
    const alivePlayers = Object.values(presence).filter(p => p.alive);
    if (alivePlayers.length < 2) {
      endGame();
      return;
    }

    const challenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    setCurrentChallenge(challenge);
    
    room.updateRoomState({
      gameState: GAME_STATES.CHALLENGE,
      currentChallenge: challenge,
      countdownActive: false
    });
    
    setGameState(GAME_STATES.CHALLENGE);
    updateHostMessage(`Time for the ${challenge.name}! ${challenge.description}`);
    
    // Auto-complete challenge after 30 seconds
    setTimeout(() => {
      if (gameState === GAME_STATES.CHALLENGE) {
        completeChallenge();
      }
    }, 30000);
  }

  function completeChallenge() {
    if (!hostRef.current) return;
    
    const alivePlayers = Object.values(presence).filter(p => p.alive);
    
    // Randomly determine immunity winner
    const immunityWinner = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    
    // Update immunity status
    Object.keys(presence).forEach(clientId => {
      if (presence[clientId].alive) {
        room.requestPresenceUpdate(clientId, {
          immunity: clientId === immunityWinner.clientId
        });
      }
    });

    room.updateRoomState({
      gameState: GAME_STATES.ELIMINATION,
      immunityWinner: immunityWinner.username
    });
    
    setGameState(GAME_STATES.ELIMINATION);
    updateHostMessage(`${immunityWinner.username} wins immunity! Time for the elimination ceremony...`);
  }

  function votePlayer(targetClientId) {
    if (votedPlayer || !presence[room.clientId]?.alive || presence[targetClientId]?.immunity) {
      return;
    }
    
    setVotedPlayer(targetClientId);
    room.updatePresence({
      votedFor: targetClientId
    });

    // Check if all votes are in
    const alivePlayers = Object.values(presence).filter(p => p.alive);
    const votes = alivePlayers.filter(p => p.votedFor).length;
    
    if (votes === alivePlayers.length && hostRef.current) {
      processElimination();
    }
  }

  function processElimination() {
    if (!hostRef.current) return;
    
    const alivePlayers = Object.values(presence).filter(p => p.alive);
    const voteCount = {};
    
    // Count votes
    alivePlayers.forEach(player => {
      if (player.votedFor) {
        voteCount[player.votedFor] = (voteCount[player.votedFor] || 0) + 1;
      }
    });

    // Find player with most votes
    const eliminatedClientId = Object.keys(voteCount).reduce((a, b) => 
      voteCount[a] > voteCount[b] ? a : b
    );

    // Eliminate player
    room.requestPresenceUpdate(eliminatedClientId, {
      alive: false,
      status: 'eliminated'
    });

    const eliminatedPlayer = room.peers[eliminatedClientId];
    updateHostMessage(`${eliminatedPlayer.username} has been eliminated! Pack your bags!`);

    // Reset votes and immunity
    Object.keys(presence).forEach(clientId => {
      if (presence[clientId].alive) {
        room.requestPresenceUpdate(clientId, {
          votedFor: null,
          immunity: false
        });
      }
    });

    setVotedPlayer(null);

    // Check for winner
    const remainingPlayers = Object.values(presence).filter(p => p.alive && p.clientId !== eliminatedClientId);
    if (remainingPlayers.length === 1) {
      declareWinner(remainingPlayers[0]);
    } else {
      // Start next challenge
      setTimeout(() => startGame(), 3000);
    }
  }

  async function declareWinner(winner) {
    if (!hostRef.current) return;
    
    room.updateRoomState({
      gameState: GAME_STATES.GAME_OVER,
      winner: winner.username
    });
    
    setGameState(GAME_STATES.GAME_OVER);
    updateHostMessage(`${winner.username} is the ultimate survivor! Congratulations!`);

    // Store winner in database
    try {
      await db.collection('winner').create({
        username: winner.username,
        season: `Season ${Math.floor(Date.now() / 1000000)}`,
        prize: '$100,000'
      });
    } catch (error) {
      console.error('Failed to save winner:', error);
    }
  }

  function resetGame() {
    if (!hostRef.current) return;
    
    room.updateRoomState({
      gameState: GAME_STATES.LOBBY,
      countdown: 20,
      currentChallenge: null,
      countdownActive: false,
      winner: null,
      immunityWinner: null
    });

    // Reset all player states
    Object.keys(presence).forEach(clientId => {
      room.requestPresenceUpdate(clientId, {
        alive: true,
        status: 'waiting',
        immunity: false,
        votedFor: null
      });
    });

    setGameState(GAME_STATES.LOBBY);
    setCountdown(20);
    setCurrentChallenge(null);
    setHasExtended(false);
    setVotedPlayer(null);
    
    updateHostMessage("New game starting! Let's see who has what it takes to survive!");
  }

  const alivePlayers = Object.entries(presence || {}).filter(([id, p]) => p?.alive);
  const allPlayers = Object.entries(peers || {});
  const spectators = allPlayers.filter(([id]) => !presence[id]?.alive && gameState !== GAME_STATES.LOBBY);
  const isSpectator = !presence[room.clientId]?.alive && gameState !== GAME_STATES.LOBBY;

  if (!isInitialized) {
    return (
      <div className="game-container">
        <header className="header">
          <h1 className="title">TOTAL DRAMA ISLAND</h1>
          <p className="subtitle">The Ultimate Reality TV Competition!</p>
        </header>
        <div className="lobby">
          <div className="lobby-card">
            <div className="loading">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      <header className="header">
        <h1 className="title">TOTAL DRAMA ISLAND</h1>
        <p className="subtitle">The Ultimate Reality TV Competition!</p>
      </header>

      {hostMessage && (
        <div className="host-speech">
          {hostMessage}
        </div>
      )}

      {gameState === GAME_STATES.LOBBY && (
        <div className="lobby">
          <div className="lobby-card">
            <h2>Contestants Lobby</h2>
            <p>Waiting for brave souls to join the madness...</p>
            
            {roomState.countdownActive && (
              <div className="countdown">{countdown}</div>
            )}

            <div className="players-list">
              {allPlayers.map(([id, peer]) => (
                <div key={id} className="player-card">
                  <img 
                    src={peer.avatarUrl} 
                    alt={peer.username}
                    className="player-avatar"
                  />
                  <div className="player-info">
                    <h3>{peer.username}</h3>
                    <div className="player-status">
                      {presence[id]?.status || 'Ready'}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {allPlayers.length >= 3 && roomState.countdownActive && !hasExtended && (
              <button className="btn" onClick={extendTime}>
                Add 10 Seconds! (+10s)
              </button>
            )}

            {allPlayers.length < 3 && (
              <p>Need at least 3 players to start the carnage!</p>
            )}
          </div>
        </div>
      )}

      {gameState === GAME_STATES.CHALLENGE && (
        <div className="challenge-view">
          {isSpectator && (
            <div className="spectator-notice">
              You're spectating this round. The game will restart when it's over!
            </div>
          )}
          
          <div className="challenge-header">
            <h2 className="challenge-title">{currentChallenge?.name}</h2>
            <p className="challenge-description">{currentChallenge?.description}</p>
          </div>
          
          <div className="challenge-arena">
            <h3>Challenge in Progress...</h3>
            <p>Players are competing! Results coming soon!</p>
            
            <div className="players-list">
              {alivePlayers.map(([id, player]) => (
                <div key={id} className="player-card">
                  <img 
                    src={peers[id]?.avatarUrl} 
                    alt={peers[id]?.username}
                    className="player-avatar"
                  />
                  <div className="player-info">
                    <h3>{peers[id]?.username}</h3>
                    <div className="player-status">Competing...</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {gameState === GAME_STATES.ELIMINATION && (
        <div className="elimination-view">
          {isSpectator && (
            <div className="spectator-notice">
              You're spectating the elimination ceremony!
            </div>
          )}
          
          <div className="campfire"></div>
          
          <h2>Elimination Ceremony</h2>
          {roomState.immunityWinner && (
            <p><strong>{roomState.immunityWinner}</strong> has immunity and is safe!</p>
          )}
          
          {!isSpectator && !votedPlayer && (
            <>
              <p>Vote someone off the island:</p>
              <div className="vote-options">
                {alivePlayers
                  .filter(([id]) => !presence[id]?.immunity && id !== room.clientId)
                  .map(([id, player]) => (
                    <button 
                      key={id}
                      className="vote-btn"
                      onClick={() => votePlayer(id)}
                    >
                      <img 
                        src={peers[id]?.avatarUrl} 
                        alt={peers[id]?.username}
                        className="player-avatar"
                      />
                      <span>{peers[id]?.username}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
          
          {votedPlayer && (
            <p>You voted for {peers[votedPlayer]?.username}. Waiting for other votes...</p>
          )}
        </div>
      )}

      {gameState === GAME_STATES.GAME_OVER && (
        <div className="elimination-view">
          <div className="winner-announcement">
            <h2 className="winner-title">🏆 WINNER! 🏆</h2>
            <h3>{roomState.winner}</h3>
            <p>Congratulations on surviving Total Drama Island!</p>
          </div>

          {isHost && (
            <button className="btn" onClick={resetGame}>
              Start New Game
            </button>
          )}

          {winners.length > 0 && (
            <div className="winners-gallery">
              <h3>Hall of Fame</h3>
              <div className="winners-grid">
                {winners.slice(0, 10).map((winner) => (
                  <div key={winner.id} className="winner-card">
                    <h4>{winner.username}</h4>
                    <p>{winner.season}</p>
                    <p>{winner.prize}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

ReactDOM.render(<TotalDramaGame />, document.getElementById('root'));