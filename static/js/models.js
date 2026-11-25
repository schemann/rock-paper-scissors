// Procedural 3D models: rock, paper, scissors and the computer's mystery orb.
import * as THREE from 'three';

// Deterministic value noise so the rock has the same shape on every load.
function hash(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
}

function smoothNoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    let total = 0;
    for (let dz = 0; dz <= 1; dz += 1) {
        for (let dy = 0; dy <= 1; dy += 1) {
            for (let dx = 0; dx <= 1; dx += 1) {
                const weight = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
                total += weight * hash(ix + dx, iy + dy, iz + dz);
            }
        }
    }
    return total;
}

function fbm(x, y, z) {
    return smoothNoise(x, y, z) * 0.6 + smoothNoise(x * 2.1, y * 2.1, z * 2.1) * 0.3
        + smoothNoise(x * 4.3, y * 4.3, z * 4.3) * 0.1;
}

export function createRock() {
    const geometry = new THREE.IcosahedronGeometry(0.62, 4);
    const position = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const colors = [];
    const dark = new THREE.Color('#5f5a55');
    const light = new THREE.Color('#a39d94');
    for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i);
        const n = fbm(vertex.x * 2.2 + 3, vertex.y * 2.2 + 7, vertex.z * 2.2 + 11);
        // Flatten the facets a little so it reads as a cracked stone, not a blob.
        const facet = Math.round(n * 5) / 5;
        vertex.multiplyScalar(0.78 + 0.22 * (n * 0.6 + facet * 0.4));
        vertex.y *= 0.82;
        position.setXYZ(i, vertex.x, vertex.y, vertex.z);
        const tone = dark.clone().lerp(light, THREE.MathUtils.clamp(n * 1.25 - 0.1, 0, 1));
        colors.push(tone.r, tone.g, tone.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.parts = [mesh];
    return group;
}

function paperTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 660;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7f4ec';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(70, 130, 220, 0.45)';
    ctx.lineWidth = 3;
    for (let y = 110; y < canvas.height - 20; y += 34) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(230, 70, 80, 0.6)';
    ctx.beginPath();
    ctx.moveTo(78, 0);
    ctx.lineTo(78, canvas.height);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (const y of [120, 330, 540]) {
        ctx.beginPath();
        ctx.arc(36, y, 13, 0, Math.PI * 2);
        ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
}

export function createPaper() {
    const width = 1.0, height = 1.3;
    const geometry = new THREE.PlaneGeometry(width, height, 24, 30);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i), y = position.getY(i);
        // A soft page curl plus a lifted bottom-right corner.
        const curl = 0.09 * Math.sin((x / width + 0.5) * Math.PI);
        const cornerX = Math.max(0, x / width + 0.5 - 0.62) / 0.38;
        const cornerY = Math.max(0, 0.5 - (y / height + 0.5) - 0.12) / 0.38;
        const corner = 0.22 * (cornerX * cornerY) ** 1.6;
        position.setZ(i, curl + corner);
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
        map: paperTexture(), roughness: 0.85, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.set(-0.12, 0.25, 0.08);
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.parts = [mesh];
    return group;
}

function bladeGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.07, -0.08);
    shape.lineTo(0.065, -0.08);
    shape.quadraticCurveTo(0.075, 0.45, 0.012, 0.98);
    shape.quadraticCurveTo(0.0, 1.0, -0.01, 0.97);
    shape.quadraticCurveTo(-0.03, 0.5, -0.07, -0.08);
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.028, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2,
        curveSegments: 16,
    });
    geometry.translate(0, 0, -0.014);
    return geometry;
}

function scissorsHalf(side, steel, plastic) {
    const half = new THREE.Group();
    const blade = new THREE.Mesh(bladeGeometry(), steel);
    blade.scale.x = side;
    // The handle sits on the opposite side of its blade, so the two halves cross like an X.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.34, 0.05), plastic);
    arm.position.set(-side * 0.05, -0.22, 0);
    arm.rotation.z = side * 0.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 14, 36), plastic);
    ring.position.set(-side * 0.17, -0.5, 0);
    ring.scale.set(1, 1.18, 1);
    for (const part of [blade, arm, ring]) {
        part.castShadow = true;
        half.add(part);
    }
    half.position.z = side * 0.02;
    return half;
}

export function createScissors() {
    const steel = new THREE.MeshStandardMaterial({ color: '#d9dee4', metalness: 1, roughness: 0.22 });
    const plastic = new THREE.MeshStandardMaterial({ color: '#e5484d', roughness: 0.38 });
    const left = scissorsHalf(-1, steel, plastic);
    const right = scissorsHalf(1, steel, plastic);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 18), steel);
    screw.rotation.x = Math.PI / 2;
    const inner = new THREE.Group();
    inner.add(left, right, screw);
    inner.position.y = -0.18;
    const group = new THREE.Group();
    group.add(inner);
    group.scale.setScalar(0.95);
    group.userData.parts = [left, right, screw];
    group.userData.setOpen = (amount) => {
        const angle = 0.06 + amount * 0.42;
        left.rotation.z = angle;
        right.rotation.z = -angle;
    };
    group.userData.setOpen(0.6);
    return group;
}

function questionTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 190px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 128, 140);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createMystery() {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.62, 1),
        new THREE.MeshStandardMaterial({
            color: '#7c5cff', emissive: '#4c2fd6', emissiveIntensity: 0.9, roughness: 0.3,
            wireframe: true,
        }),
    );
    const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.42, 2),
        new THREE.MeshStandardMaterial({
            color: '#1a1240', emissive: '#2a1a80', emissiveIntensity: 0.6, roughness: 0.2,
            metalness: 0.4, transparent: true, opacity: 0.85,
        }),
    );
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: questionTexture(), color: '#d9ccff', depthTest: false, toneMapped: false,
    }));
    mark.scale.setScalar(0.62);
    mark.renderOrder = 2;
    group.add(shell, core, mark);
    group.userData.shell = shell;
    return group;
}

export const MAKERS = { rock: createRock, paper: createPaper, scissors: createScissors };

export function createModel(choice) {
    const model = MAKERS[choice]();
    model.userData.choice = choice;
    return model;
}
