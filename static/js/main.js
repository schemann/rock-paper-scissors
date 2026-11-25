// Rock Paper Scissors 3D: scene, input and the round sequence. The score lives on the Flask server.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createModel, createMystery } from './models.js';
import { Scoreboard } from './scoreboard.js';

const CHOICES = ['rock', 'paper', 'scissors'];
const VERB = {
    'rock>scissors': 'Rock crushes scissors',
    'paper>rock': 'Paper covers rock',
    'scissors>paper': 'Scissors cut paper',
};
const RESULT_COLOR = { win: '#4ade80', lose: '#f87171', draw: '#fbbf24' };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = reducedMotion ? 0.45 : 1;

const statusEl = document.getElementById('status');
const userScoreEl = document.getElementById('user-score');
const computerScoreEl = document.getElementById('computer-score');
const drawsEl = document.getElementById('draws');
const buttons = [...document.querySelectorAll('.choice')];
const resetButton = document.getElementById('reset');

let busy = false;

// ---------- server ----------

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!response.ok) {
        const error = new Error(`${path} answered ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

function failureText(error, action = 'the move') {
    if (error && error.status === 429) return 'Too many moves at once. Wait a second and try again.';
    if (error && error.status) return `The server refused ${action} (HTTP ${error.status}).`;
    return 'The server did not answer. Is Flask running?';
}

// Bumped by every score the page shows, so a slower /score answer never overwrites a newer one.
let scoreVersion = 0;

function showScore(data) {
    scoreVersion += 1;
    userScoreEl.textContent = data.user_score;
    computerScoreEl.textContent = data.computer_score;
    drawsEl.textContent = data.draws;
}

function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`;
    if (kind) {
        void statusEl.offsetWidth; // restart the pop animation
        statusEl.classList.add('pop');
    }
}

function describe(data) {
    const { user_choice: user, computer_choice: computer, result } = data;
    const name = (c) => c[0].toUpperCase() + c.slice(1);
    if (result === 'draw') return `Draw! Both picked ${user}`;
    if (result === 'win') return `You win! ${VERB[`${user}>${computer}`]}`;
    return `You lose! ${VERB[`${computer}>${user}`] || `${name(computer)} wins`}`;
}

function setBusy(value) {
    busy = value;
    for (const button of [...buttons, resetButton]) button.disabled = value;
}

// ---------- 3D scene ----------

function createRenderer(canvas) {
    try {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        return renderer;
    } catch (error) {
        console.warn('WebGL unavailable', error);
        return null;
    }
}

const renderer = createRenderer(document.getElementById('stage'));
const world = renderer ? buildWorld(renderer) : null;

if (!renderer) {
    document.body.classList.add('no-webgl');
    document.getElementById('webgl-error').hidden = false;
}

function floorTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const glow = ctx.createRadialGradient(512, 512, 40, 512, 512, 512);
    glow.addColorStop(0, '#26313d');
    glow.addColorStop(0.55, '#141a21');
    glow.addColorStop(1, '#0b0f14');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = 'rgba(97, 218, 251, 0.09)';
    ctx.lineWidth = 2;
    for (let r = 120; r < 512; r += 96) {
        ctx.beginPath();
        ctx.arc(512, 512, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function buildWorld(renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0f14');
    scene.fog = new THREE.Fog('#0b0f14', 12, 26);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    const lookAt = new THREE.Vector3(0, 1.95, -0.4);

    scene.add(new THREE.HemisphereLight('#bcd7ff', '#20160f', 0.7));
    const key = new THREE.DirectionalLight('#fff3e0', 2.4);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rimLeft = new THREE.PointLight('#61dafb', 18, 12);
    rimLeft.position.set(-5, 3, -2);
    const rimRight = new THREE.PointLight('#a78bfa', 18, 12);
    rimRight.position.set(5, 3, -2);
    scene.add(rimLeft, rimRight);

    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(14, 96),
        new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.75, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Arena: the two duel spots with glowing rings.
    const spots = { user: new THREE.Vector3(-2.0, 1.45, 0.2), computer: new THREE.Vector3(2.0, 1.45, 0.2) };
    const rings = {};
    for (const [side, color] of [['user', '#61dafb'], ['computer', '#a78bfa']]) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.92, 1.0, 64),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, toneMapped: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(spots[side].x, 0.01, spots[side].z);
        scene.add(ring);
        rings[side] = ring;
    }

    const board = new Scoreboard();
    board.object.position.set(0, 4.15, -5.6);
    board.object.scale.setScalar(1.3);
    scene.add(board.object);

    // Picker row: the three moves on pedestals in front.
    const picker = [];
    const pedestalMaterial = new THREE.MeshStandardMaterial({ color: '#1f2731', roughness: 0.5, metalness: 0.3 });
    CHOICES.forEach((choice, i) => {
        const x = (i - 1) * 2.0;
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.32, 48), pedestalMaterial);
        pedestal.position.set(x, 0.16, 3.6);
        pedestal.receiveShadow = true;
        pedestal.castShadow = true;
        const glow = new THREE.Mesh(
            new THREE.RingGeometry(0.62, 0.7, 64),
            new THREE.MeshBasicMaterial({ color: '#61dafb', transparent: true, opacity: 0, toneMapped: false }),
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, 0.33, 3.6);
        const model = createModel(choice);
        model.position.set(x, 1.0, 3.6);
        model.scale.setScalar(0.72);
        const hit = new THREE.Mesh(
            new THREE.CylinderGeometry(0.75, 0.75, 1.9, 12),
            new THREE.MeshBasicMaterial({ visible: false }),
        );
        hit.position.set(x, 0.95, 3.6);
        hit.userData.choice = choice;
        scene.add(pedestal, glow, model, hit);
        picker.push({ choice, model, glow, hit, hover: 0, home: model.position.clone(), dim: 0 });
    });

    // One light for the winner, created up front: adding lights later recompiles every shader.
    const winnerLight = new THREE.PointLight('#ffffff', 0, 6);
    scene.add(winnerLight);

    return { scene, camera, lookAt, spots, rings, board, picker, key, winnerLight, actors: [], particles: [] };
}

// ---------- animation helpers ----------

const tweens = new Set();
const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    out: (t) => 1 - (1 - t) ** 3,
    in: (t) => t * t * t,
    back: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};

function tween(seconds, update, easing = ease.inOut) {
    return new Promise((resolve, reject) => {
        tweens.add({
            start: performance.now(), duration: seconds * 1000 * SPEED, update, easing, resolve, reject,
        });
    });
}

const wait = (seconds) => tween(seconds, () => {});

function runTweens(now) {
    for (const item of tweens) {
        const t = Math.min(1, (now - item.start) / Math.max(item.duration, 1));
        try {
            item.update(item.easing(t), t);
        } catch (error) {
            // A failing animation ends its round through the rejection instead of freezing the loop.
            tweens.delete(item);
            item.reject(error);
            continue;
        }
        if (t >= 1) {
            tweens.delete(item);
            item.resolve();
        }
    }
}

let shake = 0;

const burstGeometry = new THREE.TetrahedronGeometry(0.06);
const burstMaterials = new Map();

function burst(position, color, count = 70) {
    const geometry = burstGeometry;
    if (!burstMaterials.has(color)) {
        burstMaterials.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    }
    const material = burstMaterials.get(color);
    for (let i = 0; i < count; i += 1) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize();
        world.scene.add(mesh);
        world.particles.push({
            mesh, velocity: dir.multiplyScalar(3 + Math.random() * 4), life: 0.9 + Math.random() * 0.6,
            spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        });
    }
}

function runParticles(dt) {
    world.particles = world.particles.filter((p) => {
        p.life -= dt;
        p.velocity.y -= 9.8 * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        if (p.mesh.position.y < 0.03) {
            p.mesh.position.y = 0.03;
            p.velocity.multiplyScalar(0.4);
            p.velocity.y = Math.abs(p.velocity.y) * 0.3;
        }
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.scale.setScalar(Math.max(0, Math.min(1, p.life * 2)));
        if (p.life <= 0) {
            world.scene.remove(p.mesh);
            return false;
        }
        return true;
    });
}

function spawn(object, position, scale = 1) {
    object.position.copy(position);
    object.scale.setScalar(scale);
    object.traverse((child) => {
        if (child.isMesh) child.castShadow = true;
    });
    world.scene.add(object);
    world.actors.push(object);
    return object;
}

// Every round builds fresh models; free their GPU buffers and textures when they leave.
function disposeObject(object) {
    object.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
            if (!material) continue;
            if (material.map) material.map.dispose();
            material.dispose();
        }
    });
}

function clearActors() {
    for (const actor of world.actors) {
        world.scene.remove(actor);
        disposeObject(actor);
    }
    world.actors = [];
    world.winnerLight.intensity = 0;
}

// Turn a model a little toward the centre of the arena.
function faceCamera(model, base = 0) {
    model.rotation.set(0, base, 0);
}

// ---------- the round ----------

async function playRound(choice) {
    if (busy || !CHOICES.includes(choice)) return;
    setBusy(true);
    setStatus('Rock...');
    // Settle the request at once so a failure is never an unhandled rejection during the shake.
    const send = () => api('/play', { method: 'POST', body: JSON.stringify({ choice }) });
    // A 409 means the browser had no session cookie yet; the answer set one, so retry once.
    const request = send()
        .catch((error) => (error.status === 409 ? send() : Promise.reject(error)))
        .then((data) => ({ data }), (error) => ({ error }));
    try {
        await runRound(choice, request);
    } catch (error) {
        console.error(error);
        setStatus('Something went wrong in this round.', 'lose');
        syncScore();
    } finally {
        if (world) {
            clearActors();
            for (const p of world.picker) p.dim = 0;
        }
        setBusy(false);
    }
}

async function runRound(choice, request) {
    if (!world) {
        await finishRound(request, null);
        return;
    }

    const slot = world.picker.find((p) => p.choice === choice);
    const player = spawn(createModel(choice), slot.model.position, 0.72);
    faceCamera(player, 0.35);
    const from = player.position.clone();
    const to = world.spots.user;
    const mystery = spawn(createMystery(), world.spots.computer, 0.01);

    await tween(0.45, (k) => {
        player.position.lerpVectors(from, to, k);
        player.position.y += Math.sin(k * Math.PI) * 0.9;
        player.scale.setScalar(0.72 + 0.58 * k);
        mystery.scale.setScalar(Math.max(0.01, 1.3 * ease.back(k)));
        for (const p of world.picker) p.dim = k;
    });

    // Three shakes: rock, paper, scissors.
    for (const word of ['Rock...', 'Paper...', 'Scissors...']) {
        setStatus(word);
        await tween(0.34, (k) => {
            const lift = Math.sin(k * Math.PI) * 0.55;
            player.position.y = to.y + lift;
            mystery.position.y = world.spots.computer.y + lift;
            player.rotation.z = -Math.sin(k * Math.PI) * 0.25;
            mystery.rotation.z = Math.sin(k * Math.PI) * 0.25;
        });
    }

    await finishRound(request, { player, mystery });
}

async function finishRound(request, actors) {
    const { data, error } = await request;
    if (error) {
        console.error(error);
        setStatus(failureText(error), 'lose');
        if (actors) {
            await tween(0.3, (k) => {
                for (const actor of world.actors) actor.scale.setScalar(Math.max(0.01, 1 - k));
            });
        }
        return;
    }

    if (!actors) {
        showScore(data);
        setStatus(describe(data), data.result);
        return;
    }

    const { player, mystery } = actors;
    const { result } = data;

    // Reveal the computer's move.
    setStatus('Shoot!');
    const computer = spawn(createModel(data.computer_choice), world.spots.computer, 0.01);
    faceCamera(computer, -0.35);
    burst(world.spots.computer, '#a78bfa', 30);
    await tween(0.28, (k) => {
        mystery.scale.setScalar(Math.max(0.01, 1.3 * (1 - k)));
        computer.scale.setScalar(Math.max(0.01, 1.3 * ease.back(k)));
    }, ease.out);
    world.scene.remove(mystery);
    world.actors = world.actors.filter((actor) => actor !== mystery);
    disposeObject(mystery);

    // Clash in the middle.
    const userHome = world.spots.user.clone();
    const cpuHome = world.spots.computer.clone();
    await tween(0.22, (k) => {
        player.position.x = THREE.MathUtils.lerp(userHome.x, -0.8, k);
        computer.position.x = THREE.MathUtils.lerp(cpuHome.x, 0.8, k);
        player.position.y = userHome.y;
        computer.position.y = cpuHome.y;
    }, ease.in);
    shake = 0.35;
    burst(new THREE.Vector3(0, 1.5, 0.2), RESULT_COLOR[result], result === 'draw' ? 40 : 80);

    world.board.recordRound(result, data.user_score, data.computer_score, performance.now());
    showScore(data);
    setStatus(describe(data), result);

    if (result === 'draw') {
        await tween(0.5, (k) => {
            player.position.x = THREE.MathUtils.lerp(-0.8, userHome.x, k);
            computer.position.x = THREE.MathUtils.lerp(0.8, cpuHome.x, k);
            player.position.y = computer.position.y = userHome.y + Math.sin(k * Math.PI) * 0.35;
        }, ease.out);
    } else {
        const winner = result === 'win' ? player : computer;
        const loser = result === 'win' ? computer : player;
        const away = result === 'win' ? 1 : -1;
        const loserStart = loser.position.clone();
        const winnerStart = winner.position.clone();
        const loserSpin = loser.rotation.z;
        const winnerSpin = winner.rotation.y;
        const glow = world.winnerLight;
        glow.color.set(RESULT_COLOR[result]);
        await tween(0.75, (k, t) => {
            loser.position.x = loserStart.x + away * k * 3.2;
            loser.position.y = Math.max(0.35, loserStart.y + Math.sin(t * Math.PI) * 1.1 - t * t * 1.4);
            loser.rotation.z = loserSpin - away * t * 9;
            loser.scale.setScalar(Math.max(0.01, 1.3 * (1 - k * 0.55)));
            winner.position.y = winnerStart.y + Math.sin(k * Math.PI * 0.5) * 0.45;
            winner.rotation.y = winnerSpin + t * Math.PI * 2;
            glow.position.copy(winner.position);
            glow.intensity = 14 * k;
            if (winner.userData.setOpen) winner.userData.setOpen(0.5 + 0.5 * Math.sin(t * 22));
        }, ease.out);
    }

    await wait(1.1);
    await tween(0.35, (k) => {
        for (const actor of world.actors) actor.scale.setScalar(Math.max(0.01, actor.scale.x * (1 - k * 0.5)));
        for (const p of world.picker) p.dim = 1 - k;
    });
    setStatus('Pick your move');
}

async function resetScore() {
    if (busy) return;
    setBusy(true);
    try {
        const data = await api('/reset', { method: 'POST' })
            .catch((error) => (error.status === 409 ? api('/reset', { method: 'POST' }) : Promise.reject(error)));
        showScore(data);
        if (world) world.board.reset();
        setStatus('Score reset: 0 : 0');
    } catch (error) {
        console.error(error);
        setStatus(failureText(error, 'the reset'), 'lose');
    } finally {
        setBusy(false);
    }
}

// ---------- input ----------

for (const button of buttons) button.addEventListener('click', () => playRound(button.dataset.choice));
resetButton.addEventListener('click', resetScore);

window.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const map = { 1: 'rock', 2: 'paper', 3: 'scissors', r: 'rock', p: 'paper', s: 'scissors' };
    if (map[key]) playRound(map[key]);
    if (key === '0') resetScore();
});

const pointer = new THREE.Vector2(2, 2);
const raycaster = new THREE.Raycaster();
let hovered = null;

function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, world.camera);
    const hits = raycaster.intersectObjects(world.picker.map((p) => p.hit), false);
    return hits.length ? hits[0].object.userData.choice : null;
}

if (world) {
    renderer.domElement.addEventListener('pointermove', (event) => {
        hovered = busy ? null : pickAt(event);
        renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
    });
    renderer.domElement.addEventListener('pointerleave', () => {
        hovered = null;
    });
    renderer.domElement.addEventListener('click', (event) => {
        const choice = pickAt(event);
        if (choice) playRound(choice);
    });
}

// ---------- frame loop ----------

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    const aspect = width / height;
    world.camera.aspect = aspect;
    // Narrow screens widen the view instead of moving back, so the arena stays out of the fog:
    // the horizontal half-angle must keep tan >= 0.4 to fit all three pedestals.
    const fitFov = THREE.MathUtils.radToDeg(2 * Math.atan(0.4 / aspect));
    world.camera.fov = Math.min(Math.max(40, fitFov), 95);
    world.camera.position.set(0, aspect < 1 ? 4.6 : 3.9, 11.8);
    world.camera.updateProjectionMatrix();
}

if (world) {
    world.board.setScore(Number(userScoreEl.textContent) || 0, Number(computerScoreEl.textContent) || 0);
    resize();
    window.addEventListener('resize', resize);
    // Moving the window to a screen with another pixel density fires no resize event.
    const watchPixelRatio = () => {
        window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
            .addEventListener('change', () => {
                resize();
                watchPixelRatio();
            }, { once: true });
    };
    watchPixelRatio();
    const timer = new THREE.Timer();
    let lastFrameError = -Infinity;
    const lookTarget = world.lookAt.clone();
    renderer.setAnimationLoop((timestamp) => {
        try {
            frame(timestamp);
        } catch (error) {
            // A broken frame must not stop the loop: end the running round and keep drawing.
            // Log at most once a second so a persistent fault does not flood the console.
            if (timestamp - lastFrameError > 1000) {
                lastFrameError = timestamp;
                console.error(error);
            }
            for (const item of tweens) item.reject(error);
            tweens.clear();
        }
    });

    function frame(timestamp) {
        timer.update(timestamp);
        const dt = Math.min(timer.getDelta(), 0.05);
        const now = performance.now();
        const time = now / 1000;
        runTweens(now);
        runParticles(dt);
        world.board.update(now);

        for (const slot of world.picker) {
            const target = !busy && hovered === slot.choice ? 1 : 0;
            slot.hover += (target - slot.hover) * Math.min(1, dt * 10);
            const index = CHOICES.indexOf(slot.choice);
            slot.model.position.y = slot.home.y + Math.sin(time * 1.6 + index) * 0.06 + slot.hover * 0.22;
            slot.model.rotation.y = Math.sin(time * 0.6 + index * 2) * 0.5 + slot.hover * time * 1.5;
            slot.model.scale.setScalar((0.72 + slot.hover * 0.1) * (1 - slot.dim * 0.35));
            slot.glow.material.opacity = slot.hover * 0.9;
            if (slot.model.userData.setOpen) {
                slot.model.userData.setOpen(0.55 + 0.45 * Math.sin(time * (slot.hover > 0.5 ? 12 : 1.5)));
            }
        }
        for (const actor of world.actors) {
            if (actor.userData.shell) {
                actor.userData.shell.rotation.y += dt * 1.6;
                actor.userData.shell.rotation.x += dt * 0.7;
            }
        }
        world.rings.user.material.opacity = 0.4 + Math.sin(time * 2) * 0.15;
        world.rings.computer.material.opacity = 0.4 + Math.sin(time * 2 + Math.PI) * 0.15;

        shake = Math.max(0, shake - dt);
        const jolt = reducedMotion ? 0 : shake * 0.25;
        world.camera.lookAt(
            lookTarget.x + (Math.random() - 0.5) * jolt,
            lookTarget.y + (Math.random() - 0.5) * jolt,
            lookTarget.z,
        );
        renderer.render(world.scene, world.camera);
    }
}

// Sync with the server's score: on load (another tab or a restart may have changed it)
// and after a round that broke after the server had already counted it.
function syncScore() {
    const version = scoreVersion;
    api('/score').then((data) => {
        if (version !== scoreVersion) return;
        showScore(data);
        if (world) world.board.setScore(data.user_score, data.computer_score);
    }).catch((error) => console.error(error));
}

syncScore();
