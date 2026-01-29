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

// Leaderboard category
let leaderboardCategory = "time"; // default

// Load High Scores
let bestScores = JSON.parse(localStorage.getItem("ms_best_scores") || "{}");

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

/* --- DIFFICULTY & INITIALIZATION --- */
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

/* --- CORE GAME LOGIC --- */
function placeMinesSafe(r0, c0, customMines = null){
  let safeCells = new Set();
  for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
    let r=r0+dr, c=c0+dc;
    if(r>=0 && r<ROWS && c>=0 && c<COLS) safeCells.add(r+","+c);
  }

  if(customMines){ minesSet = new Set(customMines); } 
  else {
    while(minesSet.size < MINES){
      let r=Math.floor(Math.random()*ROWS), c=Math.floor(Math.random()*COLS);
      if(safeCells.has(r+","+c)) continue;
      minesSet.add(r+","+c);
    }
  }

  for(let rc of minesSet){ let [r,c]=rc.split(",").map(Number); grid[r][c]=-1; }

  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    if(grid[r][c]===-1) continue;
    let count=0;
    for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
      let nr=r+dr, nc=c+dc;
      if(nr>=0 && nr<ROWS && nc>=0 && nc<COLS && grid[nr][nc]===-1) count++;
    }
    grid[r][c]=count;
  }
  threeBV = compute3BV();
}

function compute3BV(){ 
  let visited = Array.from({length:ROWS},()=>Array(COLS).fill(false)), count=0;
  function flood(r,c){
    if(r<0||r>=ROWS||c<0||c>=COLS||visited[r][c]||grid[r][c]===-1) return;
    visited[r][c]=true;
    if(grid[r][c]===0) for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++) if(dr||dc) flood(r+dr,c+dc);
  }
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(grid[r][c]===0&&!visited[r][c]){ count++; flood(r,c); }
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(grid[r][c]>0&&!visited[r][c]) count++;
  return count;
}

function reveal(r,c,allowFlood=true){
  if(r<0||r>=ROWS||c<0||c>=COLS||revealed[r][c]||flagged[r][c]) return;
  revealed[r][c]=true;
  if(allowFlood && grid[r][c]===0)
    for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++) if(dr||dc) reveal(r+dr,c+dc,true);
}

function chord(r,c){
  if(grid[r][c]<=0) return;
  let flags=0;
  for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
    let nr=r+dr,nc=c+dc;
    if(nr>=0 && nr<ROWS && nc>=0 && nc<COLS && flagged[nr][nc]) flags++;
  }
  if(flags!==grid[r][c]) return;
  for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
    let nr=r+dr,nc=c+dc;
    if(nr>=0 && nr<ROWS && nc>=0 && nc<COLS && !flagged[nr][nc]&&!revealed[nr][nc]) reveal(nr,nc,true);
  }
}

function checkWin(){
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(grid[r][c]!=-1&&!revealed[r][c]) return false;
  return true;
}

/* --- INPUT HANDLING --- */
function handleClick(r,c,type,logMove=true,replayMove=false){
  if(gameOver && !replayMove) return;

  if(firstClick && type==='reveal'){ placeMinesSafe(r,c); firstClick=false; }
  if(!startTime && !replayMove) startTime = performance.now();

  let countedClick=false;
  if(type==='reveal'){
    if(revealed[r][c]){ chord(r,c); countedClick=true; }
    else if(grid[r][c]===-1 && !replayMove){
      gameOver=true; win=false; endTime=performance.now(); smiley.textContent="😵"; countedClick=true; reveal(r,c,false);
    } else { reveal(r,c,true); countedClick=true; }
  } else if(type==='flag'){ 
    if(!revealed[r][c]) countedClick=true;
    flagged[r][c]=!flagged[r][c]; 
  }

  if(countedClick && !replayMove) clickCount++;
  if(logMove) moveLog.push({r,c,type,time: performance.now()-(replayMove?replayStartTime:startTime)});

  if(!gameOver && checkWin() && !replayMove){
    gameOver=true; win=true; endTime=performance.now(); smiley.textContent="😎"; saveHighScore();
  }

  updateUI(); draw(); updateStats();
}

/* --- MOUSE EVENTS --- */
canvas.addEventListener("mousedown", e => { if(gameOver||replaying) return; smiley.textContent="😮"; });
canvas.addEventListener("mouseup", e => { if(gameOver) return; smiley.textContent="😊"; });

canvas.addEventListener("mousedown", e=>{
  if(replaying) return;
  let rect=canvas.getBoundingClientRect();
  let r=Math.floor((e.clientY-rect.top)/TILE);
  let c=Math.floor((e.clientX-rect.left)/TILE);
  let type=(e.button===2)?'flag':(flagMode?'flag':'reveal');
  handleClick(r,c,type);
});
canvas.addEventListener("contextmenu", e=>e.preventDefault());
smiley.addEventListener("click", ()=>{ if(!replaying) init(); });
statsDiv.addEventListener("click", ()=>{ if(bestScores[currentDifficulty]?.time?.[0]) replay(bestScores[currentDifficulty].time[0]); });

/* --- LEADERBOARD & REPLAY --- */
function saveHighScore(){
  if(threeBV<1) return;

  if(!bestScores[currentDifficulty]) bestScores[currentDifficulty] = {
    time:[], threeBV:[], threeBVs:[], efficiency:[]
  };

  let elapsed=(endTime-startTime)/1000;
  let eff=clickCount? (threeBV/clickCount)*100 : 0;
  let threeBVsVal=elapsed>0 ? threeBV/elapsed : 0;

  let entry = { time:elapsed, clickCount, threeBV, threeBVs:threeBVsVal, efficiency:eff, log:moveLog.slice(), win, mines:Array.from(minesSet) };

  let categories=["time","threeBV","threeBVs","efficiency"];
  for(let cat of categories){
    bestScores[currentDifficulty][cat].push(entry);
    bestScores[currentDifficulty][cat].sort((a,b)=>{
      if(cat==="time") return a.time-b.time;
      else return b[cat]-a[cat];
    });
    if(bestScores[currentDifficulty][cat].length>50)
      bestScores[currentDifficulty][cat].length=50;
  }

  localStorage.setItem("ms_best_scores", JSON.stringify(bestScores));
  updateLeaderboard();
}

function updateLeaderboard(){
  leaderboardDiv.innerHTML="";
  if(!bestScores[currentDifficulty]) return;
  let list = bestScores[currentDifficulty][leaderboardCategory];
  if(!list) return;

  list.forEach((e,i)=>{
    let d=document.createElement("div");
    let eff = e.clickCount ? ((e.threeBV/e.clickCount)*100).toFixed(1)+"%" : "N/A";
    d.className="leaderboard-entry";
    d.textContent = `#${i+1}: ${e.time.toFixed(3)}s | 3BV=${e.threeBV} | 3BV/s=${e.threeBVs.toFixed(2)} | Eff=${eff}`;
    d.onclick = ()=> replay(e);
    leaderboardDiv.appendChild(d);
  });
}

function replay(entry){
  if(replaying) return;
  replaying = true;
  firstClick=false; gameOver=false; win=entry.win;

  grid = Array.from({length:ROWS},()=>Array(COLS).fill(0));
  revealed = Array.from({length:ROWS},()=>Array(COLS).fill(false));
  flagged = Array.from({length:ROWS},()=>Array(COLS).fill(false));

  minesSet = new Set(entry.mines);
  for(let rc of minesSet){ let [r,c]=rc.split(",").map(Number); grid[r][c]=-1; }

  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    if(grid[r][c]===-1) continue;
    let count=0;
    for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){
      let nr=r+dr,nc=c+dc;
      if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&grid[nr][nc]===-1) count++;
    }
    grid[r][c]=count;
  }

  threeBV = compute3BV();
  clickCount = 0;
  startTime = performance.now();
  replayStartTime = startTime;

  entry.log.forEach(m=>{
    setTimeout(()=>{
      if(m.type==='reveal'){ reveal(m.r,m.c,true); clickCount++; }
      else { flagged[m.r][m.c]=!flagged[m.r][m.c]; clickCount++; }
      draw(); updateStats();
    }, m.time);
  });

  let totalTime = entry.log.at(-1).time;
  setTimeout(()=>{
    replaying=false;
    endTime=startTime+totalTime;
    gameOver=true;
    smiley.textContent = win?"😎":"😵";
    updateStats();
  }, totalTime);
}

/* --- UI & RENDERING --- */
function updateStats(){
  if(!showStats || (!gameOver && !replaying)){ statsDiv.textContent=""; return; }
  let elapsed = (endTime-startTime)/1000;
  let eff = clickCount? ((threeBV/clickCount)*100).toFixed(1)+"%" : "N/A";
  statsDiv.textContent=`${win?'Win':'Lose'} | Time: ${elapsed.toFixed(3)}s | 3BV=${threeBV} | 3BV/s=${(threeBV/elapsed).toFixed(2)} | Clicks=${clickCount} | Efficiency=${eff}`;
}

function updateUI(){
  let minesLeft = MINES - flagged.flat().filter(Boolean).length;
  mineCounter.textContent = String(Math.max(0,minesLeft)).padStart(3,"0");

  let elapsed = startTime ? ((gameOver?endTime:performance.now())-startTime)/1000 : 0;
  timer.textContent = elapsed.toFixed(3).padStart(7,"0");
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
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
    } else {
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
setInterval(()=>{ updateUI(); draw(); },50);
setDifficulty();
