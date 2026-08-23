// ============================================================
// AXIOM CRYSTAL AUTH v1.0
// Motor de entropía conductual: S_b = α·(dv_c/dt)² + β·σ² + γ·D_KL
// ============================================================

const ALPHA = 0.4;
const BETA = 0.3;
const GAMMA = 0.3;
const SAMPLE_WINDOW = 200; // últimas 200 muestras de ratón
const BINS = 20; // histograma de 20 buckets

let mouseData = [];
let typingData = [];
let baselineHistogram = null;
let isTracking = false;
let lastPos = null;
let lastTime = null;

const trackArea = document.getElementById('trackArea');
const canvas = document.getElementById('mouseCanvas');
const ctx = canvas.getContext('2d');
const trackLabel = document.getElementById('trackLabel');

// Ajustar canvas
function resizeCanvas() {
    const rect = trackArea.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Dibujar traza
function drawTrace(x, y, intensity) {
    ctx.fillStyle = `rgba(0, 212, 255, ${intensity})`;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
}

// Captura de ratón
trackArea.addEventListener('mouseenter', () => {
    isTracking = true;
    trackArea.classList.add('active');
    trackLabel.style.opacity = '0';
});
trackArea.addEventListener('mouseleave', () => {
    isTracking = false;
    trackArea.classList.remove('active');
    trackLabel.style.opacity = '1';
});
trackArea.addEventListener('mousemove', (e) => {
    if (!isTracking) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = performance.now();
    
    if (lastPos && lastTime) {
        const dx = x - lastPos.x;
        const dy = y - lastPos.y;
        const dt = t - lastTime;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const velocity = dt > 0 ? dist / dt : 0; // px/ms
        
        mouseData.push({
            x, y, t, v: velocity,
            dx, dy, dt
        });
        
        if (mouseData.length > SAMPLE_WINDOW) mouseData.shift();
        
        drawTrace(x, y, Math.min(0.8, velocity / 5));
    }
    
    lastPos = {x, y};
    lastTime = t;
    document.getElementById('valSamples').textContent = mouseData.length;
});

// Captura de teclado
const typeArea = document.getElementById('typeArea');
let lastKeyTime = null;
typeArea.addEventListener('keydown', (e) => {
    const t = performance.now();
    if (lastKeyTime) {
        const interval = t - lastKeyTime;
        if (interval > 30 && interval < 2000) {
            typingData.push(interval);
            if (typingData.length > 100) typingData.shift();
        }
    }
    lastKeyTime = t;
});

// Calcular histograma
function buildHistogram(data, min, max) {
    const hist = new Array(BINS).fill(0);
    const binWidth = (max - min) / BINS;
    data.forEach(v => {
        let idx = Math.floor((v - min) / binWidth);
        if (idx < 0) idx = 0;
        if (idx >= BINS) idx = BINS - 1;
        hist[idx]++;
    });
    // Normalizar
    const sum = hist.reduce((a,b) => a+b, 0);
    return sum > 0 ? hist.map(h => h / sum) : hist.map(() => 1/BINS);
}

// Divergencia KL: D_KL(P || Q) = Σ P(i) · log(P(i)/Q(i))
function klDivergence(p, q) {
    let kl = 0;
    for (let i = 0; i < p.length; i++) {
        if (p[i] > 0.0001 && q[i] > 0.0001) {
            kl += p[i] * Math.log2(p[i] / q[i]);
        }
    }
    return kl;
}

// Entropía de Shannon
function shannonEntropy(p) {
    let h = 0;
    for (let i = 0; i < p.length; i++) {
        if (p[i] > 0.0001) {
            h -= p[i] * Math.log2(p[i]);
        }
    }
    return h;
}

// Perfil base "humano" simulado (distribución log-normal típica)
function generateBaselineProfile() {
    const baseline = [];
    for (let i = 0; i < 1000; i++) {
        // Velocidad humana: media ~0.5 px/ms, cola larga
        const u = Math.random();
        const v = -Math.log(1 - u) * 0.4 + 0.1; // exponencial sesgada
        baseline.push(Math.min(v, 5));
    }
    return baseline;
}

let baselineData = generateBaselineProfile();

// Calcular S_b
function calculateSb() {
    if (mouseData.length < 50) {
        alert('Mueve el ratón más tiempo. Mínimo 50 muestras.');
        return;
    }
    
    const velocities = mouseData.map(d => d.v);
    const n = velocities.length;
    
    // v_c: velocidad media
    const vc = velocities.reduce((a,b) => a+b, 0) / n;
    
    // σ²: varianza
    const mean = vc;
    const variance = velocities.reduce((sum, v) => sum + (v - mean)**2, 0) / n;
    
    // dv_c/dt: tasa de cambio de velocidad (aceleración media absoluta)
    let accelSum = 0;
    for (let i = 1; i < mouseData.length; i++) {
        const dv = mouseData[i].v - mouseData[i-1].v;
        const dt = mouseData[i].dt;
        if (dt > 0) accelSum += Math.abs(dv / dt);
    }
    const dvc_dt = accelSum / (mouseData.length - 1);
    
    // Histogramas para KL
    const vMin = 0, vMax = 5;
    const currentHist = buildHistogram(velocities, vMin, vMax);
    const baselineHist = buildHistogram(baselineData, vMin, vMax);
    
    // Suavizar para evitar zeros
    const smooth = h => h.map(x => x + 0.001);
    const curS = smooth(currentHist);
    const baseS = smooth(baselineHist);
    // Renormalizar
    const sumCur = curS.reduce((a,b)=>a+b,0);
    const sumBase = baseS.reduce((a,b)=>a+b,0);
    const curN = curS.map(x => x/sumCur);
    const baseN = baseS.map(x => x/sumBase);
    
    const kl = klDivergence(curN, baseN);
    const entropy = shannonEntropy(curN);
    
    // Score S_b (mapeado a 0-100)
    // Términos normalizados empíricamente
    const term1 = Math.min(1, (dvc_dt * 100)); // aceleración
    const term2 = Math.min(1, variance * 2);   // varianza
    const term3 = Math.min(1, kl / 2);         // KL divergence
    
    const sbRaw = ALPHA * term1 + BETA * term2 + GAMMA * term3;
    const sb = Math.max(0, Math.min(100, sbRaw * 100));
    
    // Actualizar UI
    document.getElementById('valVc').textContent = vc.toFixed(3) + ' px/ms';
    document.getElementById('valSigma').textContent = variance.toFixed(4);
    document.getElementById('valKl').textContent = kl.toFixed(4);
    document.getElementById('valEntropy').textContent = entropy.toFixed(2) + ' bits';
    
    const scoreVal = document.getElementById('scoreValue');
    const scoreCircle = document.getElementById('scoreCircle');
    const statusBox = document.getElementById('statusBox');
    
    scoreVal.textContent = Math.round(sb);
    
    // Animar círculo
    const circumference = 2 * Math.PI * 80; // ~502
    const offset = circumference - (sb / 100) * circumference;
    scoreCircle.style.strokeDashoffset = offset;
    
    // Color según score
    let color = '#00d4ff';
    let statusClass = 'status-unclear';
    let statusText = 'Perfil inconsistente — necesita más datos';
    
    if (sb > 75) {
        color = '#10b981';
        statusClass = 'status-human';
        statusText = '✅ HUMANO — Consistencia conductual alta';
        scoreCircle.style.stroke = '#10b981';
    } else if (sb < 35) {
        color = '#ef4444';
        statusClass = 'status-bot';
        statusText = '🤖 BOT DETECTADO — Patrón robótico';
        scoreCircle.style.stroke = '#ef4444';
    } else {
        color = '#f59e0b';
        statusClass = 'status-unclear';
        statusText = '⚠️ INCIERTO — Comportamiento mixto';
        scoreCircle.style.stroke = '#f59e0b';
    }
    
    scoreVal.style.color = color;
    statusBox.className = 'status-box ' + statusClass;
    statusBox.textContent = statusText;
    statusBox.style.display = 'block';
}

// Simular bot (movimiento robótico lineal)
function simulateBot() {
    mouseData = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const w = canvas.width;
    const h = canvas.height;
    let x = 50, y = h/2;
    const steps = 150;
    
    for (let i = 0; i < steps; i++) {
        // Movimiento robótico: velocidad constante, giros bruscos
        if (i % 30 === 0) y += (Math.random() - 0.5) * 40;
        x += (w - 100) / steps;
        
        const t = performance.now() + i * 16; // 60fps simulado
        const v = 0.8; // velocidad constante (robot)
        
        mouseData.push({x, y, t, v, dx: 2, dy: 0, dt: 16});
        drawTrace(x, y, 0.5);
    }
    
    document.getElementById('valSamples').textContent = mouseData.length;
    calculateSb();
}

// Reset
function resetAll() {
    mouseData = [];
    typingData = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    baselineData = generateBaselineProfile();
    document.getElementById('scoreValue').textContent = '--';
    document.getElementById('scoreCircle').style.strokeDashoffset = 502;
    document.getElementById('statusBox').style.display = 'none';
    document.getElementById('valVc').textContent = '-- px/ms';
    document.getElementById('valSigma').textContent = '--';
    document.getElementById('valKl').textContent = '--';
    document.getElementById('valEntropy').textContent = '-- bits';
    document.getElementById('valSamples').textContent = '0';
    typeArea.value = '';
}

document.getElementById('btnAnalyze').addEventListener('click', calculateSb);
document.getElementById('btnBot').addEventListener('click', simulateBot);
document.getElementById('btnReset').addEventListener('click', resetAll);

