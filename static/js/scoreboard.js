// LED dot-matrix scoreboard, after the board on the course slide:
// white labels on top, big red score digits, a row of coloured round dots below.
import * as THREE from 'three';

// Classic 5x7 font, one hex value per row, bit 4 is the leftmost column.
const FONT = {
    '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
    '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
    '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
    '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
    A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
    C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
    E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
    G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
    I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
    K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
    M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
    O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
    Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
    S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
    W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
    Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
    ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00], '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
    '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04], '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
    '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c], ' ': [0, 0, 0, 0, 0, 0, 0],
};

const COLS = 112;
const ROWS = 52;
const PITCH = 10;
const HISTORY_MAX = 14;

export const LED = {
    white: '#f4f1ea', red: '#ff3b2f', amber: '#ffb020', green: '#2fe36a', off: '#1d1f22',
};
const RESULT_COLOR = { win: LED.green, lose: LED.red, draw: LED.amber };
const RESULT_WORD = { win: 'WIN!', lose: 'LOSE', draw: 'DRAW' };

export class Scoreboard {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = COLS * PITCH;
        this.canvas.height = ROWS * PITCH;
        this.ctx = this.canvas.getContext('2d');
        this.grid = new Array(COLS * ROWS).fill(null);
        this.state = { user: 0, computer: 0, history: [], last: null };
        this.flash = null;
        this.flashUntil = 0;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.object = this.buildMesh();
        this.draw(0);
    }

    buildMesh() {
        const width = 5.6;
        const height = width * (ROWS / COLS);
        const group = new THREE.Group();
        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.36, height + 0.36, 0.3),
            new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.55, metalness: 0.4 }),
        );
        frame.castShadow = true;
        frame.position.z = -0.16;
        const face = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
        );
        const postMaterial = new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.6, metalness: 0.5 });
        for (const x of [-width / 2 + 0.5, width / 2 - 0.5]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4, 12), postMaterial);
            post.position.set(x, -height / 2 - 2, -0.2);
            post.castShadow = true;
            group.add(post);
        }
        group.add(frame, face);
        return group;
    }

    setScore(user, computer) {
        this.state.user = user;
        this.state.computer = computer;
        this.draw(performance.now());
    }

    // Record a finished round: the changed score blinks for a moment.
    recordRound(result, user, computer, now) {
        this.state.user = user;
        this.state.computer = computer;
        this.state.last = result;
        this.state.history.push(result);
        if (this.state.history.length > HISTORY_MAX) this.state.history.shift();
        this.flash = { win: 'user', lose: 'computer', draw: 'both' }[result];
        this.flashUntil = now + 1400;
        this.draw(now);
    }

    reset() {
        this.state = { user: 0, computer: 0, history: [], last: null };
        this.flash = null;
        this.draw(performance.now());
    }

    // Called every frame; only redraws while a blink runs.
    update(now) {
        if (this.flash && now < this.flashUntil + 50) this.draw(now);
        else if (this.flash) {
            this.flash = null;
            this.draw(now);
        }
    }

    lit(x, y, color) {
        if (x >= 0 && x < COLS && y >= 0 && y < ROWS) this.grid[y * COLS + x] = color;
    }

    text(str, x, y, color, scale = 1) {
        let cursor = x;
        for (const char of str) {
            const rows = FONT[char] || FONT[' '];
            rows.forEach((bits, row) => {
                for (let col = 0; col < 5; col += 1) {
                    if (bits & (0x10 >> col)) {
                        for (let sy = 0; sy < scale; sy += 1) {
                            for (let sx = 0; sx < scale; sx += 1) {
                                this.lit(cursor + col * scale + sx, y + row * scale + sy, color);
                            }
                        }
                    }
                }
            });
            cursor += 6 * scale;
        }
    }

    static textWidth(str, scale = 1) {
        return str.length * 6 * scale - scale;
    }

    centered(str, centerX, y, color, scale = 1) {
        this.text(str, Math.round(centerX - Scoreboard.textWidth(str, scale) / 2), y, color, scale);
    }

    dot(cx, cy, color) {
        for (let y = -1; y <= 1; y += 1) {
            for (let x = -1; x <= 1; x += 1) {
                if (Math.abs(x) + Math.abs(y) < 2) this.lit(cx + x, cy + y, color);
            }
        }
    }

    compose(now) {
        this.grid.fill(null);
        const blinkOff = this.flash && now < this.flashUntil && Math.floor((this.flashUntil - now) / 140) % 2 === 1;
        const hide = (side) => blinkOff && (this.flash === side || this.flash === 'both');

        this.centered('YOU', 28, 3, LED.white);
        this.centered('CPU', 84, 3, LED.white);

        const scoreLabel = (value) => String(Math.min(value, 999));
        const userText = scoreLabel(this.state.user);
        const cpuText = scoreLabel(this.state.computer);
        const scaleFor = (str) => (str.length > 2 ? 2 : 3);
        if (!hide('user')) {
            const scale = scaleFor(userText);
            this.centered(userText, 28, 13 + (3 - scale) * 3, LED.red, scale);
        }
        if (!hide('computer')) {
            const scale = scaleFor(cpuText);
            this.centered(cpuText, 84, 13 + (3 - scale) * 3, LED.red, scale);
        }
        for (const y of [18, 28]) {
            for (let dy = 0; dy < 3; dy += 1) {
                for (let dx = 0; dx < 3; dx += 1) this.lit(55 + dx, y + dy, LED.amber);
            }
        }

        // Round history: one dot per round, newest on the right.
        const history = this.state.history;
        history.forEach((result, i) => {
            this.dot(5 + (HISTORY_MAX - history.length + i) * 4, 44, RESULT_COLOR[result]);
        });
        if (this.state.last) {
            const word = RESULT_WORD[this.state.last];
            this.text(word, COLS - 4 - Scoreboard.textWidth(word), 41, RESULT_COLOR[this.state.last]);
        } else {
            this.text('READY', COLS - 4 - Scoreboard.textWidth('READY'), 41, LED.green);
        }
    }

    draw(now) {
        this.compose(now);
        const { ctx } = this;
        ctx.fillStyle = '#060707';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const radius = PITCH * 0.34;
        // Unlit LEDs first, then a soft halo and the lit core on top.
        ctx.fillStyle = LED.off;
        ctx.beginPath();
        for (let y = 0; y < ROWS; y += 1) {
            for (let x = 0; x < COLS; x += 1) {
                if (!this.grid[y * COLS + x]) {
                    ctx.moveTo(x * PITCH + PITCH / 2 + radius, y * PITCH + PITCH / 2);
                    ctx.arc(x * PITCH + PITCH / 2, y * PITCH + PITCH / 2, radius, 0, Math.PI * 2);
                }
            }
        }
        ctx.fill();
        for (const pass of [{ r: PITCH * 0.62, a: 0.22 }, { r: radius * 1.08, a: 1 }]) {
            ctx.globalAlpha = pass.a;
            for (let y = 0; y < ROWS; y += 1) {
                for (let x = 0; x < COLS; x += 1) {
                    const color = this.grid[y * COLS + x];
                    if (color) {
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(x * PITCH + PITCH / 2, y * PITCH + PITCH / 2, pass.r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }
        ctx.globalAlpha = 1;
        this.texture.needsUpdate = true;
    }
}
