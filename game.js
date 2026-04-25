(function () {
'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const GAME_TIME = 120, COURT_L = 55, COURT_W = 28;
const HOOP_H = 4.6, HOOP_R = 0.46, BALL_R = 0.24;
const SPD_WALK = 6, SPD_SPRINT = 10, SPD_ROAR = 16;
const SHOT_SEC = 1.5, SHOT_MIN = 8, SHOT_MAX = 22;
const HAZARD_INT = 14;
const HOOP_FAR  = new BABYLON.Vector3( COURT_L/2 - 2, HOOP_H, 0);
const HOOP_NEAR = new BABYLON.Vector3(-COURT_L/2 + 2, HOOP_H, 0);

// ── State ──────────────────────────────────────────────────────────────────
let engine, scene, camera, shadows;
let playerRoot, animIdle, animJog, animDribble, animShot, curAnim;
let ball, score=0, streak=0, timeLeft=GAME_TIME, gameActive=false;
let charging=false, chargeT=0, shotCD=0;
let roarActive=false, roarTimer=0;
let ballFlight=false, ballOwned=true, flightTimer=0;
let hazards=[], hazardTimer=HAZARD_INT, activeEffect=null;
let keys={}, timerInterval, toastTO;

// ── DOM ────────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('renderCanvas');
const scoreEl     = document.getElementById('score');
const streakEl    = document.getElementById('streak');
const timerEl     = document.getElementById('timer');
const chargeCont  = document.getElementById('charge-container');
const chargeBar   = document.getElementById('charge-bar');
const toastEl     = document.getElementById('toast');
const overlay     = document.getElementById('overlay');
const goOverlay   = document.getElementById('gameover-overlay');
const finalScore  = document.getElementById('final-score');
const finalGrade  = document.getElementById('final-grade');

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', restartGame);

// ── Engine & Scene ─────────────────────────────────────────────────────────
engine = new BABYLON.Engine(canvas, true);
scene  = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.04, 0.02, 0, 1);
scene.enablePhysics(new BABYLON.Vector3(0, -25, 0), new BABYLON.CannonJSPlugin());

// ── Camera ─────────────────────────────────────────────────────────────────
camera = new BABYLON.ArcRotateCamera('cam', -Math.PI/2, 1.1, 14, BABYLON.Vector3.Zero(), scene);

// ── Lighting ───────────────────────────────────────────────────────────────
const amb = new BABYLON.HemisphericLight('amb', new BABYLON.Vector3(0,1,0), scene);
amb.intensity = 0.35; amb.groundColor = new BABYLON.Color3(0.15,0.08,0);
const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1,-2,-1), scene);
sun.position = new BABYLON.Vector3(20,40,20); sun.intensity = 1.1;
sun.diffuse  = new BABYLON.Color3(1, 0.85, 0.6);
shadows = new BABYLON.ShadowGenerator(1024, sun);
shadows.useBlurExponentialShadowMap = true;
[-1,1].forEach(s => {
  const sp = new BABYLON.SpotLight('rim'+s, new BABYLON.Vector3(s*18,22,0),
    new BABYLON.Vector3(0,-1,0), Math.PI/3, 2, scene);
  sp.intensity = 0.7; sp.diffuse = new BABYLON.Color3(1,0.95,0.8);
});

// ── Court ──────────────────────────────────────────────────────────────────
function buildCourt() {
  const floor = BABYLON.MeshBuilder.CreateBox('floor',
    {width: COURT_L+4, height:0.4, depth: COURT_W+4}, scene);
  floor.position.y = -0.2;
  const fm = new BABYLON.StandardMaterial('fm', scene);
  fm.diffuseColor = new BABYLON.Color3(0.52,0.33,0.10);
  fm.specularColor = new BABYLON.Color3(0.08,0.08,0.08);
  floor.material = fm; floor.receiveShadows = true;
  floor.physicsImpostor = new BABYLON.PhysicsImpostor(
    floor, BABYLON.PhysicsImpostor.BoxImpostor, {mass:0, restitution:0.5}, scene);

  // Court lines
  const lineMat = new BABYLON.StandardMaterial('lm', scene);
  lineMat.diffuseColor = new BABYLON.Color3(0.9,0.8,0.5);
  lineMat.emissiveColor = new BABYLON.Color3(0.15,0.1,0);
  [[0,0,0.25,COURT_W],[0,0,COURT_W*0.4,0.25]].forEach(([x,z,w,d],i) => {
    const l = BABYLON.MeshBuilder.CreateBox('ln'+i,{width:w,height:0.02,depth:d},scene);
    l.position.set(x,0.01,z); l.material = lineMat;
  });

  // Invisible walls
  [{p:[ COURT_L/2+0.5,2,0], s:{width:1,height:5,depth:COURT_W+4}},
   {p:[-COURT_L/2-0.5,2,0], s:{width:1,height:5,depth:COURT_W+4}},
   {p:[0,2, COURT_W/2+0.5], s:{width:COURT_L+4,height:5,depth:1}},
   {p:[0,2,-COURT_W/2-0.5], s:{width:COURT_L+4,height:5,depth:1}},
  ].forEach((w,i) => {
    const m = BABYLON.MeshBuilder.CreateBox('wall'+i, w.s, scene);
    m.position.set(...w.p); m.isVisible=false;
    m.physicsImpostor = new BABYLON.PhysicsImpostor(
      m, BABYLON.PhysicsImpostor.BoxImpostor, {mass:0,restitution:0.4}, scene);
  });

  // Stands silhouette
  const sm = new BABYLON.StandardMaterial('standm', scene);
  sm.diffuseColor = new BABYLON.Color3(0.12,0.10,0.08);
  sm.emissiveColor = new BABYLON.Color3(0.03,0.02,0);
  [-1,1].forEach(s => {
    const st = BABYLON.MeshBuilder.CreateBox('stand',
      {width:COURT_L+8,height:7,depth:4},scene);
    st.position.set(0,2,s*(COURT_W/2+6)); st.material=sm;
  });
}

// ── Hoop ───────────────────────────────────────────────────────────────────
function buildHoop(pos) {
  const poleMat = new BABYLON.StandardMaterial('poleMat',scene);
  poleMat.diffuseColor = new BABYLON.Color3(0.75,0.75,0.75);
  const rimMat = new BABYLON.StandardMaterial('rimMat',scene);
  rimMat.diffuseColor = new BABYLON.Color3(1,0.38,0);
  rimMat.emissiveColor = new BABYLON.Color3(0.25,0.08,0);

  const pole = BABYLON.MeshBuilder.CreateCylinder('pole',
    {height:pos.y, diameter:0.14, tessellation:8},scene);
  pole.position.set(pos.x, pos.y/2, pos.z); pole.material=poleMat;

  const arm = BABYLON.MeshBuilder.CreateBox('arm',
    {width:1.2,height:0.1,depth:0.1},scene);
  arm.position.set(pos.x+(pos.x>0?-0.6:0.6), pos.y+0.05, pos.z);
  arm.material=poleMat;

  const bb = BABYLON.MeshBuilder.CreateBox('bb',
    {width:0.18,height:1.1,depth:1.7},scene);
  bb.position.set(pos.x+(pos.x>0?-1.3:1.3), pos.y+0.55, pos.z);
  const bbm = new BABYLON.StandardMaterial('bbm',scene);
  bbm.diffuseColor=new BABYLON.Color3(0.9,0.9,1); bbm.alpha=0.75;
  bb.material=bbm;
  bb.physicsImpostor=new BABYLON.PhysicsImpostor(
    bb,BABYLON.PhysicsImpostor.BoxImpostor,{mass:0,restitution:0.55},scene);

  const rim = BABYLON.MeshBuilder.CreateTorus('rim',
    {diameter:HOOP_R*2, thickness:0.05, tessellation:24},scene);
  rim.position.copyFrom(pos); rim.rotation.x=Math.PI/2; rim.material=rimMat;

  const net = BABYLON.MeshBuilder.CreateCylinder('net',
    {height:0.55,diameterTop:HOOP_R*1.8,diameterBottom:HOOP_R*0.85,tessellation:14},scene);
  net.position.set(pos.x,pos.y-0.28,pos.z);
  const nm=new BABYLON.StandardMaterial('nm',scene);
  nm.diffuseColor=new BABYLON.Color3(1,1,1); nm.wireframe=true;
  net.material=nm;

  shadows.addShadowCaster(bb); shadows.addShadowCaster(rim);

  // Scoring trigger
  const trig = BABYLON.MeshBuilder.CreateCylinder('trig'+pos.x,
    {height:0.3,diameter:HOOP_R*2.1,tessellation:14},scene);
  trig.position.set(pos.x,pos.y-0.15,pos.z);
  trig.isVisible=false; trig.isPickable=false;
  return trig;
}

// ── Ball ───────────────────────────────────────────────────────────────────
function buildBall() {
  ball = BABYLON.MeshBuilder.CreateSphere('ball',{diameter:BALL_R*2,segments:12},scene);
  const m = new BABYLON.StandardMaterial('ballm',scene);
  m.diffuseColor=new BABYLON.Color3(0.88,0.38,0.04);
  m.emissiveColor=new BABYLON.Color3(0.1,0.04,0);
  m.specularColor=new BABYLON.Color3(0.4,0.4,0.4);
  ball.material=m;
  ball.physicsImpostor=new BABYLON.PhysicsImpostor(
    ball,BABYLON.PhysicsImpostor.SphereImpostor,{mass:0.6,restitution:0.7,friction:0.5},scene);
  shadows.addShadowCaster(ball);
}


// ── Fallback lion character (no blocky shapes) ─────────────────────────────
function buildLion() {
  const root = new BABYLON.TransformNode('playerRoot', scene);
  const gold = new BABYLON.StandardMaterial('gold',scene);
  gold.diffuseColor = new BABYLON.Color3(0.84,0.60,0.20);
  const dark = new BABYLON.StandardMaterial('dark',scene);
  dark.diffuseColor = new BABYLON.Color3(0.48,0.26,0.05);
  dark.emissiveColor = new BABYLON.Color3(0.08,0.03,0);
  const charcoal = new BABYLON.StandardMaterial('cc',scene);
  charcoal.diffuseColor = new BABYLON.Color3(0.1,0.08,0.06);

  const mkSph = (n,d,px,py,pz,mat,sx=1,sy=1,sz=1) => {
    const m=BABYLON.MeshBuilder.CreateSphere(n,{diameter:d,segments:10},scene);
    m.parent=root; m.position.set(px,py,pz); m.material=mat;
    m.scaling.set(sx,sy,sz); return m;
  };
  const mkCyl = (n,h,dt,db,px,py,pz,mat,rx=0,ry=0,rz=0) => {
    const m=BABYLON.MeshBuilder.CreateCylinder(n,{height:h,diameterTop:dt,diameterBottom:db,tessellation:12},scene);
    m.parent=root; m.position.set(px,py,pz); m.material=mat;
    m.rotation.set(rx,ry,rz); return m;
  };

  mkCyl('body', 1.1, 0.54, 0.68, 0, 0.95, 0, gold);          // torso
  mkSph('hips', 0.70, 0, 0.42, 0, gold, 1, 0.7, 1);           // hips
  mkSph('head', 0.60, 0, 1.72, 0, gold);                       // head
  // mane
  const mane=BABYLON.MeshBuilder.CreateTorus('mane',{diameter:0.74,thickness:0.22,tessellation:20},scene);
  mane.parent=root; mane.position.y=1.72; mane.material=dark;
  // snout
  mkCyl('snout',0.22,0.19,0.27,0.30,1.62,0,
    (() => { const m=new BABYLON.StandardMaterial('snm',scene);
             m.diffuseColor=new BABYLON.Color3(0.94,0.78,0.52); return m; })(),
    0, 0, -Math.PI/2);
  // eyes
  [-1,1].forEach(s => mkSph('eye',0.10,0.22,1.76,s*0.15,
    (() => { const m=new BABYLON.StandardMaterial('em',scene);
             m.diffuseColor=new BABYLON.Color3(0.08,0.08,0.08);
             m.emissiveColor=new BABYLON.Color3(0.25,0.25,0); return m; })()));
  // ears
  [-1,1].forEach(s => mkCyl('ear',0.20,0.05,0.15,0.10,2.02,s*0.24,gold,0,0,s*0.3));
  // arms
  [-1,1].forEach(s => {
    mkCyl('uarm'+s,0.50,0.15,0.20,0.15,1.30,s*0.42,gold,s*0.3,0,0);
    mkSph('hand'+s,0.22,0.15,1.00,s*0.55,gold);
  });
  // legs & feet
  [-1,1].forEach(s => {
    mkCyl('leg'+s,0.65,0.23,0.17,0,0.02,s*0.22,gold);
    mkSph('foot'+s,0.24,0.08,-0.28,s*0.22,charcoal,1.5,0.65,1);
  });
  // tail
  mkCyl('tail',0.80,0.06,0.14,-0.35,0.65,0,gold,0,0,-0.6);
  mkSph('tailtip',0.18,-0.70,0.32,0,dark);

  [root].forEach(m => shadows.addShadowCaster(m, true));
  return root;
}

async function loadCharacter() {
  try {
    const r = await BABYLON.SceneLoader.ImportMeshAsync('','./',
      'basketball_character_3d_model_for_games.glb', scene);
    const root = r.meshes[0];
    root.name='playerRoot';
    root.scaling.setAll(0.018);
    shadows.addShadowCaster(root, true);

    const groups = scene.animationGroups;
    animIdle    = groups.find(g=>g.name.match(/idle/i))    || groups[0];
    animJog     = groups.find(g=>g.name.match(/jog|walk/i))|| groups[0];
    animDribble = groups.find(g=>g.name.match(/dribble/i)) || animJog;
    animShot    = groups.find(g=>g.name.match(/shot|shoot/i))||animJog;
    if (animIdle) { animIdle.start(true); curAnim=animIdle; }
    return root;
  } catch(e) {
    console.warn('GLB load failed, using lion character:', e);
    return buildLion();
  }
}

function playAnim(a) {
  if (!a || a===curAnim) return;
  if (curAnim) curAnim.stop();
  a.start(a!==animShot); curAnim=a;
}

// ── Hazards ────────────────────────────────────────────────────────────────
const HAZARD_TYPES = [
  {type:'lava',  color:new BABYLON.Color3(1,0.14,0),  em:new BABYLON.Color3(0.35,0.04,0),  fx:'damage'},
  {type:'ice',   color:new BABYLON.Color3(0.55,0.88,1),em:new BABYLON.Color3(0,0.12,0.35), fx:'slide'},
  {type:'vines', color:new BABYLON.Color3(0.10,0.60,0.10),em:new BABYLON.Color3(0,0.12,0),fx:'slow'},
];

function spawnHazard() {
  if (hazards.length >= 4) { hazards.shift().dispose(); }
  const def = HAZARD_TYPES[Math.floor(Math.random()*3)];
  const hw=3+Math.random()*4, hd=3+Math.random()*4;
  const hx=(Math.random()-0.5)*(COURT_L-hw-4);
  const hz=(Math.random()-0.5)*(COURT_W-hd-2);
  const mesh=BABYLON.MeshBuilder.CreateBox('haz',{width:hw,height:0.07,depth:hd},scene);
  mesh.position.set(hx,0.02,hz);
  const m=new BABYLON.StandardMaterial('hm'+Date.now(),scene);
  m.diffuseColor=def.color; m.emissiveColor=def.em; m.alpha=0.78;
  mesh.material=m;
  mesh._fx=def.fx;
  mesh._b={x0:hx-hw/2,x1:hx+hw/2,z0:hz-hd/2,z1:hz+hd/2};
  if (def.type==='lava') {
    let t=0;
    const ob=()=>{ if(!mesh.isDisposed()){t+=0.06;
      m.emissiveColor=new BABYLON.Color3(0.28+0.1*Math.sin(t),0.02,0); }};
    scene.registerBeforeRender(ob);
  }
  hazards.push(mesh);
  const labels={lava:'🔥 LAVA ZONE!',ice:'❄ ICE FIELD!',vines:'🌿 VINE TRAP!'};
  showToast(labels[def.type]);
}

function checkHazard(x,z) {
  activeEffect=null;
  for (const h of hazards) {
    const b=h._b;
    if (x>b.x0&&x<b.x1&&z>b.z0&&z<b.z1){ activeEffect=h._fx; break; }
  }
}

// ── Input ──────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e=>{
  keys[e.code]=true;
  if (e.code==='Space'){
    e.preventDefault();
    if (gameActive&&ballOwned&&!ballFlight&&!charging) beginCharge();
  }
  if (e.code==='KeyR' && gameActive) doRoar();
});
window.addEventListener('keyup', e=>{
  keys[e.code]=false;
  if (e.code==='Space' && charging) fireShot();
});

function beginCharge(){charging=true;chargeT=0;chargeCont.style.display='block';}
function fireShot(){
  if(!charging)return;
  charging=false; chargeCont.style.display='none'; chargeBar.style.width='0%';
  launchBall();
}
function doRoar(){if(roarActive)return;roarActive=true;roarTimer=2;showToast('ROAR!');}

// ── Shoot ──────────────────────────────────────────────────────────────────
function launchBall(){
  if(!playerRoot)return;
  const power=SHOT_MIN+(chargeT/SHOT_SEC)*(SHOT_MAX-SHOT_MIN);
  const startPos=playerRoot.position.clone(); startPos.y+=1.8;
  ball.position.copyFrom(startPos);
  const hp=HOOP_FAR;
  const dir=hp.subtract(startPos).normalize();
  const dist=BABYLON.Vector3.Distance(startPos,hp);
  ball.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(
    dir.x*power, Math.max(0.45,dist*0.11)*power*0.55, dir.z*power));
  ballFlight=true; ballOwned=false; shotCD=2.5; flightTimer=0;
  playAnim(animShot);
}

// ── Scoring ────────────────────────────────────────────────────────────────
function checkScore(){
  if(!ballFlight)return;
  const bp=ball.position, hp=HOOP_FAR;
  const hdist=Math.sqrt((bp.x-hp.x)**2+(bp.z-hp.z)**2);
  if(hdist<HOOP_R && Math.abs(bp.y-hp.y)<0.35 && bp.y<hp.y+0.1){
    const pts=streak>=3?3:2;
    score+=pts; streak++;
    scoreEl.textContent=score; streakEl.textContent=streak;
    showToast(streak>=5?'ON FIRE! 🔥':streak>=3?'STREAK x'+streak:'BASKET! +'+pts);
    recoverBall();
  }
  if(bp.y<-3){ streak=0; streakEl.textContent=0; recoverBall(); }
}

function recoverBall(){
  ballFlight=false; ballOwned=true; flightTimer=0;
  ball.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
  ball.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
  if(playerRoot) playerRoot.position.set(0,0,0);
}


// ── Player movement ────────────────────────────────────────────────────────
function updatePlayer(dt){
  if(!playerRoot||!gameActive)return;
  const mx=(keys['KeyD']?1:0)-(keys['KeyA']?1:0);
  const mz=(keys['KeyS']?1:0)-(keys['KeyW']?1:0);
  const moving=mx||mz;
  let spd=SPD_WALK;
  if(keys['ShiftLeft']||keys['ShiftRight']) spd=SPD_SPRINT;
  if(roarActive) spd=SPD_ROAR;
  if(activeEffect==='slow')  spd*=0.4;
  if(activeEffect==='slide') spd*=1.35;

  if(moving){
    const len=Math.sqrt(mx*mx+mz*mz);
    const nx=mx/len, nz=mz/len;
    playerRoot.position.x=Math.max(-COURT_L/2+1,Math.min(COURT_L/2-1,
      playerRoot.position.x+nx*spd*dt));
    playerRoot.position.z=Math.max(-COURT_W/2+1,Math.min(COURT_W/2-1,
      playerRoot.position.z+nz*spd*dt));
    playerRoot.rotation.y=Math.atan2(nx,nz);
    playAnim(animJog);
  } else {
    playAnim(ballOwned?(animDribble||animIdle):animIdle);
  }

  // Ball follows hand when owned
  if(ballOwned){
    ball.position.set(
      playerRoot.position.x+0.4,
      playerRoot.position.y+1.15,
      playerRoot.position.z+0.3);
    ball.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
  }

  // Charge bar update
  if(charging){
    chargeT=Math.min(chargeT+dt, SHOT_SEC);
    chargeBar.style.width=((chargeT/SHOT_SEC)*100)+'%';
  }

  // Smooth 3rd-person camera follow
  const camTarget=playerRoot.position.add(new BABYLON.Vector3(0,1.5,0));
  camera.target=BABYLON.Vector3.Lerp(camera.target, camTarget, 0.1);

  checkHazard(playerRoot.position.x, playerRoot.position.z);
}

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer(){
  timeLeft=GAME_TIME; updateTimerUI();
  timerInterval=setInterval(()=>{
    if(!gameActive)return;
    timeLeft--;
    updateTimerUI();
    if(timeLeft<=10) timerEl.classList.add('danger');
    if(timeLeft<=0)  endGame();
  },1000);
}
function updateTimerUI(){
  const m=Math.floor(timeLeft/60), s=timeLeft%60;
  timerEl.textContent=m+':'+(s<10?'0':'')+s;
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg){
  clearTimeout(toastTO);
  toastEl.textContent=msg; toastEl.classList.add('show');
  toastTO=setTimeout(()=>toastEl.classList.remove('show'),1800);
}

// ── Atmosphere ─────────────────────────────────────────────────────────────
function buildAtmosphere(){
  scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
  scene.fogColor=new BABYLON.Color3(0.05,0.02,0.01);
  scene.fogDensity=0.012;

  const ps=new BABYLON.ParticleSystem('embers',50,scene);
  ps.emitter=new BABYLON.Vector3(0,1,0);
  ps.createBoxEmitter(
    new BABYLON.Vector3(-COURT_L/2,0,-COURT_W/2),
    new BABYLON.Vector3( COURT_L/2,0, COURT_W/2),
    new BABYLON.Vector3(-0.5,1,-0.5), new BABYLON.Vector3(0.5,3,0.5));
  try {
    ps.particleTexture=new BABYLON.Texture(
      'https://assets.babylonjs.com/particles/flare.png',scene);
  } catch(e){}
  ps.color1=new BABYLON.Color4(1,0.4,0,0.5);
  ps.color2=new BABYLON.Color4(1,0.8,0,0.25);
  ps.colorDead=new BABYLON.Color4(0,0,0,0);
  ps.minSize=0.04; ps.maxSize=0.13;
  ps.minLifeTime=2; ps.maxLifeTime=5;
  ps.emitRate=6;
  ps.minEmitPower=0.2; ps.maxEmitPower=0.8;
  ps.gravity=new BABYLON.Vector3(0,0.4,0);
  ps.blendMode=BABYLON.ParticleSystem.BLENDMODE_ADD;
  ps.start();
}

// ── Game lifecycle ─────────────────────────────────────────────────────────
function startGame(){
  overlay.classList.remove('active');
  gameActive=true; score=0; streak=0;
  scoreEl.textContent=0; streakEl.textContent=0;
  timerEl.classList.remove('danger');
  hazards.forEach(h=>h.dispose()); hazards=[];
  hazardTimer=HAZARD_INT;
  recoverBall();
  startTimer();
  showToast('ROAR!');
}
function restartGame(){ goOverlay.classList.remove('active'); startGame(); }
function endGame(){
  gameActive=false; clearInterval(timerInterval);
  goOverlay.classList.add('active');
  finalScore.textContent=score;
  finalGrade.textContent=
    score>=50?'THE G.O.A.T.':score>=35?'ALL-STAR':
    score>=20?'MVP':score>=10?'ROOKIE':'KEEP ROARING';
}

// ── Render loop ────────────────────────────────────────────────────────────
let lastT=performance.now();
engine.runRenderLoop(()=>{
  const now=performance.now(), dt=Math.min((now-lastT)/1000,0.1); lastT=now;
  if(gameActive){
    updatePlayer(dt);
    checkScore();
    hazardTimer-=dt;
    if(hazardTimer<=0){ hazardTimer=HAZARD_INT; spawnHazard(); }
    if(roarActive){ roarTimer-=dt; if(roarTimer<=0) roarActive=false; }
    if(shotCD>0) shotCD-=dt;
    if(ballFlight){
      flightTimer+=dt;
      if(flightTimer>4.5){ streak=0; streakEl.textContent=0; recoverBall(); }
    }
  }
  scene.render();
});
window.addEventListener('resize',()=>engine.resize());

// ── Boot ───────────────────────────────────────────────────────────────────
async function init(){
  buildCourt();
  buildHoop(HOOP_FAR);
  buildHoop(HOOP_NEAR);
  buildBall();
  playerRoot=await loadCharacter();
  buildAtmosphere();
  console.log('Roar Ball ready');
}
init().catch(console.error);

})();
