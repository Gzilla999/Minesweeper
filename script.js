"use strict";
/* --- SERVICE WORKER REGISTRATION --- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js")
    .catch(err => console.warn("SW registration failed:", err));
}

/* --- CONFIGURATION --- */
// Standard Minesweeper difficulty presets
let difficulties = {
  easy: {rows: 9, cols: 9, mines: 10},
  intermediate: {rows: 16, cols: 16, mines: 40},
  hard: {rows: 16, cols: 30, mines: 99}
};

/* --- DOM ELEMENTS & STATE VARIABLES --- */
let currentDifficulty = "easy";
const difficultySelect = document.getElementById("difficulty");

// Event listener to change difficulty and reset board
difficultySelect.addEventListener("change",()=> { 
    currentDifficulty=difficultySelect.value; 
    setDifficulty(); 
});

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const mineCounter = document.getElementById("mineCounter");
const timer = document.getElementById("timer");
const statsDiv = document.getElementById("stats");
const leaderboardDiv = document.getElementById("leaderboard");
const smiley = document.getElementById("smiley");
const flagToggle = document.getElementById("flagToggle");
const mobileCheckbox = document.getElementById("toggleFlag");
const longPressDurationInput = document.getElementById("longPressDuration");
const longPressDurationValue = document.getElementById("longPressDurationValue");
const deleteButtonToggle = document.getElementById("showDeleteButton");

let ROWS, COLS, MINES, TILE = 32; // TILE is the pixel size of one square
let grid;      // Stores numbers (0-8) or mine (-1)
let revealed;  // Boolean array: is cell open?
let flagged;   // Boolean array: is cell flagged?
let minesSet;  // Set to track mine locations

// Game State Tracking
let firstClick = true, gameOver = false, win = false;
let startTime = null, endTime = null;
let clickCount = 0;
let threeBV = 0; // "Bechtel's Board Benchmark"
let moveLog = [];
let longPressTimers = new Map(); // Track long press timers
let longPressActive = new Map(); // Track if long press was triggered

// UI State
let replaying = false, replayStartTime = 0;
let flagMode = false, toggleFlag = false, showStats = true;
let longPressDuration = 200; // Default 200ms
let showDeleteButton = true; // Show delete button by default

// ===== HINT SYSTEM =====
let hintsRemaining = 3;
const MAX_HINTS_PER_GAME = 3;
const hintButton = document.getElementById("hintButton");
const hintCountSpan = document.getElementById("hintCount");
let hintMode = false; // Toggle to show probabilities
let cellProbabilities = []; // Store calculated probabilities

hintButton.addEventListener("click", toggleHintMode);

// ===== ADVANCED TANK SOLVER HINT SYSTEM =====

function calculateAllProbabilities() {
    const borderCells = [];
    const borderSet = new Map(); 
    const rules = [];

    // 1. Identify Border Cells & Constraints
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (revealed[r][c] && grid[r][c] > 0) {
                let unrevealed = [], adjMines = 0;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (!dr && !dc) continue;
                        let nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                            if (flagged[nr][nc]) adjMines++;
                            else if (!revealed[nr][nc]) {
                                let key = `${nr},${nc}`;
                                if (!borderSet.has(key)) {
                                    borderSet.set(key, borderCells.length);
                                    borderCells.push({ r: nr, c: nc });
                                }
                                unrevealed.push(borderSet.get(key));
                            }
                        }
                    }
                }
                if (unrevealed.length > 0) {
                    rules.push({ cells: unrevealed, minesNeeded: grid[r][c] - adjMines });
                }
            }
        }
    }

    if (borderCells.length === 0) return calculateBackgroundOnly();

    // 2. Group into Independent Islands
    const adj = borderCells.map(() => []);
    rules.forEach(rule => {
        rule.cells.forEach(c1 => {
            rule.cells.forEach(c2 => { if (c1 !== c2) adj[c1].push(c2); });
        });
    });

    const components = [];
    const visited = new Set();
    for (let i = 0; i < borderCells.length; i++) {
        if (visited.has(i)) continue;
        const comp = [];
        const stack = [i];
        visited.add(i);
        while (stack.length) {
            const curr = stack.pop();
            comp.push(curr);
            adj[curr].forEach(next => { if (!visited.has(next)) { visited.add(next); stack.push(next); }});
        }
        components.push(comp);
    }

    // 3. Solve Islands
    const compSolutions = components.map(comp => solveComponent(comp, rules));

    // 4. Global Background Probability
    const flaggedCount = flagged.reduce((s, row) => s + row.filter(Boolean).length, 0);
    const totalRemainingMines = MINES - flaggedCount;
    const totalHidden = revealed.flat().filter(v => !v).length - flaggedCount;
    const hiddenOutsideBorder = totalHidden - borderCells.length;

    let results = [];
    borderCells.forEach((cell, i) => {
        let p = 0;
        components.forEach((comp, cIdx) => {
            if (comp.includes(i)) {
                let localIdx = comp.indexOf(i);
                let total = 0, count = 0;
                Object.values(compSolutions[cIdx]).forEach(s => {
                    total += s.totalConfigs;
                    count += s.cellFrequencies[localIdx];
                });
                p = total > 0 ? count / total : 0;
            }
        });
        results.push({ r: cell.r, c: cell.c, probability: p });
    });

    // Add background probability for cells not touching numbers
    const avgProb = totalHidden > 0 ? totalRemainingMines / totalHidden : 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!revealed[r][c] && !flagged[r][c] && !borderSet.has(`${r},${c}`)) {
                results.push({ r, c, probability: avgProb });
            }
        }
    }

    return results;
}

function solveComponent(comp, allRules) {
    const compRules = allRules.filter(r => r.cells.some(c => comp.includes(c)));
    const localMap = new Map();
    comp.forEach((gIdx, lIdx) => localMap.set(gIdx, lIdx));
    const localRules = compRules.map(r => ({
        cells: r.cells.map(c => localMap.get(c)).filter(c => c !== undefined),
        mines: r.minesNeeded
    }));

    const solutions = {}; 

    function backtrack(idx, current) {
        for (let r of localRules) {
            let set = 0, mines = 0;
            for (let c of r.cells) {
                if (c < idx) { set++; if (current[c]) mines++; }
            }
            if (mines > r.mines || (r.mines - mines) > (r.cells.length - set)) return;
        }

        if (idx === comp.length) {
            let count = current.filter(Boolean).length;
            if (!solutions[count]) solutions[count] = { totalConfigs: 0, cellFrequencies: new Array(comp.length).fill(0) };
            solutions[count].totalConfigs++;
            current.forEach((val, i) => { if (val) solutions[count].cellFrequencies[i]++; });
            return;
        }

        current[idx] = true; backtrack(idx + 1, current);
        current[idx] = false; backtrack(idx + 1, current);
    }

    backtrack(0, new Array(comp.length).fill(false));
    return solutions;
}

function calculateBackgroundOnly() {
    let unrevealed = 0, flaggedCount = 0;
    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            if (!revealed[r][c]) unrevealed++;
            if (flagged[r][c]) flaggedCount++;
        }
    }
    let prob = unrevealed > 0 ? (MINES - flaggedCount) / unrevealed : 0;
    let res = [];
    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            if (!revealed[r][c] && !flagged[r][c]) res.push({r, c, probability: prob});
        }
    }
    return res;
}

function toggleHintMode() {
    if (gameOver || replaying || hintsRemaining <= 0) return;
    
    if (!hintMode) {
        hintMode = true;
        hintsRemaining--; 
        clickCount++;
        cellProbabilities = calculateAllProbabilities();
        
        hintButton.textContent = "💡 Close Hint (" + hintsRemaining + ")";
        hintButton.style.backgroundColor = "#ffff00";
        draw(); 
    } else {
        exitHintMode();
    }
}

function exitHintMode() {
    hintMode = false;
    cellProbabilities = [];
    updateHintUI();
    draw();
}

function updateHintUI() {
    hintCountSpan.textContent = hintsRemaining;
    hintButton.disabled = hintsRemaining <= 0 || gameOver;
    hintButton.textContent = "💡 Hint (" + hintsRemaining + ")";
    hintButton.style.backgroundColor = "#fff700";
}

// Load High Scores from LocalStorage
function loadBestScores(){
  try{
    const raw = localStorage.getItem("ms_best_scores");
    if(!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  }catch(e){
    console.warn("Minesweeper: failed to load best scores from localStorage", e);
    return {};
  }
}
let bestScores = loadBestScores();

// Load Long Press Duration from LocalStorage
function loadLongPressDuration(){
  try{
    const saved = localStorage.getItem("ms_long_press_duration");
    if(!saved) return 200;
    const parsed = parseInt(saved, 10);
    return (Number.isInteger(parsed) && parsed >= 100 && parsed <= 1000) ? parsed : 200;
  }catch(e){
    console.warn("Minesweeper: failed to load long press duration from localStorage", e);
    return 200;
  }
}

// Load Show Delete Button setting from LocalStorage
function loadShowDeleteButton(){
  try{
    const saved = localStorage.getItem("ms_show_delete_button");
    if(saved === null) return true;
    return saved === "true";
  }catch(e){
    console.warn("Minesweeper: failed to load show delete button setting from localStorage", e);
    return true;
  }
}

/* --- EVENT LISTENERS --- */

// Toggle mobile mode
mobileCheckbox.addEventListener("change", e => { 
    toggleFlag = e.target.checked; 
    flagToggle.style.display = toggleFlag ? "inline-block" : "none"; 
});

// Toggle flag mode
flagToggle.addEventListener("click", () => { 
    flagMode = !flagMode; 
    flagToggle.textContent = "Flag Mode: " + (flagMode ? "ON" : "OFF"); 
});

// Toggle stats visibility
document.getElementById("showStats").addEventListener("change", e => { 
    showStats = e.target.checked; 
    draw(); 
});

// Toggle delete button visibility
deleteButtonToggle.addEventListener("change", e => {
    showDeleteButton = e.target.checked;
    localStorage.setItem("ms_show_delete_button", showDeleteButton.toString());
    updateLeaderboard();
});

// Long press duration control
longPressDurationInput.addEventListener("input", e => {
    longPressDuration = parseInt(e.target.value, 10);
    longPressDurationValue.textContent = longPressDuration + "ms";
    localStorage.setItem("ms_long_press_duration", longPressDuration.toString());
});

/* --- INITIALIZATION --- */

function setDifficulty(){
  let d = difficulties[currentDifficulty];
  ROWS = d.rows; COLS = d.cols; MINES = d.mines;
  
  // Responsive tile size based on screen width
  let screenWidth = window.innerWidth - 40; // account for padding/borders
  let maxTileSize = Math.floor(screenWidth / COLS);
  TILE = Math.min(32, Math.max(16, maxTileSize)); // clamp between 16-32px
  
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  init();
}

// Recalculate on window resize
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Don't resize if game is active or if we haven't initialized yet
    if(gameOver || replaying || !grid) return;
    
    // Only recalculate canvas size, don't reinitialize the game
    let screenWidth = window.innerWidth - 40;
    let maxTileSize = Math.floor(screenWidth / COLS);
    let newTile = Math.min(32, Math.max(16, maxTileSize));
    
    // Only update canvas if tile size actually changed
    if(newTile !== TILE) {
      TILE = newTile;
      canvas.width = COLS * TILE;
      canvas.height = ROWS * TILE;
      draw(); // Redraw with new size, don't reset game
    }
  }, 300); // debounce
});

function init(customMines = null){
  grid = Array.from({length:ROWS}, () => Array(COLS).fill(0));
  revealed = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  flagged = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  minesSet = new Set(customMines || []);
  
  firstClick = true; gameOver = false; win = false; 
  startTime = null; endTime = null; 
  clickCount = 0; threeBV = 0; moveLog = []; 
  
  // Reset hints for new game
  hintsRemaining = MAX_HINTS_PER_GAME;
  hintMode = false;
  cellProbabilities = [];
  
  replaying = false;
  
  smiley.textContent = "😊";
  updateHintUI();
  updateUI(); draw(); updateStats(); updateLeaderboard();
}

/* --- CORE GAME LOGIC --- */

function placeMineSafe(r0, c0, customMines = null){
  let safeCells = new Set();
  for(let dr = -1; dr <= 1; dr++) 
    for(let dc = -1; dc <= 1; dc++){ 
      let r = r0 + dr, c = c0 + dc; 
      if(r >= 0 && r < ROWS && c >= 0 && c < COLS) safeCells.add(r + "," + c); 
    }

  if(customMines){ 
    minesSet = new Set(customMines); 
  } else { 
    // Defensive: ensure we don't try to place more mines than available non-safe cells
    const maxAvailable = ROWS * COLS - safeCells.size;
    if(MINES > maxAvailable){
      console.warn(`Minesweeper: MINES (${MINES}) > available non-safe cells (${maxAvailable}). Capping to ${maxAvailable}.`);
    }
    const targetMines = Math.min(MINES, Math.max(0, maxAvailable));

    // Avoid pathological infinite loops by bounding attempts
    let attempts = 0;
    const maxAttempts = ROWS * COLS * 10;
    while(minesSet.size < targetMines && attempts++ < maxAttempts){ 
      let r = Math.floor(Math.random() * ROWS), c = Math.floor(Math.random() * COLS); 
      if(safeCells.has(r + "," + c)) continue; 
      minesSet.add(r + "," + c); 
    } 
    if(minesSet.size < targetMines){
      console.warn("Minesweeper: unable to place the requested number of mines after many attempts. Placed:", minesSet.size);
    }
  }

  for(let rc of minesSet){ let [r,c] = rc.split(",").map(Number); grid[r][c] = -1; }
  
  for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++){
    if(grid[r][c] === -1) continue;
    let count = 0;
    for(let dr = -1; dr <= 1; dr++) for(let dc = -1; dc <= 1; dc++){
      let nr = r + dr, nc = c + dc; 
      if(nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === -1) count++;
    } 
    grid[r][c] = count;
  }
  threeBV = compute3BV();
}

function compute3BV(){ 
  let visited = Array.from({length:ROWS}, () => Array(COLS).fill(false)), count = 0;
  function flood(r,c){ 
    if(r < 0 || r >= ROWS || c < 0 || c >= COLS || visited[r][c] || grid[r][c] === -1) return; 
    visited[r][c] = true; 
    if(grid[r][c] === 0) 
      for(let dr = -1; dr <= 1; dr++) for(let dc = -1; dc <= 1; dc++) if(dr || dc) flood(r + dr, c + dc); 
  }
  for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++) 
    if(grid[r][c] === 0 && !visited[r][c]){ count++; flood(r,c); }
  for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++) 
    if(grid[r][c] > 0 && !visited[r][c]) count++;
  return count;
}

function reveal(r, c, allowFlood = true){ 
    if(r < 0 || r >= ROWS || c < 0 || c >= COLS || revealed[r][c] || flagged[r][c]) return; 
    revealed[r][c] = true; 
    if(allowFlood && grid[r][c] === 0) 
        for(let dr = -1; dr <= 1; dr++) for(let dc = -1; dc <= 1; dc++) if(dr || dc) reveal(r + dr, c + dc, true); 
}

function chord(r, c){ 
    if(grid[r][c] <= 0) return; 
    let flags = 0;
    let flaggedCells = [];
    
    for(let dr = -1; dr <= 1; dr++) for(let dc = -1; dc <= 1; dc++){ 
        let nr = r + dr, nc = c + dc; 
        if(nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS){
            if(flagged[nr][nc]){
                flags++; 
                flaggedCells.push([nr, nc]);
            }
        }
    } 
    
    // Check if flags match the number
    if(flags !== grid[r][c]) return;
    
    // Verify that all flagged cells are actually mines
    for(let [fr, fc] of flaggedCells){
        if(grid[fr][fc] !== -1){
            // Wrong flag! Game over
            gameOver = true;
            win = false;
            endTime = performance.now();
            smiley.textContent = "😵";
            return;
        }
    }
    
    // All flags are correct, reveal safe cells
    for(let dr = -1; dr <= 1; dr++) for(let dc = -1; dc <= 1; dc++){ 
        let nr = r + dr, nc = c + dc; 
        if(nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !flagged[nr][nc] && !revealed[nr][nc]) reveal(nr, nc, true); 
    } 
}

function checkWin(){ 
    for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++) 
        if(grid[r][c] !== -1 && !revealed[r][c]) return false; 
    return true; 
}

/* --- INPUT HANDLING --- */

function handleClick(r, c, type, logMove = true, replayMove = false){
  if(gameOver && !replayMove) return;

  if(firstClick && type === 'reveal'){ placeMineSafe(r, c); firstClick = false; }
  if(!startTime && !replayMove) startTime = performance.now();

  let countedClick = false;
  if(type === 'reveal'){
    let isChord = revealed[r][c];   // Track if this is a chord
    if(revealed[r][c]){ chord(r, c); countedClick = true; } 
    else if(grid[r][c] === -1 && !replayMove){ 
        gameOver = true; win = false; endTime = performance.now(); 
        smiley.textContent = "😵"; countedClick = true; 
        reveal(r, c, false); 
    } 
    else{ reveal(r, c, true); countedClick = true; }
    
    // Log as 'chord' type if it was a chord move
    if(logMove && isChord){
      const baseTime = replayMove ? replayStartTime : (startTime || performance.now());
      moveLog.push({r, c, type: 'chord', time: performance.now() - baseTime});
      if(countedClick && !replayMove) clickCount++;
      updateUI(); draw(); updateStats();
      if(!gameOver && checkWin() && !replayMove){ 
          gameOver = true; win = true; endTime = performance.now(); 
          smiley.textContent = "😎"; 
          saveHighScore(); 
      }
      return;
    }
  } else if(type === 'flag'){ 
      if(!revealed[r][c]) countedClick = true; 
      flagged[r][c] = !flagged[r][c]; 
  }

  if(countedClick && !replayMove) clickCount++;
  if(logMove){
    const baseTime = replayMove ? replayStartTime : (startTime || performance.now());
    moveLog.push({r, c, type, time: performance.now() - baseTime});
  }
  
  if(!gameOver && checkWin() && !replayMove){ 
      gameOver = true; win = true; endTime = performance.now(); 
      smiley.textContent = "😎"; 
      saveHighScore(); 
  }

  updateUI(); draw(); updateStats();
}

/* --- MOUSE EVENTS --- */

canvas.addEventListener("mousedown", e => { 
  if(gameOver || replaying) return;
  
  e.preventDefault(); // Prevent text selection on long press
  smiley.textContent = "😮";
  
  let rect = canvas.getBoundingClientRect();
  let r = Math.floor((e.clientY - rect.top) / TILE);
  let c = Math.floor((e.clientX - rect.left) / TILE);
  let cellKey = `${r},${c}`;
  
  // For right-click, flag immediately
  if(e.button === 2) {
    let type = 'flag';
    handleClick(r, c, type);
    return;
  }
  
  // Clear any existing timer for this cell
  if(longPressTimers.has(cellKey)) {
    clearTimeout(longPressTimers.get(cellKey));
  }
  
  // Start long press timer
  let timer = setTimeout(() => {
    // Long press detected - flag the cell
    if(!gameOver) {
      handleClick(r, c, 'flag');
      longPressActive.set(cellKey, true); // Mark that long press was triggered
    }
    longPressTimers.delete(cellKey);
  }, longPressDuration);
  
  longPressTimers.set(cellKey, timer);
  longPressActive.set(cellKey, false); // Mark that long press hasn't triggered yet
});

canvas.addEventListener("mousemove", e => {
  if(replaying) return;
  
  let rect = canvas.getBoundingClientRect();
  let r = Math.floor((e.clientY - rect.top) / TILE);
  let c = Math.floor((e.clientX - rect.left) / TILE);
  let cellKey = `${r},${c}`;
  
  // Check if we've moved to a different cell
  for(let [key, timer] of longPressTimers.entries()) {
    if(key !== cellKey) {
      // We moved away from the original cell, cancel the timer
      clearTimeout(timer);
      longPressTimers.delete(key);
      longPressActive.delete(key);
    }
  }
});

canvas.addEventListener("mouseup", e => { 
  if(gameOver) return;
  
  smiley.textContent = "😊";
  
  let rect = canvas.getBoundingClientRect();
  let r = Math.floor((e.clientY - rect.top) / TILE);
  let c = Math.floor((e.clientX - rect.left) / TILE);
  let cellKey = `${r},${c}`;
  
  // If in hint mode, just exit hint mode on any click
  if(hintMode) {
    exitHintMode();
    return;
  }
  
  // If timer still exists, user released before long press duration - treat as normal reveal
  if(longPressTimers.has(cellKey)) {
    clearTimeout(longPressTimers.get(cellKey));
    longPressTimers.delete(cellKey);
    
    if(!gameOver && !replaying) {
      let type = (e.button === 2) ? 'flag' : (flagMode ? 'flag' : 'reveal');
      handleClick(r, c, type);
    }
  } else if(longPressActive.get(cellKey)) {
    // Long press was already triggered, don't do anything else
    longPressActive.delete(cellKey);
  }
});

canvas.addEventListener("mouseleave", () => {
  // Clear all pending long press timers
  for(let timer of longPressTimers.values()) {
    clearTimeout(timer);
  }
  longPressTimers.clear();
  longPressActive.clear();
});

// Replace the mousedown/mouseup listeners with touch events for mobile
let touchStartTime = 0;
let touchStartCell = null;

canvas.addEventListener("touchstart", e => {
  if(replaying) return;
  e.preventDefault();
  
  let touch = e.touches[0];
  let rect = canvas.getBoundingClientRect();
  let r = Math.floor((touch.clientY - rect.top) / TILE);
  let c = Math.floor((touch.clientX - rect.left) / TILE);
  
  touchStartTime = Date.now();
  touchStartCell = {r, c};
  let cellKey = `${r},${c}`;
  
  // Start long press timer
  let timer = setTimeout(() => {
    if(!gameOver && touchStartCell) {
      handleClick(r, c, 'flag');
      touchStartCell = null; // Prevent double action
    }
    longPressTimers.delete(cellKey);
  }, longPressDuration);
  
  longPressTimers.set(cellKey, timer);
});

canvas.addEventListener("touchend", e => {
  e.preventDefault();
  
  if(!touchStartCell) return;
  
  let elapsed = Date.now() - touchStartTime;
  let cellKey = `${touchStartCell.r},${touchStartCell.c}`;
  
  // If in hint mode, just exit hint mode
  if(hintMode) {
    exitHintMode();
    touchStartCell = null;
    return;
  }
  
  // If released before long press duration, treat as normal reveal
  if(elapsed < longPressDuration && longPressTimers.has(cellKey)) {
    clearTimeout(longPressTimers.get(cellKey));
    longPressTimers.delete(cellKey);
    
    if(!gameOver && !replaying) {
      handleClick(touchStartCell.r, touchStartCell.c, flagMode ? 'flag' : 'reveal');
    }
  }
  
  touchStartCell = null;
});

canvas.addEventListener("touchcancel", e => {
  e.preventDefault();
  // Clear timer if touch is cancelled
  if(touchStartCell) {
    let cellKey = `${touchStartCell.r},${touchStartCell.c}`;
    if(longPressTimers.has(cellKey)) {
      clearTimeout(longPressTimers.get(cellKey));
      longPressTimers.delete(cellKey);
    }
    touchStartCell = null;
  }
});

canvas.addEventListener("contextmenu", e => e.preventDefault());
smiley.addEventListener("click", () => { if(!replaying) init(); });
statsDiv.addEventListener("click", () => { if(bestScores[currentDifficulty]?.[0]) replay(bestScores[currentDifficulty][0]); });

/* --- LEADERBOARD & REPLAY --- */

function deleteLeaderboardEntry(difficulty, index) {
  if(bestScores[difficulty] && bestScores[difficulty][index]) {
    bestScores[difficulty].splice(index, 1);
    localStorage.setItem("ms_best_scores", JSON.stringify(bestScores));
    updateLeaderboard();
  }
}

function saveHighScore(){
  if(threeBV < 1) return;
  if(!bestScores[currentDifficulty]) bestScores[currentDifficulty] = [];
  let elapsed = (endTime - startTime) / 1000;
  bestScores[currentDifficulty].push({
      time: elapsed, clickCount, threeBV, 
      log: moveLog.slice(), win, mines: Array.from(minesSet)
  });
  bestScores[currentDifficulty].sort((a, b) => a.time - b.time);
  bestScores[currentDifficulty] = bestScores[currentDifficulty].slice(0, 100);
  localStorage.setItem("ms_best_scores", JSON.stringify(bestScores));
  updateLeaderboard();
}

function updateLeaderboard(){
  let headerAction = '';
  let bodyAction = '';
  
  if(showDeleteButton) {
    headerAction = '<th style="padding: 5px; text-align: center; border: 1px solid #999;">Action</th>';
    bodyAction = '<td style="padding: 5px; border: 1px solid #ddd; text-align: center;"><button onclick="deleteLeaderboardEntry(\'${DIFFICULTY}\', ${INDEX})" style="background-color: #ff6b6b; color: white; border: 1px solid #cc0000; padding: 2px 8px; cursor: pointer; font-size: 11px; border-radius: 3px;">Delete</button></td>';
  }
  
  leaderboardDiv.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="background-color: #ccc; border-bottom: 2px solid #999;">
          <th style="padding: 5px; text-align: left; border: 1px solid #999;">Rank</th>
          <th style="padding: 5px; text-align: left; border: 1px solid #999;">Time (s)</th>
          <th style="padding: 5px; text-align: left; border: 1px solid #999;">3BV</th>
          <th style="padding: 5px; text-align: left; border: 1px solid #999;">3BV/s</th>
          <th style="padding: 5px; text-align: left; border: 1px solid #999;">Efficiency</th>
          ${headerAction}
        </tr>
      </thead>
      <tbody>
        ${!bestScores[currentDifficulty] ? '' : bestScores[currentDifficulty].slice(0, 50).map((e, i) => {
          let eff = e.clickCount ? ((e.threeBV / e.clickCount) * 100).toFixed(1) + "%" : "N/A";
          let actionCell = '';
          if(showDeleteButton) {
            actionCell = `<td style="padding: 5px; border: 1px solid #ddd; text-align: center;"><button onclick="deleteLeaderboardEntry('${currentDifficulty}', ${i})" style="background-color: #ff6b6b; color: white; border: 1px solid #cc0000; padding: 2px 8px; cursor: pointer; font-size: 11px; border-radius: 3px;">Delete</button></td>`;
          }
          return `
            <tr style="border-bottom: 1px solid #ddd; cursor: pointer;" onmouseover="this.style.backgroundColor='#eee'" onmouseout="this.style.backgroundColor=''">
              <td style="padding: 5px; border: 1px solid #ddd;">#${i+1}</td>
              <td style="padding: 5px; border: 1px solid #ddd;">${e.time.toFixed(3)}</td>
              <td style="padding: 5px; border: 1px solid #ddd;">${e.threeBV}</td>
              <td style="padding: 5px; border: 1px solid #ddd;">${(e.threeBV/e.time).toFixed(2)}</td>
              <td style="padding: 5px; border: 1px solid #ddd;">${eff}</td>
              ${actionCell}
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  
  // Add click handlers to rows (for replay on row click, excluding delete button clicks)
  if(bestScores[currentDifficulty]){
    const rows = leaderboardDiv.querySelectorAll('tbody tr');
    bestScores[currentDifficulty].slice(0, 50).forEach((entry, index) => {
      if(rows[index]){
        rows[index].addEventListener('click', (event) => {
          // Don't replay if delete button was clicked
          if(event.target.textContent !== 'Delete') {
            replay(entry);
          }
        });
      }
    });
  }
}

function replay(entry){
  if(replaying) return;

  window.scrollTo({ top: 0, behavior: 'instant' });
  
  replaying = true;
  firstClick = false; gameOver = false; win = entry.win;

  grid = Array.from({length:ROWS}, () => Array(COLS).fill(0));
  revealed = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  flagged = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  
  minesSet = new Set(entry.mines);
  for(let rc of minesSet){ 
    let [r,c] = rc.split(",").map(Number); 
    if(r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      grid[r][c] = -1;
    }
  }

  for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++){
    if(grid[r][c] === -1) continue;
    let count = 0;
    for(let dr = -1; dr <= 1; dr++) for(let dc = -1; dc <= 1; dc++){
      let nr = r + dr, nc = c + dc;
      if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&grid[nr][nc]===-1) count++;
    }
    grid[r][c] = count;
  }

  threeBV = compute3BV();
  clickCount = 0;
  startTime = performance.now();
  replayStartTime = startTime;

  entry.log.forEach(m => {
    setTimeout(() => {
      if(m.type === 'reveal'){ reveal(m.r, m.c, true); clickCount++; }
      else if(m.type === 'chord'){ chord(m.r, m.c); clickCount++; }
      else { flagged[m.r][m.c] = !flagged[m.r][m.c]; clickCount++; }
      draw(); updateStats();
    }, m.time);
  });

  // replace .at(-1) for compatibility and safety
  let totalTime = entry.log.length ? entry.log[entry.log.length - 1].time : 0;
  setTimeout(() => {
    replaying = false;
    endTime = startTime + totalTime;
    gameOver = true;
    smiley.textContent = win ? "😎" : "😵";
    updateStats();
  }, totalTime);
}

/* --- UI & RENDERING --- */

function updateStats(){
  if(!showStats || (!gameOver && !replaying)){
    statsDiv.textContent = "";
    return;
  }

  // compute elapsed safely: use endTime if game over, otherwise use now; fall back to 0 if startTime missing
  let elapsed = 0;
  if(startTime){
    const reference = gameOver ? (endTime || performance.now()) : performance.now();
    elapsed = (reference - startTime) / 1000;
  }

  // Efficiency (3BV per click) - safe formatting
  let eff = clickCount ? ((threeBV / clickCount) * 100).toFixed(1) + "%" : "N/A";

  // 3BV/s - only compute when elapsed is positive finite
  let bvps = "N/A";
  if(Number.isFinite(elapsed) && elapsed > 0){
    bvps = (threeBV / elapsed).toFixed(2);
  }

  const timeText = (Number.isFinite(elapsed) && elapsed > 0) ? `${elapsed.toFixed(3)}s` : "N/A";

  statsDiv.textContent =
    `${win ? 'Win' : 'Lose'} | Time: ${timeText} | 3BV=${threeBV} | 3BV/s=${bvps} | Clicks=${clickCount} | Efficiency=${eff}`;
}

function updateUI(){
  let flaggedCount = flagged.reduce((s, row) => s + row.filter(Boolean).length, 0);
  let minesLeft = MINES - flaggedCount;
  mineCounter.textContent = String(Math.max(0, minesLeft)).padStart(3,"0");

  let elapsed = startTime ? ((gameOver ? endTime : performance.now()) - startTime) / 1000 : 0;
  timer.textContent = Math.max(0, elapsed).toFixed(3).padStart(7,"0");
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
    let x=c*TILE,y=r*TILE;
    ctx.strokeStyle="#808080";
    if(revealed[r][c]){
      ctx.fillStyle="#ddd"; ctx.fillRect(x,y,TILE,TILE); ctx.strokeRect(x,y,TILE,TILE);
      if(grid[r][c]>0){
        ctx.fillStyle=["","blue","green","red","purple","orange","turquoise","black","gray"][grid[r][c]];
        ctx.font="bold 18px Arial";
        ctx.fillText(grid[r][c],x+TILE/2-4,y+TILE/2+6);
      }
      if(grid[r][c]===-1){
        ctx.fillStyle="black";
        ctx.beginPath();
        ctx.arc(x+TILE/2,y+TILE/2,10,0,Math.PI*2);
        ctx.fill();
      }
    }else{
      ctx.fillStyle="#aaa"; ctx.fillRect(x,y,TILE,TILE); ctx.strokeRect(x,y,TILE,TILE);
      if(flagged[r][c]){
        ctx.fillStyle="red";
        ctx.beginPath();
        ctx.arc(x+TILE/2,y+TILE/2,8,0,Math.PI*2);
        ctx.fill();
      }
      
      // HINT MODE: Display probability on unrevealed cells
      if(hintMode) {
          let probEntry = cellProbabilities.find(p => p.r === r && p.c === c);
          if(probEntry) {
              let percent = Math.round(probEntry.probability * 100);
              
              // Color code: Green (safe) -> Yellow (medium) -> Red (dangerous)
              if(percent < 30) {
                  ctx.fillStyle = "#00aa00"; // Green
              } else if(percent < 60) {
                  ctx.fillStyle = "#ffaa00"; // Orange
              } else {
                  ctx.fillStyle = "#dd0000"; // Red
              }
              
              ctx.font = "bold 10px Arial";
              ctx.fillText(percent + "%", x+3, y+TILE-3);
          }
      }
    }
    if(gameOver && grid[r][c]===-1 && !revealed[r][c]){
      ctx.fillStyle="#f00"; ctx.fillRect(x,y,TILE,TILE); ctx.strokeRect(x,y,TILE,TILE);
    }
  }
}

/* --- LOOP & START --- */
let running = true;
function renderLoop(){
  updateUI();
  draw();
  if(running) requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);
setDifficulty();

// Initialize long press duration from localStorage
longPressDuration = loadLongPressDuration();
longPressDurationInput.value = longPressDuration;
longPressDurationValue.textContent = longPressDuration + "ms";

// Initialize show delete button from localStorage
showDeleteButton = loadShowDeleteButton();
deleteButtonToggle.checked = showDeleteButton;

const themePicker = document.getElementById("themeColor");

function applyTheme(base) {
  document.documentElement.style.setProperty("--ui-bg", base);

  // darker border
  document.documentElement.style.setProperty(
    "--ui-border",
    shade(base, -40)
  );

  document.documentElement.style.setProperty(
    "--ui-dark",
    shade(base, -80)
  );

  document.documentElement.style.setProperty(
    "--ui-light",
    shade(base, 40)
  );
}

// Simple color shading
function shade(hex, percent) {
  let r = parseInt(hex.slice(1,3),16);
  let g = parseInt(hex.slice(3,5),16);
  let b = parseInt(hex.slice(5,7),16);

  r = Math.min(255, Math.max(0, r + percent));
  g = Math.min(255, Math.max(0, g + percent));
  b = Math.min(255, Math.max(0, b + percent));

  return `rgb(${r},${g},${b})`;
}

themePicker.addEventListener("input", e => {
  applyTheme(e.target.value);
  localStorage.setItem("ms_theme", e.target.value);
});

const savedTheme = localStorage.getItem("ms_theme");
if (savedTheme) {
  themePicker.value = savedTheme;
  applyTheme(savedTheme);
}
