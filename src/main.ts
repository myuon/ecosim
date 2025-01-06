/****************************************************************************
 *  WebGL Predator-Prey Simulation in TypeScript
 ****************************************************************************/
import vsSource from "./shaders/vertex.glslx?raw";
import fsSource from "./shaders/fragment.glslx?raw";

// ======== シミュレーションパラメータ ========

// 粒子数
const NUM_PREY: number = 1000; // 被捕食者（プレイ）
const NUM_PREDATORS: number = 50; // 捕食者
// スピード関連
const PREY_SPEED: number = 1.0;
const PREDATOR_SPEED: number = 1.6;
// 捕食判定距離
const EAT_DISTANCE: number = 10.0;

enum ParticleType {
  Prey = 0,
  Predator = 1,
}

// ======== グローバル変数 ========
let canvas: HTMLCanvasElement;
let gl: WebGLRenderingContext;
let program: WebGLProgram | null = null;
let u_resolution_location: WebGLUniformLocation | null = null;

let particles: Particle[] = [];
let positions: number[] = []; // WebGL へ送る頂点座標
let velocities: number[] = []; // WebGL へ送る速度情報
let colors: number[] = []; // WebGL へ送る色情報
let types: number[] = []; // WebGL へ送る粒子種別情報

/****************************************************************************
 * 粒子を表すクラス（CPU側でシミュレーションを担う）
 ****************************************************************************/
class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: ParticleType;
  alive: boolean;
  hungriness: number;

  constructor(
    x: number,
    y: number,
    vx: number,
    vy: number,
    type: ParticleType,
    hungriness: number
  ) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.type = type;
    this.alive = true;
    this.hungriness = hungriness;
  }
}

/****************************************************************************
 * 1. エントリーポイント: ページ読み込み後の初期化
 ****************************************************************************/
window.addEventListener("load", () => {
  // Canvas & WebGL コンテキスト取得
  const maybeCanvas = document.getElementById("glCanvas");
  if (!(maybeCanvas instanceof HTMLCanvasElement)) {
    alert("Canvas 要素が取得できませんでした。");
    return;
  }
  canvas = maybeCanvas;

  const maybeGl = canvas.getContext("webgl");
  if (!maybeGl) {
    alert("WebGL がサポートされていません。");
    return;
  }
  gl = maybeGl;

  // シェーダーを初期化
  program = initShaders(gl);
  if (!program) {
    alert("WebGLプログラムの初期化に失敗しました。");
    return;
  }
  gl.useProgram(program);

  // 解像度を渡すための uniform
  u_resolution_location = gl.getUniformLocation(program, "u_resolution");
  if (u_resolution_location) {
    gl.uniform2f(u_resolution_location, canvas.width, canvas.height);
  }

  // シミュレーションの初期化（粒子配置など）
  initSimulation();

  // メインループ開始
  requestAnimationFrame(tick);
});

/****************************************************************************
 * 2. シミュレーションの初期化 (CPUサイド)
 ****************************************************************************/
function initSimulation(): void {
  particles = [];

  // 被捕食者 (Prey) の初期配置
  for (let i = 0; i < NUM_PREY; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    // 被捕食者は少しランダムな速度
    const vx = (Math.random() - 0.5) * PREY_SPEED * 2;
    const vy = (Math.random() - 0.5) * PREY_SPEED * 2;
    particles.push(new Particle(x, y, vx, vy, ParticleType.Prey, 1));
  }

  // 捕食者 (Predator) の初期配置
  for (let i = 0; i < NUM_PREDATORS; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    // 捕食者はやや速め
    const vx = (Math.random() - 0.5) * PREDATOR_SPEED * 2;
    const vy = (Math.random() - 0.5) * PREDATOR_SPEED * 2;
    particles.push(new Particle(x, y, vx, vy, ParticleType.Predator, 100));
  }
}

/****************************************************************************
 * 3. 毎フレームの更新処理 & 描画処理
 ****************************************************************************/
function tick(): void {
  updateSimulation();
  drawScene();
  requestAnimationFrame(tick);
}

/*---------------------------------------------------------------------------
 * 3-1. シミュレーション更新 (CPUサイド)
 *---------------------------------------------------------------------------*/
function updateSimulation(): void {
  // 被捕食者・捕食者のリストを分ける
  const preyList = particles.filter(
    (p) => p.type === ParticleType.Prey && p.alive
  );
  const predatorList = particles.filter(
    (p) => p.type === ParticleType.Predator && p.alive
  );

  // ----- 被捕食者(Prey)の動き -----
  for (const p of preyList) {
    // ランダムウォーク（ほんの少し方向を揺らす）
    p.vx += (Math.random() - 0.5) * 0.1;
    p.vy += (Math.random() - 0.5) * 0.1;
    limitSpeed(p, PREY_SPEED);

    // 位置更新
    p.x += p.vx;
    p.y += p.vy;

    // 画面端チェック
    boundaryCheck(p);
  }

  // ----- 捕食者(Predator)の動き -----
  for (const predator of predatorList) {
    // 近くの prey を探して追いかける
    const targetPrey = findClosestPrey(predator, preyList);
    if (targetPrey) {
      let dx = targetPrey.x - predator.x;
      let dy = targetPrey.y - predator.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        dx /= dist;
        dy /= dist;
      }
      predator.vx += dx * 0.2; // 追跡する力
      predator.vy += dy * 0.2;
    } else {
      // prey がいない場合はランダムウォーク
      predator.vx += (Math.random() - 0.5) * 0.1;
      predator.vy += (Math.random() - 0.5) * 0.1;
    }
    limitSpeed(predator, PREDATOR_SPEED);

    // 位置更新
    predator.x += predator.vx;
    predator.y += predator.vy;

    if (predator.type === ParticleType.Predator) {
      predator.hungriness -= 0.1;

      predator.vy *= predator.hungriness / 100;
      predator.vx *= predator.hungriness / 100;
    }

    if (predator.hungriness <= 0) {
      predator.alive = false;

      for (let i = 0; i < 10; i++) {
        particles.push(
          new Particle(
            predator.x + (Math.random() - 0.5) * 20,
            predator.y + (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * PREY_SPEED * 2,
            (Math.random() - 0.5) * PREY_SPEED * 2,
            ParticleType.Prey,
            1
          )
        );
      }
    }

    // 画面端チェック
    boundaryCheck(predator);
  }

  // spacial partitioning
  const grid: Record<string, Particle[]> = {};
  for (const p of particles) {
    const key = `${Math.floor(p.x / 50)}_${Math.floor(p.y / 50)}`;
    if (!grid[key]) {
      grid[key] = [];
    }
    grid[key].push(p);
  }

  // Boids (簡易的な実装)
  const vision = 50;
  const dist = (p1: Particle, p2: Particle) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  particles.forEach((p) => {
    const neighbors: Particle[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${Math.floor(p.x / 50) + dx}_${Math.floor(p.y / 50) + dy}`;
        if (grid[k]) {
          grid[k].forEach((q) => {
            if (p !== q && dist(p, q) < vision) {
              neighbors.push(q);
            }
          });
        }
      }
    }

    if (neighbors.length > 0) {
      // separation
      const sep = neighbors.reduce(
        (acc, q) => {
          if (p.type !== q.type) return acc;

          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 0) {
            acc[0] += dx / d;
            acc[1] += dy / d;
          }
          return acc;
        },
        [0, 0]
      );
      p.vx += sep[0] * 0.1;
      p.vy += sep[1] * 0.1;

      // alignment
      const avg = neighbors.reduce(
        (acc, q) => {
          if (p.type !== q.type) return acc;

          acc[0] += q.vx;
          acc[1] += q.vy;
          return acc;
        },
        [0, 0]
      );
      p.vx += avg[0] * 0.1;
      p.vy += avg[1] * 0.1;

      // cohesion
      const center = neighbors.reduce(
        (acc, q) => {
          if (p.type !== q.type) return acc;

          acc[0] += q.x;
          acc[1] += q.y;
          return acc;
        },
        [0, 0]
      );
      center[0] /= neighbors.length;
      center[1] /= neighbors.length;

      const dx = center[0] - p.x;
      const dy = center[1] - p.y;
      p.vx += dx * 0.01;
      p.vy += dy * 0.01;
    }
  });

  // ----- 捕食判定 -----
  for (const predator of predatorList) {
    for (const prey of preyList) {
      if (!prey.alive) continue;
      const dx = prey.x - predator.x;
      const dy = prey.y - predator.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < EAT_DISTANCE) {
        // prey を捕食 → prey を消す
        prey.alive = false;

        predator.hungriness += 20;
      }
    }
  }

  // 死亡（捕食）された prey を除去
  particles = particles.filter((p) => p.alive);
}

/*---------------------------------------------------------------------------
 * 3-2. WebGL で描画する
 *---------------------------------------------------------------------------*/
function drawScene(): void {
  if (!program) return;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.07, 0.07, 0.07, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // 現在の粒子データを WebGL へ送るために配列を作り直す
  positions = [];
  velocities = [];
  colors = [];
  types = [];
  for (const p of particles) {
    positions.push(p.x, p.y);
    velocities.push(p.vx, p.vy);
    if (p.type === ParticleType.Prey) {
      // 被捕食者 => 青系
      colors.push(0.3, 0.6, 1.0);
    } else {
      // 捕食者 => 赤系
      colors.push(1.0, 0.3, 0.3);
    }
    types.push(p.type);
  }

  // ------------ バッファ準備 ------------
  // 頂点位置バッファ
  const positionBuffer = gl.createBuffer();
  if (!positionBuffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STREAM_DRAW);

  // 速度バッファ
  const velocityBuffer = gl.createBuffer();
  if (!velocityBuffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(velocities), gl.STREAM_DRAW);

  // カラーバッファ
  const colorBuffer = gl.createBuffer();
  if (!colorBuffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STREAM_DRAW);

  // 種別バッファ
  const typeBuffer = gl.createBuffer();
  if (!typeBuffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, typeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(types), gl.STREAM_DRAW);

  const a_position_location = gl.getAttribLocation(program, "a_position");
  const a_velocity_location = gl.getAttribLocation(program, "a_velocity");
  const a_color_location = gl.getAttribLocation(program, "a_color");
  const a_type_location = gl.getAttribLocation(program, "a_type");

  // a_position に頂点バッファを設定
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.vertexAttribPointer(a_position_location, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_position_location);

  // a_velocity に頂点バッファを設定
  gl.bindBuffer(gl.ARRAY_BUFFER, velocityBuffer);
  gl.vertexAttribPointer(a_velocity_location, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_velocity_location);

  // a_color にカラーバッファを設定
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.vertexAttribPointer(a_color_location, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_color_location);

  // a_type に種別バッファを設定
  gl.bindBuffer(gl.ARRAY_BUFFER, typeBuffer);
  gl.vertexAttribPointer(a_type_location, 1, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(a_type_location);

  // ドローコール
  gl.drawArrays(gl.POINTS, 0, positions.length / 2);
}

/****************************************************************************
 * 4. ヘルパー関数
 ****************************************************************************/

/* 速度制限 */
function limitSpeed(p: Particle, maxSpeed: number): void {
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed > maxSpeed) {
    p.vx = (p.vx / speed) * maxSpeed;
    p.vy = (p.vy / speed) * maxSpeed;
  }
}

/* 画面端で反射する処理 */
function boundaryCheck(p: Particle): void {
  if (p.x < 0) {
    p.x = 0;
    p.vx *= -0.5;
  }
  if (p.x > canvas.width) {
    p.x = canvas.width;
    p.vx *= -0.5;
  }
  if (p.y < 0) {
    p.y = 0;
    p.vy *= -0.5;
  }
  if (p.y > canvas.height) {
    p.y = canvas.height;
    p.vy *= -0.5;
  }
}

/* 最も近い Prey を探す */
function findClosestPrey(
  predator: Particle,
  preyList: Particle[]
): Particle | null {
  let closestPrey: Particle | null = null;
  let minDist: number = Infinity;

  for (const p of preyList) {
    if (!p.alive) continue;
    const dx = p.x - predator.x;
    const dy = p.y - predator.y;
    const distSq = dx * dx + dy * dy; // 距離の2乗で比較
    if (distSq < minDist) {
      minDist = distSq;
      closestPrey = p;
    }
  }
  return closestPrey;
}

/****************************************************************************
 * 5. シェーダー関連の初期化
 ****************************************************************************/

function initShaders(gl: WebGLRenderingContext): WebGLProgram | null {
  // シェーダーのコンパイル
  const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) {
    return null;
  }

  // シェーダプログラムのリンク
  const shaderProgram = gl.createProgram();
  if (!shaderProgram) {
    return null;
  }

  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // 成功チェック
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    console.error(
      "Could not link WebGL shader program:",
      gl.getProgramInfoLog(shaderProgram)
    );
    gl.deleteProgram(shaderProgram);
    return null;
  }

  return shaderProgram;
}

function compileShader(
  gl: WebGLRenderingContext,
  source: string,
  type: number
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  // 成功チェック
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Could not compile shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
