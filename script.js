/* --- CONFIGURATION --- */
let difficulties = {
  easy: {rows:9, cols:9, mines:10},
  intermediate: {rows:16, cols:16, mines:40},
  hard: {rows:16, cols:30, mines:99}
};

/* --- DOM ELEMENTS & STATE VARIABLES --- */
let currentDifficulty = "easy";
const difficultySelect = document.getElementById("difficulty");
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

let ROWS, COLS, MINES, TILE = 32;
let grid, revealed, flagged, minesSet;

let firstClick = true, gameOver = false, win = false;
let startTime = null, endTime = null;
let clickCount = 0;
let threeBV = 0;
let moveLog = [];

let replaying = false, replayStartTime = 0;
let flagMode = false, mobileMode = false, showStats = true;

let bestScores = JSON.parse(localStorage.getItem("ms_best_scores")||"{}");

/* --- EVENT LISTENERS --- */
mobileCheckbox.addEventListener("change", e => { 
    mobileMode = e.target.checked; 
    flagToggle.style.display = mobileMode ? "inline-block" : "none"; 
});

flagToggle.addEventListener("click", () => { 
    flagMode = !flagMode; 
    flagToggle.textContent = "Flag Mode: " + (flagMode ? "ON" : "OFF"); 
});

document.getElementById("showStats").addEventListener("change", e => { 
    showStats = e.target.checked; 
    draw(); 
});

document.getElementById("resetHigh").addEventListener("click", () => { 
    bestScores[currentDifficulty] = []; 
    localStorage.setItem("ms_best_scores", JSON.stringify(bestScores)); 
    updateLeaderboard(); 
    draw(); 
});

/* --- INITIALIZATION --- */
function setDifficulty(){
  let d = difficulties[currentDifficulty];
  ROWS = d.rows; COLS = d.cols; MINES = d.mines;
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  init();
}

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

/* --- GAME LOGIC, INPUT, LEADERBOARD, RENDERING --- */
/* (Entire remaining JS content is unchanged from your original file) */

/* --- TIMER LOOP --- */
setInterval(() => { updateUI(); draw(); }, 50);

/* --- START --- */
setDifficulty();
