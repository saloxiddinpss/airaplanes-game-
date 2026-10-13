// ==========================================
// ТАНЧИКИ 3D — Three.js + First Person
// Управление: только стрелки + Space
// ==========================================

const TILE = 2;
const COLS = 13;
const ROWS = 13;
const HALF = (COLS * TILE) / 2;
const EAGLE_COL = 6;
const EAGLE_ROW = 12;
const CAMERA_HEIGHT = 1.3;
const TURN_SPEED = 2.2;

// ==========================================
// ЗВУКОВАЯ СИСТЕМА
// ==========================================
class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }
    init() {
        if (this.ctx) return;
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { this.enabled = false; }
    }
    ensure() {
        if (!this.ctx) this.init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }
    setEnabled(v) { this.enabled = v; if (v) this.ensure(); }

    tone(freq, dur, type = 'square', vol = 0.1, slideTo = null) {
        if (!this.enabled) return;
        this.ensure(); if (!this.ctx) return;
        try {
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(freq, this.ctx.currentTime);
            if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), this.ctx.currentTime + dur);
            g.gain.setValueAtTime(vol, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
            o.connect(g); g.connect(this.ctx.destination);
            o.start(); o.stop(this.ctx.currentTime + dur);
        } catch (e) {}
    }
    noise(dur, vol = 0.2, filterFreq = 1000) {
        if (!this.enabled) return;
        this.ensure(); if (!this.ctx) return;
        try {
            const bufSize = this.ctx.sampleRate * dur;
            const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
            const src = this.ctx.createBufferSource();
            src.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(filterFreq, this.ctx.currentTime);
            filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + dur);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(vol, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
            src.connect(filter); filter.connect(g); g.connect(this.ctx.destination);
            src.start(); src.stop(this.ctx.currentTime + dur);
        } catch (e) {}
    }
    shoot()       { this.tone(880, 0.08, 'square', 0.08, 220); }
    enemyShoot()  { this.tone(440, 0.1, 'square', 0.05, 180); }
    brickHit()    { this.noise(0.08, 0.15, 2000); }
    steelHit()    { this.tone(1200, 0.05, 'square', 0.08); this.tone(800, 0.06, 'square', 0.06); }
    explosion()   { this.noise(0.4, 0.3, 1500); this.tone(150, 0.3, 'sawtooth', 0.15, 40); }
    playerHit()   { this.tone(300, 0.3, 'sawtooth', 0.15, 80); this.noise(0.3, 0.2, 800); }
    victory()     { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.tone(f,0.2,'square',0.12), i*150)); }
    gameOver()    { [392,330,262,196].forEach((f,i)=>setTimeout(()=>this.tone(f,0.35,'sawtooth',0.12), i*200)); }
    spawn()       { this.tone(200, 0.15, 'square', 0.06, 400); }
}
const sounds = new SoundManager();

// ==========================================
// КАРТА
// ==========================================
let map = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 2, 1, 1, 0, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [2, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 2],
    [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0],
    [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 0, 1, 4, 1, 0, 0, 1, 1, 0],
    [0, 0, 0, 0, 0, 1, 4, 1, 0, 0, 0, 0, 0]
];

function tileToWorld(col, row) {
    return { x: col * TILE - HALF + TILE / 2, z: row * TILE - HALF + TILE / 2 };
}
function worldToTile(x, z) {
    return {
        col: Math.floor((x + HALF) / TILE),
        row: Math.floor((z + HALF) / TILE)
    };
}
function tileAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return -1;
    return map[row][col];
}

// ==========================================
// THREE.JS ИНИЦИАЛИЗАЦИЯ
// ==========================================
let scene, camera, renderer;
let wallMeshes = {};
let eagleMesh = null;

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a12);
    scene.fog = new THREE.Fog(0x0a0a12, 20, 45);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game').appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x6666aa, 0.6);
    scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffe0a0, 0.9);
    dir.position.set(15, 25, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const d = HALF + 5;
    dir.shadow.camera.left = -d;
    dir.shadow.camera.right = d;
    dir.shadow.camera.top = d;
    dir.shadow.camera.bottom = -d;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 60;
    scene.add(dir);

    const point = new THREE.PointLight(0xff8c00, 0.4, 20);
    point.position.set(0, 5, 0);
    scene.add(point);

    const groundGeo = new THREE.PlaneGeometry(COLS * TILE, ROWS * TILE);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x1a1a24 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(COLS * TILE, COLS, 0x333344, 0x222233);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    createBorder();
    createPlayerGun();

    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const t = map[row][col];
            if (t === 1) createWall(col, row, 1);
            else if (t === 2) createWall(col, row, 2);
            else if (t === 4) createEagle(col, row);
        }
    }
}

function createBorder() {
    const h = 3;
    const len = COLS * TILE;
    const thick = 0.5;
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
    const positions = [
        [0, h / 2, -HALF - thick / 2, len + thick * 2, h, thick],
        [0, h / 2, HALF + thick / 2, len + thick * 2, h, thick],
        [-HALF - thick / 2, h / 2, 0, thick, h, len],
        [HALF + thick / 2, h / 2, 0, thick, h, len]
    ];
    positions.forEach(([x, y, z, w, hh, dd]) => {
        const geo = new THREE.BoxGeometry(w, hh, dd);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        scene.add(mesh);
    });
}

function createWall(col, row, type) {
    const { x, z } = tileToWorld(col, row);
    const geo = new THREE.BoxGeometry(TILE, TILE, TILE);
    let mat;
    if (type === 1) {
        mat = new THREE.MeshStandardMaterial({ color: 0xb45f06, roughness: 0.9, metalness: 0.05 });
    } else {
        mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.25, metalness: 0.85 });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, TILE / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    wallMeshes[`${row},${col}`] = mesh;
}

function createEagle(col, row) {
    const { x, z } = tileToWorld(col, row);
    const group = new THREE.Group();

    const baseGeo = new THREE.BoxGeometry(TILE * 0.9, 0.4, TILE * 0.9);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const pyrGeo = new THREE.ConeGeometry(TILE * 0.35, TILE * 0.9, 4);
    const pyrMat = new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0x662a00, roughness: 0.5 });
    const pyr = new THREE.Mesh(pyrGeo, pyrMat);
    pyr.position.y = 0.85;
    pyr.rotation.y = Math.PI / 4;
    pyr.castShadow = true;
    group.add(pyr);

    const orbGeo = new THREE.SphereGeometry(0.15, 12, 12);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 1.5;
    group.add(orb);

    const light = new THREE.PointLight(0xff8c00, 0.6, 6);
    light.position.set(0, 1.5, 0);
    group.add(light);

    group.position.set(x, 0, z);
    scene.add(group);
    eagleMesh = group;
}

function createPlayerGun() {
    const group = new THREE.Group();

    const barrelGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.9, 10);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.4 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.32, -0.28, -0.7);
    group.add(barrel);

    const bodyGeo = new THREE.BoxGeometry(0.18, 0.18, 0.45);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0.32, -0.28, -0.3);
    group.add(body);

    const tipGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xff8c00 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0.32, -0.28, -1.15);
    group.add(tip);

    camera.add(group);
}

function createTankMesh(color) {
    const group = new THREE.Group();
    const W = TILE * 0.75;
    const H = 0.55;
    const L = TILE * 0.9;

    const trackGeo = new THREE.BoxGeometry(0.28, 0.4, L);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const trackL = new THREE.Mesh(trackGeo, trackMat);
    trackL.position.set(-W / 2 + 0.14, 0.2, 0);
    trackL.castShadow = true;
    group.add(trackL);
    const trackR = new THREE.Mesh(trackGeo, trackMat);
    trackR.position.set(W / 2 - 0.14, 0.2, 0);
    trackR.castShadow = true;
    group.add(trackR);

    const bodyGeo = new THREE.BoxGeometry(W - 0.5, H, L * 0.9);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    group.add(body);

    const turretGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.35, 8);
    const turretMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.position.y = 0.95;
    turret.castShadow = true;
    group.add(turret);

    const barrelGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.85, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.9, roughness: 0.3 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.95, -0.7);
    barrel.castShadow = true;
    group.add(barrel);

    const antGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4);
    const antMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    const ant = new THREE.Mesh(antGeo, antMat);
    ant.position.set(0.25, 1.35, 0.15);
    group.add(ant);

    return group;
}

// ==========================================
// ИГРОВОЕ СОСТОЯНИЕ
// ==========================================
let player = {
    x: 0, z: 0,
    yaw: 0, pitch: 0,
    speed: 5,
    radius: 0.45,
    lives: 3,
    cooldown: 0,
    maxCooldown: 0.25,
    active: true
};

let bullets = [];
let enemies = [];
let keys = {};
let paused = true;
let gameStarted = false;
let gameOver = false;
let gameWin = false;
let score = 0;
let highScore = parseInt(localStorage.getItem('tankHighScore')) || 0;
let enemiesRemaining = 10;
let spawnTimer = 0;
let gameEndSoundPlayed = false;

// ==========================================
// КЛАСС ВРАГА
// ==========================================
class Enemy {
    constructor(x, z) {
        this.x = x;
        this.z = z;
        this.radius = 0.45;
        this.speed = 1.8;
        this.direction = 'up';
        this.active = true;
        this.cooldown = 1.5;
        this.maxCooldown = 2.2;
        this.path = [];
        this.pathTimer = 0;
        this.stuckTimer = 0;
        this.mesh = createTankMesh(0x8899aa);
        this.mesh.position.set(x, 0, z);
        scene.add(this.mesh);
    }

    updateWorldMesh() {
        if (!this.mesh) return;
        this.mesh.position.set(this.x, 0, this.z);
        let ry = 0;
        if (this.direction === 'up') ry = 0;
        else if (this.direction === 'down') ry = Math.PI;
        else if (this.direction === 'left') ry = Math.PI / 2;
        else if (this.direction === 'right') ry = -Math.PI / 2;
        this.mesh.rotation.y = ry;
    }

    getTile() { return worldToTile(this.x, this.z); }

    findPathTo(targetCol, targetRow) {
        const start = this.getTile();
        if (start.col === targetCol && start.row === targetRow) return [{ col: targetCol, row: targetRow }];

        const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
        if (start.row < 0 || start.row >= ROWS || start.col < 0 || start.col >= COLS) return null;
        visited[start.row][start.col] = true;
        const queue = [[start.col, start.row, []]];

        while (queue.length > 0) {
            const [col, row, path] = queue.shift();
            const neighbors = [
                { c: col, r: row - 1 }, { c: col, r: row + 1 },
                { c: col - 1, r: row }, { c: col + 1, r: row }
            ];
            for (const n of neighbors) {
                if (n.c < 0 || n.c >= COLS || n.r < 0 || n.r >= ROWS) continue;
                if (visited[n.r][n.c]) continue;
                const t = map[n.r][n.c];
                if (t === 1 || t === 2) continue;
                visited[n.r][n.c] = true;
                const newPath = [...path, { col: n.c, row: n.r }];
                if (n.c === targetCol && n.r === targetRow) return newPath;
                if (t === 4) continue;
                queue.push([n.c, n.r, newPath]);
            }
        }
        return null;
    }

    hasLineOfSightTo(tx, tz) {
        const cx = this.x, cz = this.z;
        const dx = tx - cx, dz = tz - cz;
        const alignedX = Math.abs(dx) < 0.7;
        const alignedZ = Math.abs(dz) < 0.7;
        if (!alignedX && !alignedZ) return false;

        if (alignedX) {
            const col = Math.floor((cx + HALF) / TILE);
            const minR = Math.min(Math.floor((cz + HALF) / TILE), Math.floor((tz + HALF) / TILE));
            const maxR = Math.max(Math.floor((cz + HALF) / TILE), Math.floor((tz + HALF) / TILE));
            for (let r = minR + 1; r < maxR; r++) {
                if (tileAt(col, r) === 1 || tileAt(col, r) === 2) return false;
            }
            return true;
        } else {
            const row = Math.floor((cz + HALF) / TILE);
            const minC = Math.min(Math.floor((cx + HALF) / TILE), Math.floor((tx + HALF) / TILE));
            const maxC = Math.max(Math.floor((cx + HALF) / TILE), Math.floor((tx + HALF) / TILE));
            for (let c = minC + 1; c < maxC; c++) {
                if (tileAt(c, row) === 1 || tileAt(c, row) === 2) return false;
            }
            return true;
        }
    }

    fireAt(targetX, targetZ, targetY = 0.9) {
        if (this.cooldown > 0) return;
        this.cooldown = this.maxCooldown;

        const muzzleY = 0.95;
        const dx = targetX - this.x;
        const dy = targetY - muzzleY;
        const dz = targetZ - this.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const speed = 8;
        const vel = new THREE.Vector3(dx / len * speed, dy / len * speed, dz / len * speed);

        const startPos = new THREE.Vector3(this.x, muzzleY, this.z);
        spawnBullet(startPos, vel, false);
        sounds.enemyShoot();
    }

    update(dt, playerRef) {
        if (!this.active) return;

        this.cooldown = Math.max(0, this.cooldown - dt);

        const playerAlive = playerRef && playerRef.active;
        let firedThisFrame = false;

        if (playerAlive && this.hasLineOfSightTo(playerRef.x, playerRef.z)) {
            this.fireAt(playerRef.x, playerRef.z, CAMERA_HEIGHT);
            firedThisFrame = true;
            const dx = playerRef.x - this.x;
            const dz = playerRef.z - this.z;
            if (Math.abs(dx) > Math.abs(dz)) this.direction = dx > 0 ? 'right' : 'left';
            else this.direction = dz > 0 ? 'down' : 'up';
        } else {
            const eaglePos = tileToWorld(EAGLE_COL, EAGLE_ROW);
            if (this.hasLineOfSightTo(eaglePos.x, eaglePos.z)) {
                this.fireAt(eaglePos.x, eaglePos.z, 0.8);
                firedThisFrame = true;
            }
        }

        this.pathTimer -= dt;
        if (this.pathTimer <= 0) {
            this.pathTimer = 1.0 + Math.random() * 1.0;

            let targetCol, targetRow;
            if (Math.random() < 0.6 && playerAlive) {
                const pt = worldToTile(playerRef.x, playerRef.z);
                targetCol = pt.col;
                targetRow = pt.row;
            } else {
                targetCol = EAGLE_COL;
                targetRow = EAGLE_ROW;
            }

            let path = this.findPathTo(targetCol, targetRow);
            if (!path || path.length === 0) {
                if (targetCol === EAGLE_COL && targetRow === EAGLE_ROW && playerAlive) {
                    const pt = worldToTile(playerRef.x, playerRef.z);
                    path = this.findPathTo(pt.col, pt.row);
                } else {
                    path = this.findPathTo(EAGLE_COL, EAGLE_ROW);
                }
            }
            this.path = path || [];
        }

        if (!firedThisFrame && this.path.length > 0) {
            const moved = this.followPath(dt);
            if (!moved) {
                this.stuckTimer += dt;
                if (this.stuckTimer > 0.5) {
                    this.path = [];
                    this.pathTimer = 0;
                    this.stuckTimer = 0;
                }
            } else {
                this.stuckTimer = 0;
            }
        } else if (this.path.length === 0 && !firedThisFrame) {
            if (Math.random() < 0.02) {
                const dirs = ['up', 'down', 'left', 'right'];
                const d = dirs[Math.floor(Math.random() * 4)];
                this.tryMoveDir(d, dt);
            }
        }

        this.updateWorldMesh();
    }

    tryMoveDir(dir, dt) {
        let dx = 0, dz = 0;
        if (dir === 'up') dz = -1;
        else if (dir === 'down') dz = 1;
        else if (dir === 'left') dx = -1;
        else if (dir === 'right') dx = 1;

        const step = this.speed * dt;
        const nx = this.x + dx * step;
        const nz = this.z + dz * step;

        this.direction = dir;

        if (canTankMoveTo(nx, nz, this.radius, this)) {
            this.x = nx;
            this.z = nz;
            return true;
        }
        return false;
    }

    followPath(dt) {
        if (this.path.length === 0) return false;
        const next = this.path[0];
        const target = tileToWorld(next.col, next.row);
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.15) {
            this.path.shift();
            return true;
        }

        const step = Math.min(this.speed * dt, dist);
        const nx = this.x + (dx / dist) * step;
        const nz = this.z + (dz / dist) * step;

        if (Math.abs(dx) > Math.abs(dz)) this.direction = dx > 0 ? 'right' : 'left';
        else this.direction = dz > 0 ? 'down' : 'up';

        if (canTankMoveTo(nx, nz, this.radius, this)) {
            this.x = nx;
            this.z = nz;
            return true;
        }
        return false;
    }

    destroy() {
        this.active = false;
        if (this.mesh) {
            scene.remove(this.mesh);
            this.mesh = null;
        }
    }
}

// ==========================================
// ПУЛИ
// ==========================================
function spawnBullet(position, velocity, isPlayer) {
    const geo = new THREE.SphereGeometry(0.12, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: isPlayer ? 0xffee88 : 0xff5544 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    scene.add(mesh);

    const light = new THREE.PointLight(isPlayer ? 0xffee88 : 0xff5544, 0.4, 2);
    mesh.add(light);

    bullets.push({
        pos: position.clone(),
        vel: velocity.clone(),
        isPlayer,
        mesh,
        life: 3,
        radius: 0.15
    });
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.life -= dt;
        if (b.life <= 0) { removeBullet(i); continue; }

        const nx = b.pos.x + b.vel.x * dt;
        const ny = b.pos.y + b.vel.y * dt;
        const nz = b.pos.z + b.vel.z * dt;

        if (Math.abs(nx) > HALF + 1 || Math.abs(nz) > HALF + 1 || ny < 0 || ny > 4) {
            removeBullet(i);
            continue;
        }

        const { col, row } = worldToTile(nx, nz);
        const t = tileAt(col, row);
        if (t === 1) {
            map[row][col] = 0;
            if (wallMeshes[`${row},${col}`]) {
                scene.remove(wallMeshes[`${row},${col}`]);
                delete wallMeshes[`${row},${col}`];
            }
            sounds.brickHit();
            removeBullet(i);
            continue;
        } else if (t === 2) {
            sounds.steelHit();
            removeBullet(i);
            continue;
        } else if (t === 4) {
            sounds.explosion();
            gameOver = true;
            removeBullet(i);
            continue;
        }

        if (b.isPlayer) {
            let hit = false;
            for (const e of enemies) {
                if (!e.active) continue;
                const dx = e.x - nx, dz = e.z - nz, dy = 0.6 - ny;
                const d2 = dx * dx + dz * dz + dy * dy;
                if (d2 < 0.8 * 0.8) {
                    e.destroy();
                    score += 100;
                    sounds.explosion();
                    updateUI();
                    hit = true;
                    break;
                }
            }
            if (hit) { removeBullet(i); continue; }
        } else {
            if (player.active) {
                const dx = player.x - nx, dz = player.z - nz, dy = CAMERA_HEIGHT - ny;
                if (dx * dx + dz * dz + dy * dy < 0.7 * 0.7) {
                    playerHit();
                    removeBullet(i);
                    continue;
                }
            }
        }

        b.pos.set(nx, ny, nz);
        b.mesh.position.copy(b.pos);
    }
}

function removeBullet(idx) {
    const b = bullets[idx];
    if (b.mesh) scene.remove(b.mesh);
    bullets.splice(idx, 1);
}

// ==========================================
// ЛОГИКА ИГРОКА
// ==========================================
function playerShoot() {
    if (!player.active || player.cooldown > 0) return;
    player.cooldown = player.maxCooldown;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    const startPos = new THREE.Vector3();
    camera.getWorldPosition(startPos);
    startPos.add(dir.clone().multiplyScalar(0.5));

    const speed = 14;
    const vel = dir.clone().multiplyScalar(speed);

    spawnBullet(startPos, vel, true);
    sounds.shoot();
}

function playerHit() {
    player.lives--;
    sounds.playerHit();
    updateUI();

    if (player.lives <= 0) {
        gameOver = true;
        player.active = false;
    } else {
        const spawn = tileToWorld(4, 12);
        player.x = spawn.x;
        player.z = spawn.z;
        player.yaw = 0;
        player.pitch = 0;
    }
}

// ==========================================
// КОЛЛИЗИИ
// ==========================================
function canTankMoveTo(x, z, radius, self) {
    if (x - radius < -HALF || x + radius > HALF || z - radius < -HALF || z + radius > HALF) return false;

    const pts = [
        [x - radius, z - radius],
        [x + radius, z - radius],
        [x - radius, z + radius],
        [x + radius, z + radius]
    ];
    for (const [px, pz] of pts) {
        const { col, row } = worldToTile(px, pz);
        const t = tileAt(col, row);
        if (t > 0) return false;
    }

    // === ИСПРАВЛЕНИЕ: для игрока (self === null) проверяем ТОЛЬКО врагов,
    // чтобы игрок не сталкивался сам с собой ===
    const others = self ? [player, ...enemies] : enemies;
    for (const other of others) {
        if (!other || other === self) continue;
        if (other.active === false) continue;
        const ox = other.x;
        const oz = other.z;
        const r = other.radius || 0.45;
        const dx = ox - x, dz = oz - z;
        const dist2 = dx * dx + dz * dz;
        const minDist = radius + r;
        if (dist2 < minDist * minDist) return false;
    }
    return true;
}

// ==========================================
// HUD
// ==========================================
const scoreDisplay = document.getElementById('scoreDisplay');
const highScoreDisplay = document.getElementById('highScoreDisplay');
const livesDisplay = document.getElementById('livesDisplay');
const enemyCountDiv = document.getElementById('enemyCount');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const soundToggleBtn = document.getElementById('soundToggle');

function updateUI() {
    scoreDisplay.textContent = score;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('tankHighScore', highScore);
    }
    highScoreDisplay.textContent = highScore;
    livesDisplay.textContent = player.lives;

    enemyCountDiv.innerHTML = '';
    for (let i = 0; i < enemiesRemaining; i++) {
        const icon = document.createElement('div');
        icon.className = 'enemy-icon';
        enemyCountDiv.appendChild(icon);
    }
}

// ==========================================
// СТАРТ ИГРЫ
// ==========================================
function beginPlaying() {
    if (gameStarted && !paused) return;
    sounds.ensure();
    overlay.style.display = 'none';
    paused = false;
    gameStarted = true;
}

overlay.addEventListener('click', beginPlaying);

window.addEventListener('keydown', (e) => {
    if (overlay.style.display !== 'none' && !gameOver && !gameWin) {
        if (e.code !== 'F5' && e.code !== 'F12' && e.code !== 'Tab') {
            beginPlaying();
        }
    }
});

document.addEventListener('mousedown', (e) => {
    if (paused) return;
    if (e.button === 0) playerShoot();
});

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (e.code === 'Space') {
        e.preventDefault();
        if (!paused) playerShoot();
    }

    if (e.code === 'KeyM') {
        sounds.setEnabled(!sounds.enabled);
        soundToggleBtn.textContent = sounds.enabled ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
    }

    if (e.code === 'Escape' && gameStarted && !gameOver && !gameWin) {
        paused = !paused;
        overlay.style.display = paused ? 'flex' : 'none';
        if (paused) {
            overlay.querySelector('h1').textContent = 'ПАУЗА';
            overlay.querySelector('.subtitle').textContent = 'Нажми любую клавишу чтобы продолжить';
            startBtn.textContent = '▶ ПРОДОЛЖИТЬ';
        }
    }

    if (e.code.startsWith('Arrow')) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

window.addEventListener('blur', () => {
    keys = {};
});

soundToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sounds.setEnabled(!sounds.enabled);
    soundToggleBtn.textContent = sounds.enabled ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
});

// ==========================================
// СПАВН ВРАГОВ
// ==========================================
function spawnEnemy() {
    if (enemiesRemaining <= 0 || gameOver || gameWin) return;
    if (enemies.filter(e => e.active).length >= 4) return;

    const spawnPoints = [
        { col: 0, row: 0 },
        { col: 6, row: 0 },
        { col: 12, row: 0 }
    ];

    spawnPoints.sort(() => Math.random() - 0.5);

    for (const p of spawnPoints) {
        const w = tileToWorld(p.col, p.row);
        let canSpawn = true;
        for (const e of enemies) {
            if (!e.active) continue;
            const dx = e.x - w.x, dz = e.z - w.z;
            if (dx * dx + dz * dz < 1.5 * 1.5) { canSpawn = false; break; }
        }
        if (player.active) {
            const dx = player.x - w.x, dz = player.z - w.z;
            if (dx * dx + dz * dz < 1.5 * 1.5) canSpawn = false;
        }
        if (canSpawn) {
            enemies.push(new Enemy(w.x, w.z));
            enemiesRemaining--;
            sounds.spawn();
            updateUI();
            return;
        }
    }
}

// ==========================================
// ИГРОВОЙ ЦИКЛ
// ==========================================
let lastTime = performance.now();

function gameLoop() {
    requestAnimationFrame(gameLoop);

    const now = performance.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.1) dt = 0.1;

    if (!paused && !gameOver && !gameWin) {
        updateGame(dt);
    }

    renderer.render(scene, camera);
}

function updateGame(dt) {
    if (player.cooldown > 0) player.cooldown -= dt;

    if (player.active) {
        // ← / → — поворот корпуса (yaw)
        if (keys['ArrowLeft'])  player.yaw += TURN_SPEED * dt;
        if (keys['ArrowRight']) player.yaw -= TURN_SPEED * dt;

        // ↑ / ↓ — движение вперёд/назад
        let moveDir = 0;
        if (keys['ArrowUp'])   moveDir += 1;
        if (keys['ArrowDown']) moveDir -= 1;

        if (moveDir !== 0) {
            const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
            const step = player.speed * dt * moveDir;
            const nx = player.x + forward.x * step;
            const nz = player.z + forward.z * step;

            if (canTankMoveTo(nx, player.z, player.radius, null)) player.x = nx;
            if (canTankMoveTo(player.x, nz, player.radius, null)) player.z = nz;
        }

        camera.position.set(player.x, CAMERA_HEIGHT, player.z);
        camera.rotation.y = player.yaw;
        camera.rotation.x = player.pitch;
    }

    for (const e of enemies) e.update(dt, player);
    enemies = enemies.filter(e => e.active);

    updateBullets(dt);

    spawnTimer += dt;
    if (spawnTimer > 2 && enemiesRemaining > 0) {
        if (Math.random() < 0.04) {
            spawnEnemy();
            spawnTimer = 0;
        }
    }

    if (enemiesRemaining <= 0 && enemies.length === 0) {
        gameWin = true;
    }

    if ((gameOver || gameWin) && !gameEndSoundPlayed) {
        gameEndSoundPlayed = true;
        if (gameWin) sounds.victory();
        else sounds.gameOver();
    }

    if ((gameOver || gameWin) && overlay.style.display === 'none') {
        setTimeout(() => {
            overlay.style.display = 'flex';
            overlay.querySelector('h1').textContent = gameWin ? 'ПОБЕДА!' : 'ИГРА ОКОНЧЕНА';
            overlay.querySelector('.subtitle').textContent = `Счёт: ${score} · Рекорд: ${highScore}`;
            startBtn.textContent = '↻ F5 — Играть снова';
        }, 400);
    }
}

// ==========================================
// РЕСАЙЗ
// ==========================================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// СТАРТ
// ==========================================
function startGame() {
    if (typeof THREE === 'undefined') {
        alert('Three.js не загрузился. Проверьте подключение к интернету и перезагрузите страницу.');
        return;
    }

    initThree();

    const spawn = tileToWorld(4, 12);
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = 0;
    player.pitch = 0;

    camera.position.set(player.x, CAMERA_HEIGHT, player.z);
    camera.rotation.y = 0;
    camera.rotation.x = 0;

    updateUI();
    gameLoop();
}

startGame();