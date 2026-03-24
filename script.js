"use strict";
/* --- SERVICE WORKER REGISTRATION --- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js")
    .catch(err => console.warn("SW registration failed:", err));
}

/* --- CONFIGURATION --- */
// Standard Minesweeper difficulty presets
let difficulties = {
  easy: {rows:9, cols:9, mines:10},
  intermediate: {rows:16, cols:16, mines:40},
  hard: {rows:16, cols:30, mines:99}
};

/* --- DOM ELEMENTS & STATE VARIABLES --- */
let currentDifficulty = "easy";
const difficultySelect = document.getElementById("difficulty");

// Event listener to change difficulty and reset board
difficultySelect.addEventListener("change",()=>{ 
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
const mobileCheckbox = document.getElementById("mobileMode");

let ROWS, COLS, MINES, TILE = 32; // TILE is the pixel size of one square
let grid;       // Stores numbers (0-8) or mine (-1)
let revealed;   // Boolean array: is cell open?
let flagged;    // Boolean array: is cell flagged?
let minesSet;   // Set to track mine locations

// Game State Tracking
let firstClick = true, gameOver = false, win = false;
let startTime = null, endTime = null;
let clickCount = 0;
let threeBV = 0; // "Bechtel's Board Benchmark"
let moveLog = [];

// UI State
let replaying = false, replayStartTime = 0;
let flagMode = false, mobileMode = false, showStats = true;

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

/* --- EVENT LISTENERS --- */

// Toggle mobile mode
mobileCheckbox.addEventListener("change", e => { 
    mobileMode = e.target.checked; 
    flagToggle.style.display = mobileMode ? "inline-block" : "none"; 
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
window.addEventListener('resize', () => {
  if(!gameOver && !replaying) {
    setDifficulty();
  }
});

function init(customMines = null){
  grid = Array.from({length:ROWS}, () => Array(COLS).fill(0));
  revealed = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  flagged = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  minesSet = new Set(customMines || []);
  
  firstClick = true; gameOver = false; win = false; 
  startTime = null; endTime = null; 
  clickCount = 0; threeBV = 0; moveLog = []; replaying = false;
  
  smiley.textContent = "😊";
  updateUI(); draw(); updateStats(); updateLeaderboard();
}

/* --- CORE GAME LOGIC --- */

function placeMinesSafe(r0, c0, customMines = null){
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
        if(grid[r][c] != -1 && !revealed[r][c]) return false; 
    return true; 
}

/* --- INPUT HANDLING --- */

function handleClick(r, c, type, logMove = true, replayMove = false){
  if(gameOver && !replayMove) return;

  if(firstClick && type === 'reveal'){ placeMinesSafe(r, c); firstClick = false; }
  if(!startTime && !replayMove) startTime = performance.now();

  let countedClick = false;
  if(type === 'reveal'){
    let isChord = revealed[r][c];  // Track if this is a chord
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

canvas.addEventListener("mousedown", e => { if(gameOver || replaying) return; smiley.textContent = "😮"; });
canvas.addEventListener("mouseup", e => { if(gameOver) return; smiley.textContent = "😊"; });

canvas.addEventListener("mousedown", e => {
  if(replaying) return;
  let rect = canvas.getBoundingClientRect();
  let r = Math.floor((e.clientY - rect.top) / TILE);
  let c = Math.floor((e.clientX - rect.left) / TILE);
  let type = (e.button === 2) ? 'flag' : (flagMode ? 'flag' : 'reveal');
  handleClick(r, c, type);
});

canvas.addEventListener("contextmenu", e => e.preventDefault());
smiley.addEventListener("click", () => { if(!replaying) init(); });
statsDiv.addEventListener("click", () => { if(bestScores[currentDifficulty]?.[0]) replay(bestScores[currentDifficulty][0]); });

/* --- LEADERBOARD & REPLAY --- */

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
  leaderboardDiv.innerHTML = "";
  if(!bestScores[currentDifficulty]) return;
  bestScores[currentDifficulty].slice(0, 50).forEach((e, i) => {
    let d = document.createElement("div");
    let eff = e.clickCount ? ((e.threeBV / e.clickCount) * 100).toFixed(1) + "%" : "N/A";
    d.className = "leaderboard-entry";
    d.textContent = `#${i+1}: ${e.time.toFixed(3)}s | 3BV=${e.threeBV} | 3BV/s=${(e.threeBV/e.time).toFixed(2)} | Eff=${eff}`;
    d.onclick = () => replay(e);
    leaderboardDiv.appendChild(d);
  });
}

function replay(entry){
  if(replaying) return;
  replaying = true;
  firstClick = false; gameOver = false; win = entry.win;

  grid = Array.from({length:ROWS}, () => Array(COLS).fill(0));
  revealed = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  flagged = Array.from({length:ROWS}, () => Array(COLS).fill(false));
  
  minesSet = new Set(entry.mines);
  for(let rc of minesSet){ let [r,c] = rc.split(",").map(Number); grid[r][c] = -1; }

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
  timer.textContent = elapsed.toFixed(3).padStart(7,"0");
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
  let r = parseInt(hex.substr(1,2),16);
  let g = parseInt(hex.substr(3,2),16);
  let b = parseInt(hex.substr(5,2),16);

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
